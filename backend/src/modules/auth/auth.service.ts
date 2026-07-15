import argon2 from 'argon2';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import { collections } from '../../config/database';
import { env } from '../../config/env';
import { query } from '../../config/pg';
import { AppError } from '../../errors';
import { audit, RequestContext, UserRow } from './auth.db';
import { RegisterInput, LoginInput, ChangePasswordInput, ResetPasswordInput } from './auth.schema';

const RESET_TOKEN_TTL_MINUTES = 30;

/**
 * Pre-computed hash used to equalize response time when the login email does
 * not exist — a real Argon2 verify runs either way, so "user not found" and
 * "wrong password" are indistinguishable by timing.
 */
const dummyHashPromise = argon2.hash(randomBytes(16).toString('hex'), { type: argon2.argon2id });

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

/** Verify against Argon2id, or legacy bcrypt hashes from the old user store. */
async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    if (hash.startsWith('$2')) return await bcrypt.compare(password, hash);
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Refresh/reset tokens are opaque 256-bit values; only their SHA-256 is stored. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function newOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

/** Client-safe user shape — never includes password or token hashes. */
export function toPublicUser(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    name: u.full_name,
    company: u.company,
    role: u.role,
    isActive: u.is_active,
    emailVerified: u.email_verified,
    lastLogin: u.last_login,
    createdAt: u.created_at,
  };
}

export type PublicUser = ReturnType<typeof toPublicUser>;

export interface AuthResult {
  user: PublicUser;
  token: string;
  /** Raw refresh token — the controller moves it into an HttpOnly cookie. */
  refreshToken: string;
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  const res = await query<UserRow>(`SELECT * FROM auth.users WHERE lower(email) = lower($1)`, [email]);
  return res.rows[0] ?? null;
}

async function findUserById(id: string): Promise<UserRow | null> {
  const res = await query<UserRow>(`SELECT * FROM auth.users WHERE id = $1`, [id]);
  return res.rows[0] ?? null;
}

export class AuthService {
  // ── Registration ──────────────────────────────────────────────────────────

  async register(data: RegisterInput, ctx: RequestContext): Promise<AuthResult> {
    const passwordHash = await hashPassword(data.password);
    const base =
      data.username ??
      (data.email.split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 24).padEnd(3, '0') || 'user');

    // Insert directly and let the unique indexes arbitrate duplicates — no
    // check-then-insert race. When no explicit username was given, retry once
    // with a random suffix if the derived one is taken.
    let user: UserRow | undefined;
    const candidates = data.username ? [base] : [base, `${base}-${randomBytes(2).toString('hex')}`];
    for (const username of candidates) {
      try {
        const res = await query<UserRow>(
          `INSERT INTO auth.users (username, email, password_hash, full_name, company)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [username, data.email, passwordHash, data.name, data.company ?? null]
        );
        user = res.rows[0];
        break;
      } catch (err: any) {
        if (err?.code !== '23505') throw err;
        if (err?.constraint === 'users_email_key') {
          throw AppError.conflict('Email already registered');
        }
        if (data.username) throw AppError.conflict('Username already taken');
        // derived username collided — loop retries with the suffixed candidate
      }
    }
    if (!user) throw AppError.conflict('Username already taken');

    await audit('REGISTER', user.id, ctx);
    return this.issueTokens(user, ctx);
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(data: LoginInput, ctx: RequestContext): Promise<AuthResult> {
    const user = await findUserByEmail(data.email);

    if (!user) {
      await argon2.verify(await dummyHashPromise, data.password).catch(() => false);
      await audit('LOGIN_FAILURE', null, ctx, { email: data.email, reason: 'unknown_email' });
      throw AppError.unauthorized('Invalid email or password');
    }

    if (user.locked_until && user.locked_until > new Date()) {
      const minutes = Math.max(1, Math.ceil((user.locked_until.getTime() - Date.now()) / 60_000));
      await audit('LOGIN_FAILURE', user.id, ctx, { reason: 'locked' });
      throw AppError.forbidden(
        `Account temporarily locked due to too many failed attempts. Try again in ${minutes} minute(s).`
      );
    }

    const valid = await verifyPassword(user.password_hash, data.password);
    if (!valid) {
      await this.recordFailedLogin(user, ctx);
      throw AppError.unauthorized('Invalid email or password');
    }

    if (!user.is_active) {
      await audit('LOGIN_FAILURE', user.id, ctx, { reason: 'inactive' });
      throw AppError.forbidden('Account is disabled. Contact an administrator.');
    }

    // Success: reset lockout counters, stamp last_login, and transparently
    // upgrade legacy bcrypt hashes to Argon2id.
    const rehash = user.password_hash.startsWith('$2') ? await hashPassword(data.password) : null;
    await query(
      `UPDATE auth.users
       SET failed_login_attempts = 0, locked_until = NULL, last_login = now(),
           password_hash = COALESCE($2, password_hash), updated_at = now()
       WHERE id = $1`,
      [user.id, rehash]
    );

    await audit('LOGIN_SUCCESS', user.id, ctx);
    return this.issueTokens({ ...user, last_login: new Date() }, ctx);
  }

  /** Atomically bump the failure counter and lock the account at the threshold. */
  private async recordFailedLogin(user: UserRow, ctx: RequestContext): Promise<void> {
    const res = await query<{ failed_login_attempts: number; locked_until: Date | null }>(
      `UPDATE auth.users
       SET failed_login_attempts = failed_login_attempts + 1,
           locked_until = CASE
             WHEN failed_login_attempts + 1 >= $2 THEN now() + make_interval(mins => $3)
             ELSE locked_until
           END,
           updated_at = now()
       WHERE id = $1
       RETURNING failed_login_attempts, locked_until`,
      [user.id, env.AUTH_MAX_FAILED_LOGINS, env.AUTH_LOCKOUT_MINUTES]
    );
    const row = res.rows[0];
    await audit('LOGIN_FAILURE', user.id, ctx, {
      reason: 'bad_password',
      attempts: row?.failed_login_attempts,
    });
    if (row?.locked_until && row.locked_until > new Date()) {
      await audit('ACCOUNT_LOCKED', user.id, ctx, { until: row.locked_until });
    }
  }

  // ── Tokens & sessions ─────────────────────────────────────────────────────

  private generateAccessToken(userId: string, role: string): string {
    return jwt.sign({ userId, role }, env.JWT_SECRET, {
      expiresIn: env.JWT_ACCESS_EXPIRY,
    } as jwt.SignOptions);
  }

  private async issueTokens(user: UserRow, ctx: RequestContext): Promise<AuthResult> {
    const refreshToken = newOpaqueToken();
    // Opportunistic cleanup of this user's expired sessions, then persist the
    // new one (hash only).
    await query(`DELETE FROM auth.sessions WHERE user_id = $1 AND expires_at < now()`, [user.id]);
    await query(
      `INSERT INTO auth.sessions (user_id, refresh_token_hash, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))`,
      [user.id, sha256(refreshToken), ctx.ip ?? null, ctx.userAgent ?? null, env.JWT_REFRESH_EXPIRY_DAYS]
    );
    return {
      user: toPublicUser(user),
      token: this.generateAccessToken(user.id, user.role),
      refreshToken,
    };
  }

  /** Rotate the refresh token and mint a new access token. */
  async refresh(rawToken: string, ctx: RequestContext): Promise<AuthResult> {
    const res = await query<{ session_id: string; expires_at: Date } & UserRow>(
      `SELECT s.id AS session_id, s.expires_at, u.*
       FROM auth.sessions s JOIN auth.users u ON u.id = s.user_id
       WHERE s.refresh_token_hash = $1`,
      [sha256(rawToken)]
    );
    const row = res.rows[0];
    if (!row || row.expires_at < new Date()) {
      if (row) await query(`DELETE FROM auth.sessions WHERE id = $1`, [row.session_id]);
      throw AppError.unauthorized('Invalid or expired refresh token');
    }
    if (!row.is_active) {
      await query(`DELETE FROM auth.sessions WHERE user_id = $1`, [row.id]);
      throw AppError.forbidden('Account is disabled. Contact an administrator.');
    }

    const refreshToken = newOpaqueToken();
    await query(
      `UPDATE auth.sessions
       SET refresh_token_hash = $2, ip_address = $3, user_agent = $4,
           expires_at = now() + make_interval(days => $5)
       WHERE id = $1`,
      [row.session_id, sha256(refreshToken), ctx.ip ?? null, ctx.userAgent ?? null, env.JWT_REFRESH_EXPIRY_DAYS]
    );
    await audit('TOKEN_REFRESH', row.id, ctx);

    return {
      user: toPublicUser(row),
      token: this.generateAccessToken(row.id, row.role),
      refreshToken,
    };
  }

  /** Revoke the session matching the presented refresh token (idempotent). */
  async logout(rawToken: string | null, ctx: RequestContext): Promise<void> {
    if (!rawToken) return;
    const res = await query<{ user_id: string }>(
      `DELETE FROM auth.sessions WHERE refresh_token_hash = $1 RETURNING user_id`,
      [sha256(rawToken)]
    );
    if (res.rows[0]) await audit('LOGOUT', res.rows[0].user_id, ctx);
  }

  async logoutAll(userId: string, ctx: RequestContext): Promise<{ revoked: number }> {
    const res = await query(`DELETE FROM auth.sessions WHERE user_id = $1`, [userId]);
    await audit('LOGOUT_ALL', userId, ctx, { revoked: res.rowCount });
    return { revoked: res.rowCount ?? 0 };
  }

  async listSessions(userId: string, currentTokenHash: string | null) {
    const res = await query(
      `SELECT id, ip_address AS "ipAddress", user_agent AS "userAgent",
              created_at AS "createdAt", expires_at AS "expiresAt",
              refresh_token_hash = $2 AS "current"
       FROM auth.sessions
       WHERE user_id = $1 AND expires_at > now()
       ORDER BY created_at DESC`,
      [userId, currentTokenHash ?? '']
    );
    return res.rows;
  }

  async revokeSession(userId: string, sessionId: string, ctx: RequestContext): Promise<void> {
    const res = await query(`DELETE FROM auth.sessions WHERE id = $1 AND user_id = $2`, [
      sessionId,
      userId,
    ]);
    if (!res.rowCount) throw AppError.notFound('Session not found');
    await audit('SESSION_REVOKED', userId, ctx, { sessionId });
  }

  // ── Profile ───────────────────────────────────────────────────────────────

  async getProfile(userId: string) {
    const user = await findUserById(userId);
    if (!user) throw AppError.notFound('User not found');

    // Proposals still live in the document store.
    const proposalCount = await collections.proposals.where('userId', '==', userId).count().get();
    return {
      ...toPublicUser(user),
      _count: { proposals: proposalCount.data().count },
    };
  }

  // ── Password management ───────────────────────────────────────────────────

  async changePassword(
    userId: string,
    data: ChangePasswordInput,
    currentTokenHash: string | null,
    ctx: RequestContext
  ): Promise<void> {
    const user = await findUserById(userId);
    if (!user) throw AppError.notFound('User not found');

    const valid = await verifyPassword(user.password_hash, data.currentPassword);
    if (!valid) throw AppError.unauthorized('Current password is incorrect');

    await query(`UPDATE auth.users SET password_hash = $2, updated_at = now() WHERE id = $1`, [
      userId,
      await hashPassword(data.newPassword),
    ]);
    // Revoke every other session so a stolen refresh token dies with the
    // old password; the session that made the change stays valid.
    await query(`DELETE FROM auth.sessions WHERE user_id = $1 AND refresh_token_hash <> $2`, [
      userId,
      currentTokenHash ?? '',
    ]);
    await audit('PASSWORD_CHANGED', userId, ctx);
  }

  /**
   * Create a password-reset token. Returns the raw token (or null when the
   * email is unknown) — the controller must respond identically either way.
   * ponytail: no SMTP is wired up; deliver via email once a mailer exists.
   */
  async forgotPassword(email: string, ctx: RequestContext): Promise<string | null> {
    const user = await findUserByEmail(email);
    if (!user || !user.is_active) return null;

    const token = newOpaqueToken();
    await query(
      `UPDATE auth.users
       SET reset_token_hash = $2, reset_token_expires = now() + make_interval(mins => $3),
           updated_at = now()
       WHERE id = $1`,
      [user.id, sha256(token), RESET_TOKEN_TTL_MINUTES]
    );
    await audit('PASSWORD_RESET_REQUESTED', user.id, ctx);
    return token;
  }

  async resetPassword(data: ResetPasswordInput, ctx: RequestContext): Promise<void> {
    const res = await query<{ id: string }>(
      `UPDATE auth.users
       SET password_hash = $2, reset_token_hash = NULL, reset_token_expires = NULL,
           failed_login_attempts = 0, locked_until = NULL, updated_at = now()
       WHERE reset_token_hash = $1 AND reset_token_expires > now()
       RETURNING id`,
      [sha256(data.token), await hashPassword(data.password)]
    );
    const row = res.rows[0];
    if (!row) throw AppError.badRequest('Invalid or expired reset token');

    // A reset proves control of the account; kill all existing sessions.
    await query(`DELETE FROM auth.sessions WHERE user_id = $1`, [row.id]);
    await audit('PASSWORD_RESET', row.id, ctx);
  }
}

export const authService = new AuthService();
export { sha256 };
