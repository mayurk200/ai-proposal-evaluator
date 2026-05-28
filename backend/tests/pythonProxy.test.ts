/**
 * Tests for src/utils/pythonProxy.ts — response mapping & health check.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mapPythonResponseToLegacy, checkPythonServiceHealth, evaluateWithPythonService } from '../src/utils/pythonProxy';

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
      problem_relevance_score: 80,
      technical_soundness_score: 75,
      pilot_design_score: 65,
      team_capability_score: 70,
      market_potential_score: 55,
      financial_sustainability_score: 60,
      strategic_impact_score: 50,
      recommendation: 'Reject',
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
    expect(result.finalScore.problem_relevance_score).toBe(80);
    expect(result.finalScore.financial_sustainability_score).toBe(60);
    expect(result.finalScore.recommendation).toBe('Reject');
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
});
