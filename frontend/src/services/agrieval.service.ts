import api from './api';
import type {
  AnalyticsOverview,
  ApiResponse,
  ApprovalConflict,
  BatchEvaluateResult,
  BatchStatus,
  BulkResult,
  Category,
  CategoryApprovals,
  CompanyApprovals,
  DecisionType,
  Evaluation,
  IngestResult,
  Job,
  JobList,
  OperationsAnalytics,
  ProposalDetail,
  ProposalList,
  ProposalSortKey,
  QueueStats,
  ScoreAnalytics,
  SystemInfo,
  ThroughputPoint,
  TimelinePoint,
} from '@/types';

/**
 * Everything under /api is proxied by the Node gateway to the Python service, which
 * owns proposals, evaluations, decisions and analytics. The gateway stamps the
 * authenticated identity on the way through, so a decision is always attributable.
 */

const unwrap = <T,>(res: { data: ApiResponse<T> }) => res.data.data;

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export interface ProposalFilters {
  page?: number;
  limit?: number;
  /** One status, or several comma-separated. */
  status?: string;
  review_decision?: string;
  is_evaluated?: boolean;
  category_id?: string;
  company_id?: string;
  batch_id?: string;
  search?: string;
  /** Hide the ideas an admin has ruled duplicates. */
  exclude_duplicates?: boolean;
  sort_by?: ProposalSortKey;
  sort_order?: 'asc' | 'desc';
}

export const proposalApi = {
  list: (filters: ProposalFilters = {}) =>
    api
      .get<ApiResponse<ProposalList>>('/proposals', { params: filters })
      .then(unwrap),

  get: (id: string) =>
    api.get<ApiResponse<ProposalDetail>>(`/proposals/${id}`).then(unwrap),

  /**
   * Upload one or many documents. Batch upload is the same call — the server groups
   * them under a batch_id and processes each independently, so one bad PDF in a set of
   * twenty fails only itself.
   *
   * Returns as soon as the bytes are stored; extraction, metadata and the duplicate
   * check run in the background. Poll the list to watch them progress.
   */
  upload: (files: File[], onProgress?: (percent: number) => void) => {
    const form = new FormData();
    files.forEach((file) => form.append('files', file));

    return api
      .post<ApiResponse<IngestResult>>('/proposals/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (event) => {
          if (onProgress && event.total) {
            onProgress(Math.round((event.loaded * 100) / event.total));
          }
        },
      })
      .then(unwrap);
  },

  /** Re-run extraction + metadata on a proposal that failed. The original document is
   *  already stored, so a retry costs no re-upload. */
  retryProcessing: (id: string) =>
    api.post<ApiResponse<unknown>>(`/proposals/${id}/retry`).then(unwrap),

  delete: (id: string) =>
    api.delete<ApiResponse<unknown>>(`/proposals/${id}`).then(unwrap),

  /** Authenticated URL for viewing the original document. */
  fileUrl: (id: string, download = false) =>
    `${api.defaults.baseURL}/proposals/${id}/file${download ? '?download=1' : ''}`,

  /**
   * Open the original in a new tab.
   *
   * The file route is authenticated, so a bare <a href> would 401 — the JWT lives in a
   * header, not a cookie. We fetch it as a blob with the token attached and hand the
   * browser an object URL.
   */
  openFile: async (id: string) => {
    const res = await api.get(`/proposals/${id}/file`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    window.open(url, '_blank', 'noopener');
    // Give the new tab time to load before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },

  /**
   * Rule an idea a duplicate, or take the ruling back. ADMIN only.
   *
   * Not the same as resolving the similarity gate: this applies to any stored
   * idea, including ones the gate never flagged. Reversible, and the metadata
   * survives either way — the idea stays searchable, it just leaves the working
   * list and never costs an evaluation.
   */
  markDuplicate: (
    id: string,
    isDuplicate: boolean,
    opts: { duplicateOf?: string; note?: string } = {},
  ) =>
    api
      .post<ApiResponse<unknown>>(`/proposals/${id}/duplicate`, {
        is_duplicate: isDuplicate,
        duplicate_of: opts.duplicateOf,
        note: opts.note,
      })
      .then(unwrap),

  bulkMarkDuplicate: (ids: string[], isDuplicate: boolean, note?: string) =>
    api
      .post<ApiResponse<BulkResult>>('/proposals/bulk/duplicate', {
        proposal_ids: ids,
        is_duplicate: isDuplicate,
        note,
      })
      .then(unwrap),
};

// ---------------------------------------------------------------------------
// The duplicate gate
// ---------------------------------------------------------------------------

export const reviewApi = {
  queue: (page = 1, limit = 20) =>
    api
      .get<ApiResponse<ProposalList>>('/review-queue', { params: { page, limit } })
      .then(unwrap),

  /**
   * Resolve the gate. `evaluate: false` marks it a duplicate and skips it — the
   * metadata is kept either way, so the idea stays searchable.
   */
  resolve: (id: string, evaluate: boolean, note?: string) =>
    api
      .post<ApiResponse<unknown>>(`/proposals/${id}/review`, { evaluate, note })
      .then(unwrap),
};

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface QueuedEvaluation {
  proposal_id: string;
  job_id: string;
  status: 'queued';
  already_queued?: boolean;
}

export const evaluationApi = {
  /**
   * Queue the agent pipeline.
   *
   * Returns as soon as the work is recorded, not when it finishes — an
   * evaluation is minutes of paced LLM calls and the server runs it whether or
   * not this browser is still open. Watch the proposal's status for the result.
   */
  run: (proposalId: string, force = false) =>
    api
      .post<ApiResponse<QueuedEvaluation>>(`/proposals/${proposalId}/evaluate`, { force })
      .then(unwrap),

  /** Queue evaluations for many proposals. Reports which were skipped and why. */
  runMany: (proposalIds: string[], force = false) =>
    api
      .post<ApiResponse<BulkResult>>('/proposals/bulk/evaluate', {
        proposal_ids: proposalIds,
        force,
      })
      .then(unwrap),

  retry: (proposalId: string) =>
    api
      .post<ApiResponse<QueuedEvaluation>>(`/proposals/${proposalId}/evaluate/retry`)
      .then(unwrap),

  get: (id: string) =>
    api.get<ApiResponse<Evaluation>>(`/evaluations/${id}`).then(unwrap),

  /** Download the report as PDF — carries the cited evidence, not just the numbers. */
  exportPdf: async (id: string, filename: string) => {
    const res = await api.get(`/evaluations/${id}/export`, { responseType: 'blob' });

    const url = URL.createObjectURL(res.data as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  },

  retryQueue: (page = 1, limit = 20) =>
    api
      .get<ApiResponse<ProposalList>>('/retry-queue', { params: { page, limit } })
      .then(unwrap),
};

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/** Thrown when an approval collides with an existing one. Carries the detail so the UI
 *  can show exactly what is about to be overridden. */
export class ConflictError extends Error {
  constructor(
    message: string,
    public conflicts: ApprovalConflict[],
  ) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** The shape of a gateway error, as far as the client needs to care. */
interface ApiError {
  response?: { status?: number; data?: { message?: string; details?: unknown } };
}

function rethrowConflict(err: unknown): never {
  const error = err as ApiError;
  if (error?.response?.status === 409) {
    const data = error.response.data;
    const detail = (data?.details ?? data) as
      | { message?: string; conflicts?: ApprovalConflict[] }
      | undefined;
    throw new ConflictError(
      detail?.message ?? 'This approval conflicts with an existing one.',
      detail?.conflicts ?? [],
    );
  }
  throw err;
}

export const decisionApi = {
  /** Read-only: what approving this would collide with. Called before the click. */
  conflicts: (proposalId: string) =>
    api
      .get<ApiResponse<{ conflicts: ApprovalConflict[] }>>(
        `/proposals/${proposalId}/conflicts`,
      )
      .then((r) => unwrap(r).conflicts),

  decide: (
    proposalId: string,
    decision: DecisionType,
    opts: { notes?: string; acknowledgeConflicts?: boolean } = {},
  ) =>
    api
      .post<ApiResponse<unknown>>(`/proposals/${proposalId}/decision`, {
        decision,
        notes: opts.notes,
        acknowledge_conflicts: opts.acknowledgeConflicts ?? false,
      })
      .then(unwrap)
      .catch(rethrowConflict),

  markFunding: (
    proposalId: string,
    selected: boolean,
    opts: { notes?: string; acknowledgeConflicts?: boolean } = {},
  ) =>
    api
      .post<ApiResponse<unknown>>(`/proposals/${proposalId}/funding`, {
        selected,
        notes: opts.notes,
        acknowledge_conflicts: opts.acknowledgeConflicts ?? false,
      })
      .then(unwrap)
      .catch(rethrowConflict),
};

// ---------------------------------------------------------------------------
// Analytics — requirements (d), (e), (f)
// ---------------------------------------------------------------------------

export const analyticsApi = {
  overview: () =>
    api.get<ApiResponse<AnalyticsOverview>>('/analytics/overview').then(unwrap),

  byCategory: (year?: number) =>
    api
      .get<ApiResponse<{ categories: CategoryApprovals[] }>>('/analytics/categories', {
        params: { year },
      })
      .then((r) => unwrap(r).categories),

  byCompany: (year?: number) =>
    api
      .get<ApiResponse<{ companies: CompanyApprovals[] }>>('/analytics/companies', {
        params: { year },
      })
      .then((r) => unwrap(r).companies),

  timeline: (groupBy: 'category' | 'company' = 'category', year?: number) =>
    api
      .get<ApiResponse<{ timeline: TimelinePoint[] }>>('/analytics/timeline', {
        params: { group_by: groupBy, year },
      })
      .then((r) => unwrap(r).timeline),

  categories: () =>
    api
      .get<ApiResponse<{ categories: Category[] }>>('/categories')
      .then((r) => unwrap(r).categories),

  /** The shape of the scoring, plus the strongest ideas nobody has ruled on. */
  scores: () => api.get<ApiResponse<ScoreAnalytics>>('/analytics/scores').then(unwrap),

  /** Ideas received vs ideas scored, by month. The gap is the backlog. */
  throughput: (months = 12) =>
    api
      .get<ApiResponse<{ throughput: ThroughputPoint[] }>>('/analytics/throughput', {
        params: { months },
      })
      .then((r) => unwrap(r).throughput),

  /** Cost, reliability, and what the duplicate gate has saved. */
  operations: () =>
    api.get<ApiResponse<OperationsAnalytics>>('/analytics/operations').then(unwrap),
};

// ---------------------------------------------------------------------------
// The work queue
// ---------------------------------------------------------------------------

/**
 * Since processing left the request cycle, this is the only way the UI can say
 * whether the server is busy or idle. Without it an operator who uploads and
 * walks away has no evidence anything happened.
 */
export const jobApi = {
  list: (params: { page?: number; limit?: number; status?: string; kind?: string } = {}) =>
    api.get<ApiResponse<JobList>>('/jobs', { params }).then(unwrap),

  stats: () => api.get<ApiResponse<QueueStats>>('/jobs/stats').then(unwrap),

  get: (id: string) => api.get<ApiResponse<Job>>(`/jobs/${id}`).then(unwrap),

  /** Only a job that has not started can be cancelled — a running one is
   *  already spending tokens, and killing it leaves half an evaluation. */
  cancel: (id: string) =>
    api.post<ApiResponse<unknown>>(`/jobs/${id}/cancel`).then(unwrap),
};

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export const systemApi = {
  info: () => api.get<ApiResponse<SystemInfo>>('/system').then(unwrap),
};

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

export const batchApi = {
  get: (batchId: string) =>
    api.get<ApiResponse<BatchStatus>>(`/batches/${batchId}`).then(unwrap),

  /** Queues every proposal in the batch that has cleared the duplicate gate.
   *  Anything still awaiting a ruling is skipped, not driven through. */
  evaluate: (batchId: string) =>
    api.post<ApiResponse<BatchEvaluateResult>>(`/batches/${batchId}/evaluate`).then(unwrap),
};
