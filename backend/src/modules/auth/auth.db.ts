import { query, isDbConfigured } from '../../config/pg';
import { logger } from '../../utils/logger';

/**
 * Normalized authentication tables. Unlike the JSONB document store used for
 * proposals/evaluations, auth data lives in a dedicated "auth" schema with
 * real columns and constraints — PostgreSQL is the source of truth.
 *
 * `initAuthSchema()` is idempotent (CREATE ... IF NOT EXISTS) and runs at
 * server startup once the pool is connected. It also migrates any legacy
 * users out of the old `backend.users` JSONB collection exactly once
 * (ON CONFLICT DO NOTHING), preserving their bcrypt hashes — the service
 * layer verifies both bcrypt and argon2 and transparently rehashes to
 * Argon2id on the next successful login.
 */

const DDL = `
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username              TEXT NOT NULL,
  email                 TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  full_name             TEXT NOT NULL,
  company               TEXT,
  role                  TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  last_login            TIMESTAMPTZ,
  reset_token_hash      TEXT,
  reset_token_expires   TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON auth.users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON auth.users (lower(username));

CREATE TABLE IF NOT EXISTS auth.sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  ip_address         TEXT,
  user_agent         TEXT,
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON auth.sessions (user_id);

CREATE TABLE IF NOT EXISTS auth.audit_logs (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    UUID,
  event      TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON auth.audit_logs (user_id, created_at);
`;

/** Row shape of auth.users as returned by node-postgres. */
export interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  full_name: string;
  company: string | null;
  role: 'USER' | 'ADMIN';
  is_active: boolean;
  email_verified: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login: Date | null;
  reset_token_hash: string | null;
  reset_token_expires: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type AuditEvent =
  | 'REGISTER'
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'LOGOUT_ALL'
  | 'TOKEN_REFRESH'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET'
  | 'ACCOUNT_LOCKED'
  | 'SESSION_REVOKED';

/** Request context captured for audit entries and sessions. */
export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Best-effort audit write — auth must never fail because the audit insert
 * did. Failures are logged and swallowed.
 */
export async function audit(
  event: AuditEvent,
  userId: string | null,
  ctx: RequestContext,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await query(
      `INSERT INTO auth.audit_logs (user_id, event, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, event, ctx.ip ?? null, ctx.userAgent ?? null, details ? JSON.stringify(details) : null]
    );
  } catch (err: any) {
    logger.warn('audit_write_failed', { event, reason: err?.message });
  }
}

/** Copy legacy JSONB users (backend.users) into auth.users. Idempotent. */
async function migrateLegacyUsers(): Promise<void> {
  const legacy = await query(`SELECT to_regclass('backend.users') IS NOT NULL AS exists`);
  if (!legacy.rows[0]?.exists) return;

  const res = await query(`SELECT id, data FROM backend.users`);
  let migrated = 0;
  for (const row of res.rows) {
    const d = row.data ?? {};
    if (!d.email || !d.password) continue;
    // Derive a username from the email local part; fall back to an id
    // fragment suffix when it collides with an already-migrated user.
    const base = String(d.email).split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 24) || 'user';
    for (const username of [base, `${base}-${String(row.id).slice(0, 8)}`]) {
      try {
        const inserted = await query(
          `INSERT INTO auth.users
             (id, username, email, password_hash, full_name, company, role, created_at, updated_at)
           VALUES ($1, $2, lower($3), $4, $5, $6, $7, COALESCE($8::timestamptz, now()), now())
           ON CONFLICT (id) DO NOTHING`,
          [
            row.id,
            username,
            d.email,
            d.password,
            d.name ?? base,
            d.company ?? null,
            d.role === 'ADMIN' ? 'ADMIN' : 'USER',
            d.createdAt ?? null,
          ]
        );
        migrated += inserted.rowCount ?? 0;
        break;
      } catch (err: any) {
        // 23505 on the email index means the user was already migrated under
        // a different id — skip. On the username index, retry with suffix.
        if (err?.code !== '23505') throw err;
        if (err?.constraint !== 'users_username_key') break;
      }
    }
  }
  if (migrated > 0) {
    logger.info('auth_legacy_users_migrated', { count: migrated });
  }
}

/** Create the auth schema/tables and migrate legacy users. Startup-only. */
export async function initAuthSchema(): Promise<void> {
  if (!isDbConfigured()) return;
  await query(DDL);
  await migrateLegacyUsers();
}
