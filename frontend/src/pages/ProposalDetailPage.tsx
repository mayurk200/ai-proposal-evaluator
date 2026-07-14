import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Ban,
  Building2,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  FolderTree,
  Gauge,
  Landmark,
  Play,
  RotateCcw,
  ScrollText,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button, Skeleton } from '@/components/ui';
import {
  DecisionBadge,
  EmptyState,
  ParameterCard,
  RecommendationBadge,
  ScoreRing,
  StatusBadge,
} from '@/components/domain';
import {
  ConflictError,
  decisionApi,
  evaluationApi,
  proposalApi,
} from '@/services/agrieval.service';
import { useAuthStore } from '@/store/authStore';
import type { ApprovalConflict, DecisionType } from '@/types';

export default function ProposalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore((s) => s.hasRole('ADMIN'));

  const [conflicts, setConflicts] = useState<ApprovalConflict[] | null>(null);
  const [pendingDecision, setPendingDecision] = useState<DecisionType | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['proposal', id],
    queryFn: () => proposalApi.get(id!),
    enabled: !!id,
    // While it is being processed or evaluated, the status changes underneath us.
    refetchInterval: (query) => {
      const status = query.state.data?.proposal.status;
      return status && ['uploaded', 'extracting', 'evaluating'].includes(status)
        ? 5_000
        : false;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['proposal', id] });
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
    queryClient.invalidateQueries({ queryKey: ['proposals'] });
  };

  const evaluate = useMutation({
    // `force` matters for the re-run: evaluate() is idempotent and would otherwise hand
    // back the stored partial report unchanged, which is precisely the thing we are
    // trying to replace.
    mutationFn: (force: boolean = false) => evaluationApi.run(id!, force),
    onSuccess: invalidate,
  });

  const retry = useMutation({
    mutationFn: () => proposalApi.retryProcessing(id!),
    onSuccess: invalidate,
  });

  const decide = useMutation({
    mutationFn: ({
      decision,
      acknowledge,
    }: {
      decision: DecisionType;
      acknowledge?: boolean;
    }) =>
      decision === 'selected_for_funding'
        ? decisionApi.markFunding(id!, true, { acknowledgeConflicts: acknowledge })
        : decisionApi.decide(id!, decision, { acknowledgeConflicts: acknowledge }),
    onSuccess: () => {
      setConflicts(null);
      setPendingDecision(null);
      invalidate();
    },
    onError: (err) => {
      // The server refuses an approval that collides with an existing one, and returns
      // the detail. Show the evaluator exactly what they would be overriding.
      if (err instanceof ConflictError) {
        setConflicts(err.conflicts);
      }
    },
  });

  const runDecision = (decision: DecisionType) => {
    setPendingDecision(decision);
    decide.mutate({ decision });
  };

  if (isLoading || !data) {
    return (
      <AppLayout>
        <Skeleton className="h-96 rounded-2xl" />
      </AppLayout>
    );
  }

  const { proposal, latest_evaluation, decision, company_context } = data;
  const report = latest_evaluation?.report;
  const evaluation = report?.evaluation;
  const meta = proposal.idea_metadata;

  return (
    <AppLayout>
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-text">
              {proposal.title || proposal.filename}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-text-muted">
              <span className="flex items-center gap-1.5">
                <Building2 className="h-4 w-4" />
                {proposal.company_name ?? 'Company not identified'}
              </span>
              <span className="flex items-center gap-1.5">
                <FolderTree className="h-4 w-4" />
                {proposal.category_label ?? 'Uncategorised'}
              </span>
              <StatusBadge status={proposal.status} />
              {decision && <DecisionBadge decision={decision.decision} />}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Requirement: view the original document the score was produced from. */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => proposalApi.openFile(proposal.id)}
            >
              <ExternalLink className="h-4 w-4" />
              Original document
            </Button>

            {latest_evaluation && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  evaluationApi.exportPdf(
                    latest_evaluation.id,
                    `${(proposal.title || proposal.filename).slice(0, 50)}_evaluation.pdf`,
                  )
                }
              >
                <Download className="h-4 w-4" />
                Export PDF
              </Button>
            )}
          </div>
        </div>
      </header>

      {proposal.status === 'failed' && (
        <section className="glass-card-static mb-6 rounded-2xl border-l-4 border-l-red-400 p-5">
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-text">
                Processing failed at the {proposal.error_stage ?? 'unknown'} stage
              </h2>
              <p className="mt-1 break-words text-xs text-text-muted">
                {proposal.error_message}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Attempt {proposal.retry_count}. The original document is still stored, so a
                retry costs no re-upload.
              </p>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => retry.mutate()}
                loading={retry.isPending}
              >
                <RotateCcw className="h-4 w-4" />
                Retry
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* (e) The company's track record, shown where the decision is made. */}
      {company_context && company_context.approved_count > 0 && (
        <section className="glass-card-static mb-6 rounded-2xl border-l-4 border-l-amber-400 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-text">
                {proposal.company_name} already has {company_context.approved_count}{' '}
                approved idea{company_context.approved_count === 1 ? '' : 's'}
                {company_context.categories_spanned > 1 &&
                  ` across ${company_context.categories_spanned} categories`}
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">
                Worth weighing before granting the same company another slot.
              </p>
              <div className="mt-3 space-y-1">
                {company_context.approvals.map((a) => (
                  <div
                    key={a.proposal_id}
                    className="flex items-center justify-between rounded-lg bg-amber-50/60 px-3 py-1.5 text-xs"
                  >
                    <span className="font-medium text-text">{a.title}</span>
                    <span className="text-amber-800">
                      {a.category} · {a.year}-{String(a.month).padStart(2, '0')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {conflicts && conflicts.length > 0 && (
        <section className="glass-card-static mb-6 rounded-2xl border-l-4 border-l-red-400 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-text">
                This approval conflicts with existing approvals
              </h2>
              <ul className="mt-2 space-y-2">
                {conflicts.map((conflict, i) => (
                  <li key={i} className="rounded-lg bg-red-50/70 px-3 py-2">
                    <p className="text-xs font-medium text-red-900">{conflict.message}</p>
                    {conflict.existing_approvals?.map((a) => (
                      <p key={a.proposal_id} className="mt-1 text-[11px] text-red-800/80">
                        · {a.title} — {a.category} ({a.year}-
                        {String(a.month).padStart(2, '0')})
                      </p>
                    ))}
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  loading={decide.isPending}
                  onClick={() =>
                    pendingDecision &&
                    decide.mutate({ decision: pendingDecision, acknowledge: true })
                  }
                >
                  Approve anyway
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setConflicts(null);
                    setPendingDecision(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-text-muted">
                Overriding is recorded in the audit log against your account.
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="glass-card-static mb-6 rounded-2xl p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
          <ScrollText className="h-4 w-4 text-text-secondary" />
          The idea
        </h2>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Problem" value={proposal.problem_statement} />
          <Field label="Solution" value={proposal.solution_summary} />
        </div>

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-border/60 pt-3 text-xs text-text-muted">
          <span>{proposal.total_pages} pages</span>
          <span>{proposal.total_words.toLocaleString()} words</span>
          <span>{proposal.total_tables} tables</span>
          {proposal.has_scanned_content && <span>contains scanned pages (OCR)</span>}
          {meta?.trl_level && <span>TRL {meta.trl_level}</span>}
          {meta?.districts && meta.districts.length > 0 && (
            <span>districts: {meta.districts.slice(0, 4).join(', ')}</span>
          )}
        </div>
      </section>

      {!evaluation ? (
        <EmptyState
          icon={Gauge}
          title="Not evaluated yet"
          description={
            proposal.review_decision === 'pending'
              ? 'This idea is waiting on a duplicate review. Resolve that first.'
              : proposal.review_decision === 'skipped_duplicate'
                ? 'This idea was marked a duplicate and skipped. Its metadata is kept, and it can still be evaluated later if that judgement changes.'
                : 'Run the agent pipeline. It reads the sections stored at ingestion — the document is not re-read, so this costs no re-upload.'
          }
          action={
            proposal.review_decision === 'approved_for_eval' ? (
              <Button onClick={() => evaluate.mutate(false)} loading={evaluate.isPending}>
                <Play className="h-4 w-4" />
                Evaluate now
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <section className="glass-card-static mb-6 rounded-2xl p-5">
            <div className="flex flex-wrap items-center gap-6">
              <ScoreRing score={evaluation.overall_score} />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <RecommendationBadge recommendation={evaluation.recommendation} />
                  <span className="text-xs text-text-muted">
                    risk {evaluation.risk_level} · evidence coverage{' '}
                    {(evaluation.evidence_coverage * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                  {evaluation.summary}
                </p>
              </div>
            </div>

            {/*
              An incomplete assessment must say so, loudly, right next to the score.
              Otherwise an evaluator reads 69/100 and has no way of knowing that two
              parameters were never actually looked at.
            */}
            {evaluation.failed_parameters?.length > 0 && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-red-800">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  This assessment is incomplete — do not rely on the score yet
                </p>
                <p className="mt-1 text-xs text-red-700/90">
                  We could not assess {evaluation.failed_parameters.join(', ')} because of
                  a technical failure on our side. This is <strong>not</strong> a gap in
                  the proposal and the applicant has not been penalised for it — those
                  parameters were simply left out of the weighted score.
                </p>
                <Button
                  size="sm"
                  variant="danger"
                  className="mt-3"
                  onClick={() => evaluate.mutate(true)}
                  loading={evaluate.isPending}
                >
                  <RotateCcw className="h-4 w-4" />
                  Re-run the evaluation
                </Button>
              </div>
            )}

            {/* Parameters the document never addressed. Reported, not silently zeroed. */}
            {evaluation.unevidenced_parameters.length > 0 && (
              <div className="mt-4 rounded-lg bg-gray-50 px-3 py-2">
                <p className="text-xs text-text-muted">
                  <span className="font-semibold text-text-secondary">
                    Not addressed by the proposal:
                  </span>{' '}
                  {evaluation.unevidenced_parameters.join(', ')}. These are excluded from
                  the weighted score rather than counted as zero — the proposal is silent
                  on them, which is not the same as answering them poorly.
                </p>
              </div>
            )}
          </section>

          {isAdmin && (
            <section className="glass-card-static mb-6 rounded-2xl p-5">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-text">
                <Landmark className="h-4 w-4 text-text-secondary" />
                Decision
              </h2>
              <p className="mb-4 text-xs text-text-muted">
                Approving is checked against existing approvals in this category and from
                this company. Any conflict is shown to you before it is recorded.
              </p>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => runDecision('approved')}
                  loading={decide.isPending && pendingDecision === 'approved'}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  className="bg-violet-600 text-white hover:bg-violet-700"
                  onClick={() => runDecision('selected_for_funding')}
                  loading={decide.isPending && pendingDecision === 'selected_for_funding'}
                >
                  <Sparkles className="h-4 w-4" />
                  Select for funding
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => runDecision('rejected')}
                  loading={decide.isPending && pendingDecision === 'rejected'}
                >
                  <Ban className="h-4 w-4" />
                  Reject
                </Button>
              </div>
            </section>
          )}

          {/* (c) SWOT as one continuous argument, not four disconnected stubs. */}
          <section className="glass-card-static mb-6 rounded-2xl p-5">
            <h2 className="mb-3 text-sm font-semibold text-text">SWOT</h2>

            {evaluation.swot_analysis.narrative && (
              <p className="mb-4 text-sm leading-relaxed text-text-secondary">
                {evaluation.swot_analysis.narrative}
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <SwotQuadrant
                title="Strengths"
                items={evaluation.swot_analysis.strengths}
                tone="emerald"
              />
              <SwotQuadrant
                title="Weaknesses"
                items={evaluation.swot_analysis.weaknesses}
                tone="red"
              />
              <SwotQuadrant
                title="Opportunities"
                items={evaluation.swot_analysis.opportunities}
                tone="blue"
              />
              <SwotQuadrant
                title="Threats"
                items={evaluation.swot_analysis.threats}
                tone="amber"
              />
            </div>
          </section>

          {/* (b) Every score, with the quotes behind it. */}
          <section className="mb-6">
            <header className="mb-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
                <FileText className="h-4 w-4 text-text-secondary" />
                Scores and the evidence behind them
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">
                Every score is followed by the verbatim text from the proposal that
                produced it. Quotes that could not be located in the source document were
                discarded and contributed to no score.
              </p>
            </header>

            <div className="grid gap-4">
              {Object.values(evaluation.parameter_breakdown).map((parameter) => (
                <ParameterCard key={parameter.parameter_key} parameter={parameter} />
              ))}
            </div>
          </section>

          {evaluation.key_action_items.length > 0 && (
            <section className="glass-card-static mb-6 rounded-2xl p-5">
              <h2 className="mb-3 text-sm font-semibold text-text">Required actions</h2>
              <ol className="space-y-1.5">
                {evaluation.key_action_items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm text-text-secondary">
                    <span className="tabular-nums text-text-muted">{i + 1}.</span>
                    {item}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {report && (
            <p className="text-center text-[11px] text-text-muted">
              {report.total_tokens.toLocaleString()} tokens ·{' '}
              {report.processing_time_seconds.toFixed(0)}s · {report.model_used}
            </p>
          )}
        </>
      )}
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-text-secondary">
        {value || <span className="italic text-text-muted">Not identified</span>}
      </p>
    </div>
  );
}

function SwotQuadrant({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'emerald' | 'red' | 'blue' | 'amber';
}) {
  const tones = {
    emerald: 'border-emerald-200 bg-emerald-50/50',
    red: 'border-red-200 bg-red-50/50',
    blue: 'border-blue-200 bg-blue-50/50',
    amber: 'border-amber-200 bg-amber-50/50',
  };

  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <p className="mb-1.5 text-xs font-semibold text-text">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs italic text-text-muted">None recorded</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="text-xs leading-snug text-text-secondary">
              · {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
