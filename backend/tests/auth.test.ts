/**
 * Auth and RBAC — the gateway's security boundary.
 *
 * These rules decide who may read a proposal and who may approve funding.
 * `optionalAuthMiddleware` used to exist and waved tokenless requests through, treating
 * them as an "anonymous owner" — every route in the system was reachable logged-out. It
 * is gone, and these tests exist so that it does not come back.
 */
import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { authMiddleware, requireRole, AuthRequest } from '../src/middleware/auth';

const SECRET = process.env.JWT_SECRET!;

function mockReq(headers: Record<string, string> = {}, extra: Partial<AuthRequest> = {}): any {
  return { headers, ...extra };
}

function mockRes(): any {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const tokenFor = (userId: string, role: string) => jwt.sign({ userId, role }, SECRET);

describe('authMiddleware', () => {
  it('rejects a request with no Authorization header', () => {
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a header that is not a Bearer token', () => {
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(mockReq({ authorization: 'Basic abc123' }), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token signed with the wrong secret', () => {
    const forged = jwt.sign({ userId: 'u1', role: 'ADMIN' }, 'not-the-real-secret');
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(mockReq({ authorization: `Bearer ${forged}` }), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({ userId: 'u1', role: 'ADMIN' }, SECRET, { expiresIn: '-1s' });
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(mockReq({ authorization: `Bearer ${expired}` }), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a valid token and attaches the identity', () => {
    const req = mockReq({ authorization: `Bearer ${tokenFor('user-1', 'DESK2')}` });
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    // The identity is forwarded to the Python service, which attributes decisions to it.
    // An approval with nobody's name on it is not much of an approval.
    expect(req.userId).toBe('user-1');
    expect(req.userRole).toBe('DESK2');
  });
});

describe('requireRole', () => {
  it('lets an ADMIN through an ADMIN-only route', () => {
    const res = mockRes();
    const next = vi.fn();

    requireRole('ADMIN')(mockReq({}, { userId: 'u1', userRole: 'ADMIN' }), res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks DESK2 from an ADMIN-only route', () => {
    // DESK2 uploads, processes, retries and reads everything. It must not be able to
    // approve funding, resolve the duplicate gate, or delete a proposal.
    const res = mockRes();
    const next = vi.fn();

    requireRole('ADMIN')(mockReq({}, { userId: 'u2', userRole: 'DESK2' }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a role that is one of several permitted', () => {
    const res = mockRes();
    const next = vi.fn();

    requireRole('ADMIN', 'DESK2')(mockReq({}, { userId: 'u2', userRole: 'DESK2' }), res, next);

    expect(next).toHaveBeenCalled();
  });

  it('rejects a request carrying no role at all', () => {
    // requireRole always runs after authMiddleware, so a missing role means something is
    // wired wrong. Fail closed, not open.
    const res = mockRes();
    const next = vi.fn();

    requireRole('ADMIN')(mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
