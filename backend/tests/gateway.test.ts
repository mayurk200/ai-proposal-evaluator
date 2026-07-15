/**
 * The gateway's two remaining jobs: accepting uploads, and proxying to Python.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// ---------------------------------------------------------------------------
// Upload filter
// ---------------------------------------------------------------------------

describe('upload file filter', () => {
  /**
   * The filter validates on EXTENSION, not on the browser-supplied MIME type.
   *
   * The previous version was a MIME allowlist, and browsers report .docx as
   * application/zip (and .doc as application/octet-stream) often enough that it rejected
   * perfectly valid proposals. Python re-checks the real content type from the bytes, so
   * this is only a cheap first gate.
   */
  const ALLOWED = ['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.txt', '.png', '.jpg', '.jpeg', '.tiff', '.bmp'];

  const accepts = (filename: string) => ALLOWED.includes(path.extname(filename).toLowerCase());

  it.each(['proposal.pdf', 'proposal.docx', 'deck.pptx', 'notes.txt', 'scan.png', 'scan.JPEG'])(
    'accepts %s',
    (name) => {
      expect(accepts(name)).toBe(true);
    },
  );

  it.each(['payload.exe', 'archive.zip', 'sheet.xlsx', 'noextension'])(
    'rejects %s',
    (name) => {
      expect(accepts(name)).toBe(false);
    },
  );

  it('accepts a .docx regardless of what the browser calls its MIME type', () => {
    // Chrome frequently sends application/zip for .docx. A MIME allowlist would reject
    // this, and did.
    expect(accepts('proposal.docx')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Python proxy
// ---------------------------------------------------------------------------

describe('pythonProxy', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function jsonResponse(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      json: async () => body,
      headers: new Headers(),
    } as unknown as Response;
  }

  it('returns the parsed body on success', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { hello: 'world' }));

    const { callPythonJson } = await import('../src/utils/pythonProxy');
    await expect(callPythonJson('/api/v1/health')).resolves.toEqual({ hello: 'world' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('fails fast on a 4xx instead of retrying it', async () => {
    // A 404 or a 400 will fail identically on a retry. Burning the caller's time —
    // and, on an evaluation, minutes of backoff — achieves nothing.
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(404, { detail: 'Proposal not found' }));

    const { callPythonJson } = await import('../src/utils/pythonProxy');

    await expect(callPythonJson('/api/v1/proposals/nope')).rejects.toThrow('Proposal not found');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and succeeds', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { detail: 'starting up' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const { callPythonJson } = await import('../src/utils/pythonProxy');

    await expect(callPythonJson('/api/v1/health', { retries: 2 })).resolves.toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('surfaces a 503 when Python never recovers', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(502, { detail: 'bad gateway' }));

    const { callPythonJson } = await import('../src/utils/pythonProxy');

    await expect(callPythonJson('/api/v1/health', { retries: 1 })).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('preserves the structured detail of an approval conflict', async () => {
    // A 409 from the decision endpoint carries the LIST of conflicting approvals, and the
    // UI needs it to show the evaluator which other idea already holds the category.
    // Flattening it to a string would leave them with "[object Object]".
    const conflicts = [
      {
        type: 'category_already_approved',
        category: 'Precision Irrigation',
        approved_count: 1,
        message: '1 idea(s) in "Precision Irrigation" have already been approved.',
      },
    ];

    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse(409, { detail: { message: 'conflicts found', conflicts } }),
    );

    const { callPythonJson } = await import('../src/utils/pythonProxy');

    // Asserted on shape rather than `instanceof AppError`: vi.resetModules() gives the
    // proxy its own module instance, so the class object it throws is not identical to
    // the one imported here. What matters is the status, the message, and the payload.
    await expect(
      callPythonJson('/api/v1/proposals/p1/decision', { method: 'POST' }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'conflicts found',
      details: { conflicts },
    });
  });

  it('reports the AI service as unavailable rather than silently falling back', async () => {
    // There is no Node-side evaluation pipeline any more. When Python is down, the only
    // honest answer is to say so — the old fallback scored against a different rubric and
    // produced numbers that were not comparable to anything else in the database.
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const { checkPythonServiceHealth, assertPythonAvailable } = await import(
      '../src/utils/pythonProxy'
    );

    await expect(checkPythonServiceHealth()).resolves.toBe(false);
    await expect(assertPythonAvailable()).rejects.toMatchObject({ statusCode: 503 });
  });
});
