/**
 * Tests for src/modules/auth/auth.schema.ts — input validation & password policy.
 */
import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema, resetPasswordSchema, passwordSchema } from '../src/modules/auth/auth.schema';

describe('passwordSchema (policy: 12+ chars, upper, lower, digit, special)', () => {
  it('accepts a compliant password', () => {
    expect(passwordSchema.safeParse('Str0ng!Passw0rd').success).toBe(true);
  });

  it.each([
    ['too short', 'Sh0rt!pass'],
    ['no uppercase', 'weak!password123'],
    ['no lowercase', 'WEAK!PASSWORD123'],
    ['no number', 'Weak!Password!'],
    ['no special char', 'WeakPassword123'],
  ])('rejects %s', (_label, pw) => {
    expect(passwordSchema.safeParse(pw).success).toBe(false);
  });
});

describe('registerSchema', () => {
  const valid = { email: 'User@Example.com', password: 'Str0ng!Passw0rd', name: 'Test User' };

  it('accepts valid input and lowercases the email', () => {
    const parsed = registerSchema.parse(valid);
    expect(parsed.email).toBe('user@example.com');
  });

  it('rejects invalid email', () => {
    expect(registerSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  it('rejects bad usernames', () => {
    expect(registerSchema.safeParse({ ...valid, username: 'a' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, username: 'has spaces' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, username: 'good_user-1' }).success).toBe(true);
  });
});

describe('loginSchema', () => {
  it('requires email and password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  it('only accepts 64-char hex tokens', () => {
    const password = 'Str0ng!Passw0rd';
    expect(resetPasswordSchema.safeParse({ token: 'f'.repeat(64), password }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ token: 'zz', password }).success).toBe(false);
  });
});
