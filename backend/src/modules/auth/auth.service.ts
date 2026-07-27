import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, queryOne } from '../../config/db';
import { env } from '../../config/env';
import { LoginInput } from './auth.schema';
import { AppError } from '../../middleware/errorHandler';

export type Role = 'ADMIN' | 'DESK2';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
  is_active: boolean;
  created_at: Date;
  last_login_at: Date | null;
}

export type PublicUser = Omit<UserRow, 'password_hash'>;

function toPublic(user: UserRow): PublicUser {
  const { password_hash: _omit, ...rest } = user;
  return rest;
}

export class AuthService {
  /**
   * Self-registration is deliberately gone.
   *
   * This is an internal evaluation console with exactly two operator accounts.
   * Anyone who could register could read every proposal and approve funding, so
   * accounts are seeded (see scripts/seed.ts) and only an ADMIN may create more.
   */
  async createUser(data: {
    email: string;
    password: string;
    name: string;
    role: Role;
  }): Promise<PublicUser> {
    const existing = await queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [
      data.email.toLowerCase(),
    ]);
    if (existing) {
      throw new AppError('Email already registered', 409);
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    const rows = await query<UserRow>(
      `INSERT INTO users (id, email, name, password_hash, role, is_active, created_at, updated_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, true, now(), now())
       RETURNING *`,
      [data.email.toLowerCase(), data.name, passwordHash, data.role],
    );

    return toPublic(rows[0]!);
  }

  async login(data: LoginInput) {
    const user = await queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [
      data.email.toLowerCase(),
    ]);

    // Same error and roughly the same work either way — a distinct "no such
    // user" reply would let anyone enumerate valid operator accounts.
    if (!user) {
      await bcrypt.compare(data.password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
      throw new AppError('Invalid email or password', 401);
    }

    if (!user.is_active) {
      throw new AppError('Account is disabled', 403);
    }

    const valid = await bcrypt.compare(data.password, user.password_hash);
    if (!valid) {
      throw new AppError('Invalid email or password', 401);
    }

    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

    return {
      user: toPublic(user),
      token: this.generateToken(user.id, user.role),
    };
  }

  async getProfile(userId: string): Promise<PublicUser> {
    const user = await queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
    if (!user) {
      throw new AppError('User not found', 404);
    }
    return toPublic(user);
  }

  async listUsers(): Promise<PublicUser[]> {
    const users = await query<UserRow>(
      'SELECT * FROM users ORDER BY created_at ASC',
    );
    return users.map(toPublic);
  }

  private generateToken(userId: string, role: Role): string {
    return jwt.sign({ userId, role }, env.JWT_SECRET, { expiresIn: '12h' });
  }
}

export const authService = new AuthService();
