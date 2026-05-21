/**
 * Tests for src/middleware/auth.ts — auth & optional-auth middleware.
 */
import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { authMiddleware, optionalAuthMiddleware } from '../src/middleware/auth';

function mockReq(headers: Record<string, string> = {}): any {
  return { headers };
}

function mockRes(): any {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('authMiddleware', () => {
  const secret = process.env.JWT_SECRET!;

  it('rejects when no Authorization header', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('No token') }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects when Authorization header missing Bearer prefix', () => {
    const req = mockReq({ authorization: 'Token abc' });
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid token', () => {
    const req = mockReq({ authorization: 'Bearer invalid.token.value' });
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Invalid') }),
    );
  });

  it('accepts valid token and sets userId/role', () => {
    const token = jwt.sign({ userId: 'user-123', role: 'admin' }, secret);
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe('user-123');
    expect(req.userRole).toBe('admin');
  });

  it('rejects expired token', () => {
    const token = jwt.sign({ userId: 'u1', role: 'user' }, secret, { expiresIn: '-1s' });
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('optionalAuthMiddleware', () => {
  const secret = process.env.JWT_SECRET!;

  it('proceeds without token', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    optionalAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userId).toBeUndefined();
  });

  it('sets userId on valid token', () => {
    const token = jwt.sign({ userId: 'user-456', role: 'reviewer' }, secret);
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = vi.fn();

    optionalAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe('user-456');
    expect(req.userRole).toBe('reviewer');
  });

  it('proceeds on invalid token without setting userId', () => {
    const req = mockReq({ authorization: 'Bearer bad.token' });
    const res = mockRes();
    const next = vi.fn();

    optionalAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userId).toBeUndefined();
  });
});
