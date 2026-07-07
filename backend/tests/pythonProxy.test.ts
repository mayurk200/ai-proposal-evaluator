/**
 * Tests for src/utils/pythonProxy.ts — response mapping & health check.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mapPythonResponseToLegacy,
  checkPythonServiceHealth,
  evaluateBatchWithPythonService,
  evaluateWithPythonService,
  listEvaluationReports,
  compareEvaluationReports,
} from '../src/utils/pythonProxy';

// Build a full mock Python response
function mockPythonResponse(): any {
  return {
    status: 'success',
    document_metadata: {
      filename: 'proposal.pdf',
      format: 'pdf',
      file_size_bytes: 1024,
      total_pages: 5,
      total_words: 2500,
      total_chunks: 3,
      total_images: 1,
      total_tables: 2,
      has_scanned_content: false,
      detected_sections: ['Intro', 'Solution'],
      processing_time_seconds: 2.5,
    },
    evaluation: {
      overall_score: 72,
      innovation_score: 80,
      market_score: 65,
      agriculture_score: 70,
      financial_score: 55,
      scalability_score: 60,
      sustainability_score: 50,
      risk_score: 45,
      technical_score: 75,
      feasibility_score: 68,
      compliance_score: 62,
      recommendation: 'Conditionally Recommended',
      summary: 'A promising proposal with some gaps.',
      strengths: ['Strong team', 'Innovative approach'],
      weaknesses: ['Weak financials'],
      swot_analysis: {
        strengths: ['Tech'],
        weaknesses: ['Budget'],
        opportunities: ['Market'],
        threats: ['Competition'],
      },
      key_points: ['Key point 1'],
      invalid_claims: [],
      investment_readiness: 'Moderate',
      key_action_items: ['Fix financials'],
      risk_level: 'Medium',
    },
    agent_results: {
      technical: { score: 75, status: 'success' },
      financial: { score: 55, status: 'success' },
    },
    processing_time_seconds: 12.5,
  };
}

describe('mapPythonResponseToLegacy', () => {
  it('maps all score fields', () => {
    const response = mockPythonResponse();
    const result = mapPythonResponseToLegacy(response);

    expect(result.finalScore.overall_score).toBe(72);
    expect(result.finalScore.innovation_score).toBe(80);
    expect(result.finalScore.financial_score).toBe(55);
    expect(result.finalScore.recommendation).toBe('Conditionally Recommended');
  });

  it('maps SWOT analysis', () => {
    const response = mockPythonResponse();
    const result = mapPythonResponseToLegacy(response);

    expect(result.finalScore.swot_analysis.strengths).toContain('Tech');
    expect(result.finalScore.swot_analysis.threats).toContain('Competition');
  });

  it('passes through agent results', () => {
    const response = mockPythonResponse();
    const result = mapPythonResponseToLegacy(response);

    expect(result.agentResults.technical.score).toBe(75);
  });

  it('maps strengths and weaknesses arrays', () => {
    const response = mockPythonResponse();
    const result = mapPythonResponseToLegacy(response);

    expect(result.finalScore.strengths).toEqual(['Strong team', 'Innovative approach']);
    expect(result.finalScore.weaknesses).toEqual(['Weak financials']);
  });

  it('maps investment readiness and action items', () => {
    const response = mockPythonResponse();
    const result = mapPythonResponseToLegacy(response);

    expect(result.finalScore.investment_readiness).toBe('Moderate');
    expect(result.finalScore.key_action_items).toEqual(['Fix financials']);
  });
});

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

describe('evaluateBatchWithPythonService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends all files to the batch endpoint and returns response', async () => {
    const mockResp = {
      status: 'success',
      batch_id: 'batch-1',
      total_files: 2,
      completed: 2,
      failed: 0,
      results: [
        { evaluation_id: 'eval-1', filename: 'a.pdf', status: 'completed', overall_score: 80 },
        { evaluation_id: 'eval-2', filename: 'b.pdf', status: 'completed', overall_score: 70 },
      ],
    };
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResp,
    });

    const result = await evaluateBatchWithPythonService([
      { buffer: Buffer.from('a'), originalname: 'a.pdf', mimetype: 'application/pdf' },
      { buffer: Buffer.from('b'), originalname: 'b.pdf', mimetype: 'application/pdf' },
    ]);

    expect(result.batch_id).toBe('batch-1');
    expect(result.results).toHaveLength(2);
    expect((fetch as any)).toHaveBeenCalledOnce();
    expect((fetch as any).mock.calls[0][0]).toBe('http://localhost:8000/api/v1/evaluate-batch');
  });
});
