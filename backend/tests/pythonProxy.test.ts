/**
 * Tests for src/utils/pythonProxy.ts — retry behavior, health check, reports proxy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkPythonServiceHealth,
  evaluateWithPythonService,
  listEvaluationReports,
  compareEvaluationReports,
} from '../src/utils/pythonProxy';

// Minimal mock of a successful Python /evaluate response.
function mockPythonResponse(): any {
  return {
    status: 'success',
    document_metadata: { filename: 'proposal.pdf', format: 'pdf' },
    evaluation: { overall_score: 72, recommendation: 'Conditionally Recommended' },
    agent_results: {},
    processing_time_seconds: 12.5,
  };
}

describe('checkPythonServiceHealth', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when service is healthy', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: true });
    const result = await checkPythonServiceHealth();
    expect(result).toBe(true);
  });

  it('returns false when service is unhealthy', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: false });
    const result = await checkPythonServiceHealth();
    expect(result).toBe(false);
  });

  it('returns false on network error', async () => {
    (fetch as any).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await checkPythonServiceHealth();
    expect(result).toBe(false);
  });
});

describe('evaluateWithPythonService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends file and returns response', async () => {
    const mockResp = mockPythonResponse();
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResp,
    });

    const result = await evaluateWithPythonService(
      Buffer.from('test'),
      'test.pdf',
      'application/pdf',
    );

    expect(result.status).toBe('success');
    expect(result.evaluation.overall_score).toBe(72);
    expect((fetch as any)).toHaveBeenCalledOnce();
  });

  it('throws on non-ok response', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => '{"detail":"Internal error"}',
    });

    await expect(
      evaluateWithPythonService(Buffer.from('test'), 'test.pdf', 'application/pdf'),
    ).rejects.toThrow('Python service error (500)');
  });

  it('throws on network error', async () => {
    (fetch as any).mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(
      evaluateWithPythonService(Buffer.from('test'), 'test.pdf', 'application/pdf'),
    ).rejects.toThrow('Python service communication failed');
  });

  it('attaches proposal_id and force form fields when provided', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockPythonResponse(),
    });

    await evaluateWithPythonService(
      Buffer.from('test'),
      'test.pdf',
      'application/pdf',
      true,
      { proposalId: 'prop-1', force: true },
    );

    const body = (fetch as any).mock.calls[0][1].body as FormData;
    expect(body.get('proposal_id')).toBe('prop-1');
    expect(body.get('force')).toBe('true');
  });
});

describe('listEvaluationReports', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the reports list with query params', async () => {
    const mockList = {
      evaluations: [
        { id: 'r1', filename: 'a.pdf', overall_score: 80, recommendation: 'Recommended', status: 'completed' },
      ],
      total: 1,
      page: 1,
      limit: 50,
      total_pages: 1,
    };
    (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => mockList });

    const result = await listEvaluationReports({ limit: 50, status: 'completed' });

    expect(result.total).toBe(1);
    expect(result.evaluations[0].id).toBe('r1');
    expect((fetch as any).mock.calls[0][0]).toBe(
      'http://localhost:8000/api/v1/reports?limit=50&status=completed'
    );
  });
});

describe('compareEvaluationReports', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts report ids and returns reports + comparison', async () => {
    const mockCompare = {
      reports: [{ id: 'r1' }, { id: 'r2' }],
      comparison: { ranking: [{ rank: 1, id: 'r2', filename: 'b.pdf', score: 90 }] },
    };
    (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => mockCompare });

    const result = await compareEvaluationReports(['r1', 'r2']);

    expect(result.reports).toHaveLength(2);
    expect(result.comparison.ranking[0].id).toBe('r2');
    const call = (fetch as any).mock.calls[0];
    expect(call[0]).toBe('http://localhost:8000/api/v1/reports/compare');
    expect(JSON.parse(call[1].body)).toEqual({ report_ids: ['r1', 'r2'] });
  });

  it('throws on a 404 (missing reports)', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => '{"detail":"Found 1 of 2 requested reports"}',
    });

    await expect(compareEvaluationReports(['r1', 'r2'])).rejects.toThrow(
      'Python reports compare error (404)'
    );
  });
});
