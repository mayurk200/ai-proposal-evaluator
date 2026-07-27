// ===========================================================================
// Users & auth
// ===========================================================================

/**
 * ADMIN decides: resolves the duplicate gate, approves/rejects, marks funding.
 * DESK2 uploads, processes, retries and reads everything, but cannot decide.
 */
export type Role = 'ADMIN' | 'DESK2';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  last_login_at?: string | null;
}

export interface AuthResponse {
  user: User;
  token: string;
}

// ===========================================================================
// Proposals
// ===========================================================================

/**
 * The lifecycle of an idea. A proposal holds a row from the moment its bytes land —
 * it is never "successful just because it uploaded".
 */
export type ProposalStatus =
  | 'uploaded'
  | 'extracting'
  | 'extracted'
  | 'metadata_ready'
  | 'pending_review'   // caught by the duplicate gate; an admin must rule
  | 'queued'
  | 'evaluating'
  | 'evaluated'
  | 'failed'
  | 'skipped';         // admin ruled it a duplicate

export type ReviewDecision = 'pending' | 'approved_for_eval' | 'skipped_duplicate';

export interface IdeaMetadata {
  title?: string | null;
  company_name?: string | null;
  category?: string | null;
  theme?: string | null;
  problem_statement?: string | null;
  solution_summary?: string | null;
  target_beneficiaries?: string | null;
  technology_used?: string[];
  trl_level?: number | null;
  districts?: string[];
  confidence?: number;
}

export interface Proposal {
  id: string;
  filename: string;
  file_format: string;
  file_size_bytes: number;
  content_type: string;

  title: string | null;
  theme: string | null;
  problem_statement: string | null;
  solution_summary: string | null;
  idea_metadata: IdeaMetadata | null;

  company_id: string | null;
  company_name: string | null;
  category_id: string | null;
  category_slug: string | null;
  category_label: string | null;

  status: ProposalStatus;
  is_evaluated: boolean;
  review_decision: ReviewDecision;
  /** Set when an admin ruled this a duplicate of a specific stored idea. */
  duplicate_of_id: string | null;

  /** The current verdict, denormalized onto the row so a list can show and sort
   *  by it without loading every report. Null until evaluated. */
  latest_score: number | null;
  latest_recommendation: string | null;
  latest_evaluation_id: string | null;
  evaluated_at: string | null;

  total_pages: number;
  total_words: number;
  total_tables: number;
  total_images: number;
  has_scanned_content: boolean;
  sections: string[];

  error_message: string | null;
  error_stage: string | null;
  retry_count: number;
  can_retry?: boolean;

  batch_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Paginated {
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface ProposalList extends Paginated {
  proposals: Proposal[];
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

/** Columns the server will sort by. Anything else falls back to newest first. */
export type ProposalSortKey =
  | 'created_at'
  | 'updated_at'
  | 'title'
  | 'filename'
  | 'status'
  | 'score'
  | 'evaluated_at'
  | 'pages'
  | 'words';

// ===========================================================================
// Background work
// ===========================================================================

/**
 * A unit of server-side work.
 *
 * Processing does not happen inside a request any more, so this is how the UI
 * answers "is anything still happening?" after an upload — a question that would
 * otherwise have no answer at all.
 */
export type JobKind = 'ingest' | 'evaluate';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  kind: JobKind;
  proposal_id: string | null;
  batch_id: string | null;
  status: JobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  error: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobList extends Paginated {
  jobs: Job[];
}

export interface QueueStats {
  by_kind: Record<string, Record<string, number>>;
  totals: Record<JobStatus, number>;
  /** Queued + running. The one number worth showing in a header. */
  pending: number;
  oldest_queued_at: string | null;
}

/** What a bulk action actually did. The skipped items are the interesting part. */
export interface BulkResult {
  requested: number;
  queued?: number;
  updated?: number;
  skipped: number;
  queued_items?: Array<{ proposal_id: string; job_id: string }>;
  skipped_items: Array<{ proposal_id: string; title?: string; reason: string }>;
}

// ===========================================================================
// Evidence & evaluation
// ===========================================================================

/** A verbatim quote from the document. Quotes that could not be located in the
 *  source were discarded and never contributed to a score. */
export interface Citation {
  quote: string;
  section: string;
  page?: number | null;
}

export interface SubQuestion {
  question_id: string;
  question: string;
  /** null means the proposal did not address this — NOT that it scored zero. */
  score: number | null;
  evidence_found: boolean;
  citations: Citation[];
  justification: string;
}

/**
 * Why a parameter has no score. The two causes must never be conflated:
 *
 *   unevidenced — the proposal is silent on it. A finding about the APPLICANT.
 *   failed      — our agent broke (rate limit, timeout). A fact about US, and never
 *                 the applicant's fault.
 */
export type ParameterStatus = 'scored' | 'unevidenced' | 'failed';

export interface ParameterResult {
  parameter_name: string;
  parameter_key: string;
  parameter_score: number | null;
  status: ParameterStatus;
  error: string | null;
  weight: number;
  sub_questions: SubQuestion[];
  key_findings: string[];
  red_flags: string[];
  recommendations: string[];
  /** Which document sections the agent was actually shown. Makes routing auditable. */
  sections_seen: string[];
  evidence_coverage: number;
}

export interface SwotAnalysis {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
  /** The continuous prose version — one argument, not four disconnected lists. */
  narrative: string;
}

export interface DebateResult {
  triggered: boolean;
  trigger_reasons: string[];
  conflicts: Array<{ description?: string; resolution?: string; parameters?: string[] }>;
  adjusted_scores: Record<string, number>;
  confidence: number;
}

export interface FinalEvaluation {
  overall_score: number;
  recommendation: string;
  risk_level: string;
  investment_readiness: string;
  summary: string;

  problem_relevance_score: number | null;
  solution_readiness_score: number | null;
  pilot_design_score: number | null;
  farmer_adoption_score: number | null;
  scaleup_score: number | null;
  team_capacity_score: number | null;
  compliance_score: number | null;

  strengths: string[];
  weaknesses: string[];
  swot_analysis: SwotAnalysis;
  key_action_items: string[];
  unsupported_claims: string[];

  /** Parameters the document never addressed. Reported, not scored zero. */
  unevidenced_parameters: string[];
  /** Parameters WE failed to assess. Not the applicant's fault; the evaluation is
   *  partial and should be re-run before anyone is judged on it. */
  failed_parameters: string[];
  /** Share of all sub-questions the document actually answered. */
  evidence_coverage: number;

  parameter_breakdown: Record<string, ParameterResult>;
  debate_summary: DebateResult | null;
}

export interface AgentResult {
  agent_name: string;
  parameter_key: string;
  score: number | null;
  confidence: number;
  analysis: string;
  sections_seen: string[];
  starved: boolean;
  tokens_used: number;
  duration_ms: number;
  status: 'success' | 'failed';
  error: string | null;
}

export interface EvaluationReport {
  evaluation: FinalEvaluation;
  agent_results: Record<string, AgentResult>;
  processing_time_seconds: number;
  total_tokens: number;
  model_used: string;
}

export interface Evaluation {
  id: string;
  proposal_id: string;
  overall_score: number;
  recommendation: string;
  risk_level: string | null;
  parameter_scores: Record<string, number | null> | null;
  status: 'processing' | 'completed' | 'failed';
  error_message: string | null;
  total_tokens: number;
  total_duration_ms: number;
  model_used: string | null;
  created_at: string;
  completed_at: string | null;
  report?: EvaluationReport;
}

// ===========================================================================
// Duplicate gate
// ===========================================================================

export interface SimilarityMatch {
  id: string;
  similarity: number;
  status: 'pending' | 'confirmed_duplicate' | 'dismissed';
  /** Why it was flagged — same company resubmitting, or a different company with
   *  the same idea. Those call for opposite decisions. */
  match_reasons: string[];
  reviewer_note: string | null;
  matched_proposal: Proposal;
}

// ===========================================================================
// Decisions
// ===========================================================================

export type DecisionType =
  | 'approved'
  | 'rejected'
  | 'selected_for_funding'
  | 'unselected';

export interface Decision {
  id: string;
  decision: DecisionType;
  notes: string | null;
  decided_by: string | null;
  decided_at: string;
}

/** What approving this idea would collide with. Surfaced BEFORE the click. */
export interface ApprovalConflict {
  type: 'category_already_approved' | 'company_already_approved';
  severity: string;
  message: string;
  category?: string;
  company?: string;
  approved_count: number;
  categories_spanned?: number;
  existing_approvals?: Array<{
    proposal_id: string;
    title: string;
    category: string;
    decision: string;
    year: number;
    month: number;
  }>;
}

export interface CompanyContext {
  company_id: string;
  approved_count: number;
  categories_spanned: number;
  approvals: Array<{
    proposal_id: string;
    title: string;
    category: string;
    decision: string;
    year: number;
    month: number;
  }>;
}

export interface ProposalDetail {
  proposal: Proposal;
  evaluations: Evaluation[];
  latest_evaluation: Evaluation | null;
  decision: Decision | null;
  company_context: CompanyContext | null;
  similar: SimilarityMatch[];
}

// ===========================================================================
// Analytics — requirements (d), (e), (f)
// ===========================================================================

export interface CategoryApprovals {
  category_id: string;
  slug: string;
  label: string;
  approved_count: number;
}

export interface CompanyApprovals {
  company_id: string;
  name: string;
  approved_count: number;
  categories_spanned: number;
  /** The flag requirement (e) exists to surface: one company winning across domains. */
  multi_category: boolean;
}

export interface TimelinePoint {
  year: number;
  month: number;
  period: string;
  category?: string;
  company?: string;
  approved_count: number;
}

export interface PipelineStage {
  key: ProposalStatus | string;
  label: string;
  count: number;
}

export interface AnalyticsOverview {
  totals: {
    total: number;
    evaluated: number;
    not_evaluated: number;
    /** Not evaluated, not a duplicate, not awaiting a ruling — actionable today. */
    ready_to_evaluate: number;
    awaiting_review: number;
    marked_duplicate: number;
    failed: number;
    approved: number;
    categories: number;
    companies: number;
  };
  queue: QueueStats;
  pipeline: PipelineStage[];
  by_category: CategoryApprovals[];
  by_company: CompanyApprovals[];
  timeline: TimelinePoint[];
  multi_category_companies: CompanyApprovals[];
}

export interface ScoreDistribution {
  scored: number;
  average: number | null;
  median: number | null;
  lowest: number | null;
  highest: number | null;
  bands: Array<{ band: string; count: number }>;
  by_recommendation: Array<{ recommendation: string; count: number }>;
}

export interface CategoryScores {
  category_id: string;
  label: string;
  evaluated_count: number;
  average_score: number | null;
  lowest: number | null;
  highest: number | null;
}

export interface ScoreAnalytics {
  distribution: ScoreDistribution;
  by_category: CategoryScores[];
  /** Strongest ideas with no decision recorded — a worklist, not a leaderboard. */
  top_undecided: Array<{
    proposal_id: string;
    title: string;
    score: number;
    recommendation: string | null;
    category: string | null;
  }>;
}

export interface ThroughputPoint {
  period: string;
  received: number;
  evaluated: number;
}

export interface OperationsAnalytics {
  operations: {
    evaluations_completed: number;
    evaluations_failed: number;
    evaluations_in_flight: number;
    total_tokens: number;
    average_tokens_per_evaluation: number;
    average_seconds_per_evaluation: number;
    average_evidence_coverage: number | null;
    model: string | null;
    failures_by_stage: Array<{ stage: string; count: number }>;
  };
  duplicates: {
    flagged_by_gate: number;
    confirmed_duplicates: number;
    awaiting_review: number;
    dismissed_as_distinct: number;
    /** Null when nothing has been evaluated yet — no average to estimate from. */
    estimated_tokens_saved: number | null;
  };
  queue: QueueStats;
}

// ===========================================================================
// System
// ===========================================================================

export interface SystemInfo {
  environment: string;
  services: Record<string, string>;
  queue: QueueStats;
  evaluation: {
    model: string;
    fast_model: string;
    provider: string;
    api_key_configured: boolean;
    tokens_per_minute: number;
    max_concurrency: number;
    max_retries: number;
  };
  ingestion: {
    max_file_size_mb: number;
    supported_formats: string[];
    ocr_enabled: boolean;
  };
  duplicate_gate: {
    similarity_threshold: number;
    candidates_considered: number;
    embedding_model: string;
  };
  worker: {
    enabled: boolean;
    ingest_slots: number;
    evaluate_slots: number;
  };
}

// ===========================================================================
// Batch
// ===========================================================================

export interface BatchStatus {
  batch_id: string;
  total: number;
  by_status: Record<string, number>;
  evaluated: number;
  awaiting_review: number;
  failed: number;
  /** Still moving through the pipeline — not yet in a terminal state. */
  in_progress: number;
  proposals: Proposal[];
}

/** What queueing a whole batch actually did. */
export interface BatchEvaluateResult {
  batch_id: string;
  total: number;
  queued: number;
  awaiting_review: number;
  skipped_as_duplicate: number;
  already_evaluated: number;
  results: Array<{ proposal_id: string; filename: string; job_id: string }>;
}

export interface IngestResult {
  batch_id: string | null;
  total: number;
  accepted: number;
  duplicates: number;
  proposals: Array<{
    proposal_id: string;
    filename: string;
    status: string;
    deduplicated?: boolean;
    error?: string;
  }>;
}

// ===========================================================================
// API envelope
// ===========================================================================

export interface ApiResponse<T> {
  status: 'success' | 'error';
  data: T;
  message?: string;
}

export interface Category {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  created_at: string;
}
