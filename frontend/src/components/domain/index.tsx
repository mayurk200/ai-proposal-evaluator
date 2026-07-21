import React from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  CircleDashed,
  Copy,
  FileSearch,
  Loader2,
  Quote,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui';
import {
  cn,
  SCORE_FAIR,
  SCORE_GOOD,
  scoreBgClass,
  scoreTextClass,
} from '@/utils';
import type {
  Citation,
  ParameterResult,
  ParameterStatus,
  ProposalStatus,
  ReviewDecision,
} from '@/types';

// ===========================================================================
// Scores
// ===========================================================================

// Re-exported under their old names so the thresholds live in one file. They
// used to be defined here at 70/45 and again in utils at 80/60, so the same
// score rendered amber in a list and green on the detail page.
export const scoreColour = scoreTextClass;
const scoreBg = scoreBgClass;

/**
 * A parameter score. Three states, three different renderings, never collapsed:
 *
 *   a number        — we assessed it.
 *   "Not addressed" — the proposal is silent. A finding about the APPLICANT.
 *   "Not assessed"  — our agent failed. A fact about US, and the applicant must not be
 *                     shown as having a gap they do not have.
 *
 * None of them is ever rendered as zero — zero means "they answered, and it was
 * terrible", which is a different and far more damaging claim.
 */
export const ScoreValue: React.FC<{
  score: number | null;
  status?: ParameterStatus;
  className?: string;
}> = ({ score, status = 'scored', className }) => {
  if (status === 'failed') {
    return (
      <span className={cn('text-sm italic text-red-400', className)}>Not assessed</span>
    );
  }
  if (score === null) {
    return (
      <span className={cn('text-sm italic text-gray-400', className)}>Not addressed</span>
    );
  }
  return (
    <span className={cn('font-semibold tabular-nums', scoreColour(score), className)}>
      {score.toFixed(1)}
    </span>
  );
};

export const ScoreBar: React.FC<{ score: number | null; className?: string }> = ({
  score,
  className,
}) => (
  <div className={cn('h-1.5 w-full rounded-full bg-gray-100 overflow-hidden', className)}>
    {score !== null && (
      <div
        className={cn('h-full rounded-full transition-all duration-700', scoreBg(score))}
        style={{ width: `${Math.min(score, 100)}%` }}
      />
    )}
  </div>
);

/** The headline number. */
export const ScoreRing: React.FC<{ score: number; size?: number }> = ({
  score,
  size = 88,
}) => {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(score, 100) / 100);

  const stroke =
    score >= SCORE_GOOD ? '#059669' : score >= SCORE_FAIR ? '#d97706' : '#dc2626';

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="#f1f1f0" strokeWidth={6}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={stroke} strokeWidth={6} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-xl font-bold tabular-nums', scoreColour(score))}>
          {score.toFixed(0)}
        </span>
        <span className="text-[10px] text-text-muted">/100</span>
      </div>
    </div>
  );
};

// ===========================================================================
// Status
// ===========================================================================

const STATUS_META: Record<
  ProposalStatus,
  { label: string; icon: React.ElementType; className: string }
> = {
  uploaded:       { label: 'Uploaded',        icon: Clock,         className: 'bg-gray-100 text-gray-600' },
  extracting:     { label: 'Extracting',      icon: Loader2,       className: 'bg-blue-50 text-blue-700' },
  extracted:      { label: 'Extracted',       icon: FileSearch,    className: 'bg-blue-50 text-blue-700' },
  metadata_ready: { label: 'Metadata ready',  icon: CircleDashed,  className: 'bg-blue-50 text-blue-700' },
  pending_review: { label: 'Possible duplicate', icon: Copy,       className: 'bg-amber-50 text-amber-700' },
  queued:         { label: 'Ready to evaluate', icon: CircleDashed, className: 'bg-indigo-50 text-indigo-700' },
  evaluating:     { label: 'Evaluating',      icon: Loader2,       className: 'bg-indigo-50 text-indigo-700' },
  evaluated:      { label: 'Evaluated',       icon: CheckCircle2,  className: 'bg-emerald-50 text-emerald-700' },
  failed:         { label: 'Failed',          icon: XCircle,       className: 'bg-red-50 text-red-700' },
  skipped:        { label: 'Skipped as duplicate', icon: Ban,      className: 'bg-gray-100 text-gray-500' },
};

export const StatusBadge: React.FC<{ status: ProposalStatus; className?: string }> = ({
  status,
  className,
}) => {
  const meta = STATUS_META[status] ?? STATUS_META.uploaded;
  const Icon = meta.icon;
  const spinning = status === 'extracting' || status === 'evaluating';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap',
        meta.className,
        className,
      )}
    >
      <Icon className={cn('w-3.5 h-3.5', spinning && 'animate-spin')} />
      {meta.label}
    </span>
  );
};

/**
 * A score in a table cell.
 *
 * Compact on purpose — this appears once per row on a page of fifty. The three
 * non-numeric states are still never collapsed into a zero: an unevaluated idea
 * reads as a dash, not as a failing grade.
 */
export const ScoreCell: React.FC<{
  score: number | null;
  recommendation?: string | null;
}> = ({ score, recommendation }) => {
  if (score === null) {
    return <span className="text-sm text-text-muted">—</span>;
  }

  return (
    <span
      className="inline-flex items-baseline gap-1"
      title={recommendation ?? undefined}
    >
      <span className={cn('text-sm font-semibold tabular-nums', scoreColour(score))}>
        {score.toFixed(0)}
      </span>
      <span className="text-[10px] text-text-muted">/100</span>
    </span>
  );
};

/**
 * How a proposal stands with respect to duplicates.
 *
 * Rendered only when it is not the boring answer. A row that reads
 * "approved_for_eval" on every line teaches the eye to skip the column, and
 * then the one row that says "duplicate" gets skipped too.
 */
export const DuplicateBadge: React.FC<{ decision: ReviewDecision }> = ({ decision }) => {
  if (decision === 'approved_for_eval') return null;

  return decision === 'pending' ? (
    <Badge tone="warning" size="sm" icon={Copy}>
      Possible duplicate
    </Badge>
  ) : (
    <Badge tone="neutral" size="sm" icon={Ban}>
      Duplicate
    </Badge>
  );
};

export const RecommendationBadge: React.FC<{ recommendation: string }> = ({
  recommendation,
}) => {
  const tone =
    recommendation === 'Highly Recommended'
      ? 'bg-emerald-100 text-emerald-800'
      : recommendation === 'Recommended'
        ? 'bg-teal-100 text-teal-800'
        : recommendation === 'Conditionally Recommended'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-red-100 text-red-800';

  return (
    <span className={cn('inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold', tone)}>
      {recommendation}
    </span>
  );
};

export const DecisionBadge: React.FC<{ decision: string }> = ({ decision }) => {
  const meta: Record<string, { label: string; className: string; icon: React.ElementType }> = {
    approved:             { label: 'Approved',   className: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
    selected_for_funding: { label: 'Selected for funding', className: 'bg-violet-100 text-violet-800', icon: CheckCircle2 },
    rejected:             { label: 'Rejected',   className: 'bg-red-100 text-red-800', icon: XCircle },
    unselected:           { label: 'De-selected', className: 'bg-gray-100 text-gray-600', icon: Ban },
  };
  const m = meta[decision] ?? { label: decision, className: 'bg-gray-100 text-gray-600', icon: CircleDashed };
  const Icon = m.icon;

  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold', m.className)}>
      <Icon className="w-3.5 h-3.5" />
      {m.label}
    </span>
  );
};

// ===========================================================================
// Evidence
// ===========================================================================

/**
 * A verbatim quote from the proposal.
 *
 * Set apart visually on purpose: a reader must be able to tell at a glance which words
 * came from the applicant and which are the system's. Quotes that could not be found in
 * the source document were discarded before this point and never contributed to a score.
 */
export const CitationBlock: React.FC<{ citation: Citation }> = ({ citation }) => (
  <blockquote className="mt-1.5 flex gap-2 rounded-lg border-l-2 border-primary/40 bg-accent-light/40 px-3 py-2">
    <Quote className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary/50" />
    <div className="min-w-0">
      <p className="text-[13px] leading-relaxed text-text-secondary italic">
        “{citation.quote}”
      </p>
      {citation.section && (
        <p className="mt-1 text-[11px] text-text-muted">
          section: {citation.section}
          {citation.page ? ` · page ${citation.page}` : ''}
        </p>
      )}
    </div>
  </blockquote>
);

/** One parameter, with every sub-score and the quotes behind it. Requirement (b). */
export const ParameterCard: React.FC<{ parameter: ParameterResult }> = ({ parameter }) => {
  const failed = parameter.status === 'failed';
  const unevidenced = parameter.status === 'unevidenced';

  return (
    <div
      className={cn(
        'rounded-xl border bg-white/70 p-4',
        failed ? 'border-red-200' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-text">{parameter.parameter_name}</h4>
          <p className="mt-0.5 text-xs text-text-muted">
            weight {(parameter.weight * 100).toFixed(0)}%
            {!failed && (
              <> · evidence {(parameter.evidence_coverage * 100).toFixed(0)}%</>
            )}
            {parameter.sections_seen.length > 0 && (
              <> · read {parameter.sections_seen.join(', ')}</>
            )}
          </p>
        </div>
        <div className="text-right">
          <ScoreValue
            score={parameter.parameter_score}
            status={parameter.status}
            className="text-lg"
          />
        </div>
      </div>

      {!failed && <ScoreBar score={parameter.parameter_score} className="mt-3" />}

      {/* Our failure — emphatically not the applicant's. */}
      {failed && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-500" />
          <div>
            <p className="text-xs font-medium text-red-800">
              We could not assess this — a technical failure on our side.
            </p>
            <p className="mt-0.5 text-xs text-red-700/80">
              This is not a gap in the proposal, and the applicant is not penalised for it.
              Re-run the evaluation to fill it in.
            </p>
            {parameter.error && (
              <p className="mt-1 break-words text-[11px] text-red-600/70">
                {parameter.error}
              </p>
            )}
          </div>
        </div>
      )}

      {unevidenced && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
          <p className="text-xs text-text-muted">
            The proposal does not address this at all. It is excluded from the weighted
            score rather than counted as zero — silence is not the same as a bad answer.
          </p>
        </div>
      )}

      <div className="mt-3 space-y-3">
        {parameter.sub_questions.map((sq) => (
          <div key={sq.question_id} className="border-t border-border/60 pt-3">
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  'mt-0.5 inline-flex h-6 min-w-[2.75rem] items-center justify-center rounded-md px-1.5 text-[11px] font-semibold tabular-nums',
                  sq.evidence_found && sq.score !== null
                    ? 'bg-accent-light text-primary'
                    : 'bg-gray-100 text-gray-400',
                )}
              >
                {sq.evidence_found && sq.score !== null ? `${sq.score.toFixed(1)}` : '—'}
              </span>
              <p className="text-[13px] leading-snug text-text">{sq.question}</p>
            </div>

            {sq.evidence_found ? (
              <div className="ml-[3.25rem]">
                {sq.citations.map((c, i) => (
                  <CitationBlock key={i} citation={c} />
                ))}
                {sq.justification && (
                  <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
                    {sq.justification}
                  </p>
                )}
              </div>
            ) : (
              <p className="ml-[3.25rem] mt-1 text-xs italic text-text-muted">
                Not addressed in the proposal.
              </p>
            )}
          </div>
        ))}
      </div>

      {parameter.red_flags.length > 0 && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-red-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            Red flags
          </p>
          <ul className="space-y-0.5">
            {parameter.red_flags.map((flag, i) => (
              <li key={i} className="text-xs text-red-700/90">
                · {flag}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// ===========================================================================
// Layout helpers
// ===========================================================================

export const StatTile: React.FC<{
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'warning' | 'danger' | 'success';
  onClick?: () => void;
}> = ({ icon: Icon, label, value, hint, tone = 'default', onClick }) => {
  const tones = {
    default: 'text-text-secondary bg-gray-100',
    warning: 'text-amber-700 bg-amber-100',
    danger: 'text-red-700 bg-red-100',
    success: 'text-emerald-700 bg-emerald-100',
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        'glass-card-static rounded-2xl p-4',
        onClick && 'cursor-pointer transition-shadow hover:shadow-md',
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-xl', tones[tone])}>
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-text-muted">{label}</p>
          <p className="text-xl font-bold leading-tight text-text tabular-nums">{value}</p>
        </div>
      </div>
      {hint && <p className="mt-2 text-[11px] leading-snug text-text-muted">{hint}</p>}
    </div>
  );
};

export const EmptyState: React.FC<{
  icon: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ icon: Icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-14 text-center">
    <Icon className="mb-3 h-8 w-8 text-text-muted" />
    <p className="text-sm font-medium text-text">{title}</p>
    {description && (
      <p className="mt-1 max-w-sm text-xs text-text-muted">{description}</p>
    )}
    {action && <div className="mt-4">{action}</div>}
  </div>
);
