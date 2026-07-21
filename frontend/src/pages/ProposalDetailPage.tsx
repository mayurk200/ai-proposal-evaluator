import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Ban,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderTree,
  Gauge,
  History,
  Landmark,
  Layers,
  Play,
  Quote,
  RotateCcw,
  ScrollText,
  Sparkles,
  Undo2,
  XCircle,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge, Button, Clamp, Skeleton } from '@/components/ui';
import { BackLink, PageHeader, Section, Tabs } from '@/components/ui/page';
import { ConfirmDialog, useToast } from '@/components/ui/overlays';
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
import { formatDateTime, formatDuration, formatFileSize, formatRelative } from '@/utils';
import type { ApprovalConflict, DecisionType, Proposal } from '@/types';

/**
 * One idea, everything we know about it.
 *
 * This page previously rendered the entire evaluation as one column: summary,
 * SWOT, then seven parameters each with five sub-questions, each with a verbatim
 * quote and a justification. Perhaps two thousand words of generated prose with
 * no hierarchy, so the reader could not tell in five seconds what the verdict
 * was — and the detail that made the verdict trustworthy went unread because it
 * was indistinguishable from the rest of the wall.
 *
 * The fix is not less information. It is putting the answer first — score,
 * recommendation, what to do about it — and moving the supporting evidence
 * behind a tab where someone who wants to check the reasoning can find it in one
 * place. Nothing was removed.
 */

type TabKey = 'overview' | 'evidence' | 'document' | 'history';

export default function ProposalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const isAdmin = useAuthStore((s) => s.hasRole('ADMIN'));

  const [tab, setTab] = useState<TabKey>('overview');
  const [conflicts, setConflicts] = useState<ApprovalConflict[] | null>(null);
  const [pendingDecision, setPendingDecision] = useState<DecisionType | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['proposal', id],
    queryFn: () => proposalApi.get(id!),
    enabled: !!id,
    // The server is doing the work, so this row changes underneath us. Poll
    // while it is in motion, stop once it settles.
    refetchInterval: (query) => {
      const status = query.state.data?.proposal.status;
      return status &&
        ['uploaded', 'extracting', 'extracted', 'metadata_ready', 'queued', 'evaluating'].includes(
          status,
        )
        ? 5_000
        : false;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['proposal', id] });
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
    queryClient.invalidateQueries({ queryKey: ['proposals'] });
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
  };

  const evaluate = useMutation({
    // `force` matters for the re-run: evaluate() is idempotent and would
    // otherwise hand back the stored partial report unchanged, which is exactly
    // the thing we are trying to replace.
    mutationFn: (force: boolean = false) => evaluationApi.run(id!, force),
    onSuccess: (result) => {
      toast.success(
        result.already_queued ? 'Already queued' : 'Evaluation queued',
        'It runs on the server — you can close this tab and come back to the result.',
      );
      invalidate();
    },
    onError: (err: any) =>
      toast.error('Could not queue this evaluation', err?.response?.data?.message),
  });

  const retry = useMutation({
    mutationFn: () => proposalApi.retryProcessing(id!),
    onSuccess: () => {
      toast.success('Reprocessing queued', 'The stored document is re-read from the start.');
      invalidate();
    },
    onError: (err: any) => toast.error('Could not retry', err?.response?.data?.message),
  });

  const markDuplicate = useMutation({
    mutationFn: (isDuplicate: boolean) => proposalApi.markDuplicate(id!, isDuplicate),
    onSuccess: (_result, isDuplicate) => {
      setConfirmDuplicate(false);
      toast.success(
        isDuplicate ? 'Marked as a duplicate' : 'Restored',
        isDuplicate
          ? 'It leaves the working list. Nothing is deleted — you can undo this at any time.'
          : 'It is back in the queue and can be evaluated.',
      );
      invalidate();
    },
    onError: (err: any) => {
      setConfirmDuplicate(false);
      toast.error('Could not update', err?.response?.data?.message);
    },
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
    onSuccess: (_r, variables) => {
      setConflicts(null);
      setPendingDecision(null);
      toast.success(`Recorded: ${variables.decision.replace(/_/g, ' ')}`);
      invalidate();
    },
    onError: (err) => {
      // The server refuses an approval that collides with an existing one and
      // returns the detail. Show the evaluator exactly what they would override.
      if (err instanceof ConflictError) setConflicts(err.conflicts);
      else toast.error('Could not record that decision');
    },
  });

  if (isLoading || !data) {
    return (
      <AppLayout>
        <Skeleton className="mb-4 h-8 w-64 rounded" />
        <Skeleton className="h-96 rounded-xl" />
      </AppLayout>
    );
  }

  const { proposal, latest_evaluation, evaluations, decision, company_context, similar } = data;
  const report = latest_evaluation?.report;
  const evaluation = report?.evaluation;
  const meta = proposal.idea_metadata;
  const isDuplicate = proposal.review_decision === 'skipped_duplicate';

  const parameters = evaluation ? Object.values(evaluation.parameter_breakdown) : [];
  const redFlagCount = parameters.reduce((sum, p) => sum + p.red_flags.length, 0);

  return (
    <AppLayout>
      <PageHeader
        back={<BackLink to="/proposals" label="Back to proposals" />}
        title={proposal.title || proposal.filename}
        meta={
          <>
            <StatusBadge status={proposal.status} />
            {decision && <DecisionBadge decision={decision.decision} />}
            {isDuplicate && (
              <Badge tone="neutral" icon={Ban}>
                Ruled a duplicate
              </Badge>
            )}
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" />
              {proposal.company_name ?? 'Company not identified'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FolderTree className="h-3.5 w-3.5" />
              {proposal.category_label ?? 'Uncategorised'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Added {formatRelative(proposal.created_at)}
            </span>
          </span>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              icon={ExternalLink}
              onClick={() => proposalApi.openFile(proposal.id)}
            >
              Document
            </Button>

            {latest_evaluation && (
              <Button
                variant="outline"
                size="sm"
                icon={Download}
                onClick={() =>
                  evaluationApi.exportPdf(
                    latest_evaluation.id,
                    `${(proposal.title || proposal.filename).slice(0, 50)}_evaluation.pdf`,
                  )
                }
              >
                Export PDF
              </Button>
            )}

            {isAdmin &&
              (isDuplicate ? (
                <Button
                  variant="outline"
                  size="sm"
                  icon={Undo2}
                  loading={markDuplicate.isPending}
                  onClick={() => markDuplicate.mutate(false)}
                >
                  Not a duplicate
                </Button>
              ) : (
                !proposal.is_evaluated && (
                  <Button
                    variant="outline"
                    size="sm"
                    icon={Copy}
                    onClick={() => setConfirmDuplicate(true)}
                  >
                    Mark duplicate
                  </Button>
                )
              ))}
          </>
        }
      />

      {/* ------------------------------------------------- Blocking states */}
      {proposal.status === 'failed' && (
        <Alert
          tone="danger"
          icon={XCircle}
          title={`Processing failed at the ${proposal.error_stage ?? 'unknown'} stage`}
          action={
            <Button size="sm" icon={RotateCcw} onClick={() => retry.mutate()} loading={retry.isPending}>
              Retry
            </Button>
          }
        >
          <p className="break-words">{proposal.error_message}</p>
          <p className="mt-1">
            Attempt {proposal.retry_count}. The original document is still stored, so a retry
            costs no re-upload.
          </p>
        </Alert>
      )}

      {conflicts && conflicts.length > 0 && (
        <Alert
          tone="danger"
          icon={AlertTriangle}
          title="This approval conflicts with existing approvals"
        >
          <ul className="mt-1 space-y-2">
            {conflicts.map((conflict, i) => (
              <li key={i} className="rounded-lg bg-red-50 px-3 py-2">
                <p className="text-xs font-medium text-red-900">{conflict.message}</p>
                {conflict.existing_approvals?.map((a) => (
                  <p key={a.proposal_id} className="mt-1 text-[11px] text-red-800/80">
                    · {a.title} — {a.category} ({a.year}-{String(a.month).padStart(2, '0')})
                  </p>
                ))}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button
              variant="danger"
              size="sm"
              loading={decide.isPending}
              onClick={() =>
                pendingDecision && decide.mutate({ decision: pendingDecision, acknowledge: true })
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
          <p className="mt-2 text-[11px]">
            Overriding is recorded in the audit log against your account.
          </p>
        </Alert>
      )}

      {/* (e) The company's track record, shown where the decision is made. */}
      {company_context && company_context.approved_count > 0 && (
        <Alert
          tone="warning"
          icon={AlertTriangle}
          title={`${proposal.company_name} already has ${company_context.approved_count} approved idea${
            company_context.approved_count === 1 ? '' : 's'
          }${
            company_context.categories_spanned > 1
              ? ` across ${company_context.categories_spanned} categories`
              : ''
          }`}
        >
          <div className="mt-1.5 space-y-1">
            {company_context.approvals.map((a) => (
              <div
                key={a.proposal_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs"
              >
                <span className="font-medium text-text">{a.title}</span>
                <span className="text-amber-800">
                  {a.category} · {a.year}-{String(a.month).padStart(2, '0')}
                </span>
              </div>
            ))}
          </div>
        </Alert>
      )}

      {/* ------------------------------------------------------------ Tabs */}
      <Tabs
        className="mb-4"
        active={tab}
        onChange={(key) => setTab(key as TabKey)}
        items={[
          { key: 'overview', label: 'Overview', icon: Gauge },
          {
            key: 'evidence',
            label: 'Scores & evidence',
            icon: Quote,
            count: parameters.length,
          },
          { key: 'document', label: 'Document', icon: FileText },
          { key: 'history', label: 'History', icon: History, count: evaluations.length },
        ]}
      />

      {tab === 'overview' && (
        <div className="space-y-4">
          {!evaluation ? (
            <NotEvaluated
              proposal={proposal}
              onEvaluate={() => evaluate.mutate(false)}
              pending={evaluate.isPending}
            />
          ) : (
            <>
              {/* The verdict, above everything. Score, what it means, what to do. */}
              <Section bodyClassName="p-5">
                <div className="flex flex-wrap items-start gap-5">
                  <ScoreRing score={evaluation.overall_score} />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <RecommendationBadge recommendation={evaluation.recommendation} />
                      <Badge
                        tone={
                          evaluation.risk_level?.toLowerCase() === 'high'
                            ? 'danger'
                            : evaluation.risk_level?.toLowerCase() === 'medium'
                              ? 'warning'
                              : 'success'
                        }
                      >
                        {evaluation.risk_level} risk
                      </Badge>
                      {redFlagCount > 0 && (
                        <Badge tone="danger" icon={AlertTriangle}>
                          {redFlagCount} red flag{redFlagCount === 1 ? '' : 's'}
                        </Badge>
                      )}
                    </div>

                    {/* Clamped, not truncated. The summary runs long and the
                        first three lines carry the verdict; the rest is there
                        for whoever wants it. */}
                    <Clamp lines={3} className="mt-2 text-[13px] leading-relaxed text-text-secondary">
                      {evaluation.summary}
                    </Clamp>
                  </div>
                </div>

                {/* Numbers only. `investment_readiness` comes back as a whole
                    sentence, so it gets its own line below rather than being
                    crammed into a stat cell and stretching the row. */}
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
                  <Metric
                    label="Evidence coverage"
                    value={`${(evaluation.evidence_coverage * 100).toFixed(0)}%`}
                    hint="Share of sub-questions the document actually answered"
                  />
                  <Metric
                    label="Parameters scored"
                    value={`${
                      parameters.filter((p) => p.parameter_score !== null).length
                    }/${parameters.length}`}
                    hint="Parameters with a number. The rest were unaddressed or could not be assessed."
                  />
                  <Metric
                    label="Tokens"
                    value={report ? report.total_tokens.toLocaleString() : '—'}
                    hint="What this assessment cost to produce"
                  />
                  <Metric
                    label="Assessed"
                    value={formatRelative(latest_evaluation!.completed_at ?? latest_evaluation!.created_at)}
                  />
                </dl>

                {evaluation.investment_readiness && (
                  <div className="mt-3 border-t border-border pt-3">
                    <p className="text-[11px] uppercase tracking-wide text-text-muted">
                      Investment readiness
                    </p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-text-secondary">
                      {evaluation.investment_readiness}
                    </p>
                  </div>
                )}
              </Section>

              {/* An incomplete assessment must say so, loudly, next to the score.
                  Otherwise an evaluator reads 69/100 with no way of knowing two
                  parameters were never actually looked at. */}
              {evaluation.failed_parameters?.length > 0 && (
                <Alert
                  tone="danger"
                  icon={AlertTriangle}
                  title="This assessment is incomplete — do not rely on the score yet"
                  action={
                    <Button
                      size="sm"
                      variant="danger"
                      icon={RotateCcw}
                      onClick={() => evaluate.mutate(true)}
                      loading={evaluate.isPending}
                    >
                      Re-run
                    </Button>
                  }
                >
                  We could not assess {evaluation.failed_parameters.join(', ')} because of a
                  technical failure on our side. This is <strong>not</strong> a gap in the
                  proposal and the applicant has not been penalised — those parameters were
                  left out of the weighted score.
                </Alert>
              )}

              {evaluation.unevidenced_parameters.length > 0 && (
                <div className="rounded-lg border border-border bg-gray-50 px-3 py-2 text-xs text-text-muted">
                  <span className="font-semibold text-text-secondary">
                    Not addressed by the proposal:
                  </span>{' '}
                  {evaluation.unevidenced_parameters.join(', ')}. Excluded from the weighted
                  score rather than counted as zero — silence is not the same as a bad answer.
                </div>
              )}

              {isAdmin && (
                <Section
                  title="Decision"
                  icon={Landmark}
                  description="Approving is checked against existing approvals in this category and from this company. Any conflict is shown before it is recorded."
                >
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      icon={CheckCircle2}
                      onClick={() => {
                        setPendingDecision('approved');
                        decide.mutate({ decision: 'approved' });
                      }}
                      loading={decide.isPending && pendingDecision === 'approved'}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={Sparkles}
                      onClick={() => {
                        setPendingDecision('selected_for_funding');
                        decide.mutate({ decision: 'selected_for_funding' });
                      }}
                      loading={decide.isPending && pendingDecision === 'selected_for_funding'}
                    >
                      Select for funding
                    </Button>
                    <Button
                      size="sm"
                      variant="danger-soft"
                      icon={Ban}
                      onClick={() => {
                        setPendingDecision('rejected');
                        decide.mutate({ decision: 'rejected' });
                      }}
                      loading={decide.isPending && pendingDecision === 'rejected'}
                    >
                      Reject
                    </Button>
                  </div>
                </Section>
              )}

              {/* (c) SWOT as one argument, not four disconnected stubs. */}
              <Section title="SWOT" icon={Layers}>
                {evaluation.swot_analysis.narrative && (
                  <Clamp lines={3} className="mb-3 text-[13px] leading-relaxed text-text-secondary">
                    {evaluation.swot_analysis.narrative}
                  </Clamp>
                )}
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <SwotQuadrant title="Strengths" items={evaluation.swot_analysis.strengths} tone="emerald" />
                  <SwotQuadrant title="Weaknesses" items={evaluation.swot_analysis.weaknesses} tone="red" />
                  <SwotQuadrant title="Opportunities" items={evaluation.swot_analysis.opportunities} tone="blue" />
                  <SwotQuadrant title="Threats" items={evaluation.swot_analysis.threats} tone="amber" />
                </div>
              </Section>

              {evaluation.key_action_items.length > 0 && (
                <Section
                  title="What this proposal needs"
                  icon={CheckCircle2}
                  description="The specific gaps that would have to close for this idea to progress."
                >
                  <ol className="space-y-2">
                    {evaluation.key_action_items.map((item, i) => (
                      <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-text-secondary">
                        <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent-light text-[11px] font-semibold tabular-nums text-primary-dark">
                          {i + 1}
                        </span>
                        {item}
                      </li>
                    ))}
                  </ol>
                </Section>
              )}
            </>
          )}
        </div>
      )}

      {/* -------------------------------------------------------- Evidence */}
      {tab === 'evidence' &&
        (!evaluation ? (
          <EmptyState
            icon={Quote}
            title="No evidence yet"
            description="Evidence appears once this idea has been evaluated."
          />
        ) : (
          <div className="space-y-2">
            <p className="mb-3 text-xs leading-relaxed text-text-muted">
              Every score is the mean of its sub-scores, and each sub-score carries the
              verbatim text from the proposal that produced it. Quotes that could not be
              located in the source document were discarded and contributed to no score.
              Expand a parameter to read them.
            </p>
            {parameters.map((parameter) => (
              <ParameterCard key={parameter.parameter_key} parameter={parameter} />
            ))}
          </div>
        ))}

      {/* -------------------------------------------------------- Document */}
      {tab === 'document' && (
        <div className="space-y-4">
          <Section title="The idea" icon={ScrollText}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Problem" value={proposal.problem_statement} />
              <Field label="Solution" value={proposal.solution_summary} />
            </div>
            {proposal.theme && (
              <div className="mt-4 border-t border-border pt-3">
                <Field label="Theme" value={proposal.theme} />
              </div>
            )}
          </Section>

          <div className="grid gap-4 md:grid-cols-2">
            <Section title="Document" icon={FileText}>
              <dl className="space-y-2 text-[13px]">
                <DefRow label="Filename" value={proposal.filename} />
                <DefRow label="Size" value={formatFileSize(proposal.file_size_bytes)} />
                <DefRow label="Pages" value={proposal.total_pages.toLocaleString()} />
                <DefRow label="Words" value={proposal.total_words.toLocaleString()} />
                <DefRow label="Tables" value={proposal.total_tables.toLocaleString()} />
                <DefRow
                  label="Scanned content"
                  value={proposal.has_scanned_content ? 'Yes — read via OCR' : 'No'}
                />
                <DefRow
                  label="Sections detected"
                  value={proposal.sections.length ? proposal.sections.join(', ') : '—'}
                />
              </dl>
            </Section>

            <Section title="Extracted metadata" icon={Layers}>
              {!meta ? (
                <p className="text-[13px] text-text-muted">
                  No metadata yet — it is generated during ingestion.
                </p>
              ) : (
                <dl className="space-y-2 text-[13px]">
                  <DefRow label="Company" value={proposal.company_name ?? '—'} />
                  <DefRow label="Category" value={proposal.category_label ?? '—'} />
                  <DefRow label="TRL" value={meta.trl_level ? `Level ${meta.trl_level}` : '—'} />
                  <DefRow label="Beneficiaries" value={meta.target_beneficiaries ?? '—'} />
                  <DefRow
                    label="Districts"
                    value={meta.districts?.length ? meta.districts.join(', ') : '—'}
                  />
                  <DefRow
                    label="Technology"
                    value={meta.technology_used?.length ? meta.technology_used.join(', ') : '—'}
                  />
                </dl>
              )}
            </Section>
          </div>

          {similar.length > 0 && (
            <Section
              title="Similar ideas in the archive"
              icon={Copy}
              description="Compared on the substance of the idea — its problem and its solution — not on the wording."
            >
              <div className="space-y-2">
                {similar.map((match) => (
                  <div
                    key={match.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <a
                        href={`/proposals/${match.matched_proposal.id}`}
                        className="text-[13px] font-medium text-text hover:text-primary"
                      >
                        {match.matched_proposal.title || match.matched_proposal.filename}
                      </a>
                      <p className="text-xs text-text-muted">
                        {match.matched_proposal.company_name ?? 'Company not identified'}
                      </p>
                    </div>
                    <Badge tone={match.similarity > 0.85 ? 'danger' : 'warning'}>
                      {(match.similarity * 100).toFixed(0)}% similar
                    </Badge>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      {/* --------------------------------------------------------- History */}
      {tab === 'history' && (
        <Section title="Evaluation runs" icon={History} bodyClassName="p-0">
          {evaluations.length === 0 ? (
            <div className="p-4">
              <p className="text-[13px] text-text-muted">
                This idea has never been evaluated.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {evaluations.map((run) => (
                <div key={run.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Badge
                    tone={
                      run.status === 'completed'
                        ? 'success'
                        : run.status === 'failed'
                          ? 'danger'
                          : 'info'
                    }
                  >
                    {run.status}
                  </Badge>
                  <span className="text-[13px] text-text">
                    {formatDateTime(run.created_at)}
                  </span>
                  {run.status === 'completed' && (
                    <span className="text-[13px] font-semibold tabular-nums text-text">
                      {run.overall_score.toFixed(1)}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-text-muted">
                    {run.total_tokens > 0 && `${run.total_tokens.toLocaleString()} tokens`}
                    {run.total_duration_ms > 0 &&
                      ` · ${formatDuration(run.total_duration_ms / 1000)}`}
                    {run.model_used && ` · ${run.model_used}`}
                  </span>
                  {run.error_message && (
                    <p className="w-full break-words text-xs text-red-600">{run.error_message}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <ConfirmDialog
        open={confirmDuplicate}
        title="Mark this idea as a duplicate?"
        description="It leaves the working list and will not be evaluated. Nothing is deleted — the metadata is kept, the idea stays searchable, and you can undo this at any time."
        confirmLabel="Mark as duplicate"
        loading={markDuplicate.isPending}
        onConfirm={() => markDuplicate.mutate(true)}
        onCancel={() => setConfirmDuplicate(false)}
      />
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------

function NotEvaluated({
  proposal,
  onEvaluate,
  pending,
}: {
  proposal: Proposal;
  onEvaluate: () => void;
  pending: boolean;
}) {
  const inFlight = ['queued', 'evaluating'].includes(proposal.status);

  if (inFlight) {
    return (
      <EmptyState
        icon={Clock}
        title={proposal.status === 'evaluating' ? 'Evaluating now' : 'Queued for evaluation'}
        description="This runs on the server. You can close this tab — the result will be here when you come back."
      />
    );
  }

  return (
    <EmptyState
      icon={Gauge}
      title="Not evaluated yet"
      description={
        proposal.review_decision === 'pending'
          ? 'This idea is waiting on a duplicate review. Resolve that first.'
          : proposal.review_decision === 'skipped_duplicate'
            ? 'Ruled a duplicate and skipped. Its metadata is kept, and it can still be evaluated later if that judgement changes — un-mark it first.'
            : 'The agent pipeline reads the sections stored at ingestion, so the document is not re-read. Around 35,000 tokens and several minutes.'
      }
      action={
        proposal.review_decision === 'approved_for_eval' ? (
          <Button icon={Play} onClick={onEvaluate} loading={pending}>
            Evaluate now
          </Button>
        ) : undefined
      }
    />
  );
}

/** A callout. One component so warnings look the same wherever they appear. */
function Alert({
  tone,
  icon: Icon,
  title,
  action,
  children,
}: {
  tone: 'danger' | 'warning' | 'info';
  icon: React.ElementType;
  title: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const tones = {
    danger: 'border-l-red-500 text-red-900',
    warning: 'border-l-amber-500 text-amber-900',
    info: 'border-l-blue-500 text-blue-900',
  };
  const iconTones = { danger: 'text-red-500', warning: 'text-amber-500', info: 'text-blue-500' };

  return (
    <section
      className={`mb-4 rounded-xl border border-border border-l-4 bg-surface p-4 shadow-card ${tones[tone]}`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${iconTones[tone]}`} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-text">{title}</h2>
          <div className="mt-1 text-xs leading-relaxed text-text-secondary">{children}</div>
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
    </section>
  );
}

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div title={hint}>
      <dt className="text-[11px] uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-text">{value}</dd>
    </div>
  );
}

function DefRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="flex-shrink-0 text-text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-text" title={String(value)}>
        {value}
      </dd>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <Clamp lines={5} className="mt-1 text-[13px] leading-relaxed text-text-secondary">
        {value || <span className="italic text-text-muted">Not identified</span>}
      </Clamp>
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
    emerald: 'border-emerald-200 bg-emerald-50/60',
    red: 'border-red-200 bg-red-50/60',
    blue: 'border-blue-200 bg-blue-50/60',
    amber: 'border-amber-200 bg-amber-50/60',
  };

  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
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
