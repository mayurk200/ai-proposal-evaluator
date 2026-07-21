import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Building2,
  CheckCircle2,
  Copy,
  ExternalLink,
  FolderTree,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge, Button, Skeleton } from '@/components/ui';
import { PageHeader, Section } from '@/components/ui/page';
import { useToast } from '@/components/ui/overlays';
import { EmptyState } from '@/components/domain';
import { proposalApi, reviewApi } from '@/services/agrieval.service';
import { useAuthStore } from '@/store/authStore';
import type { Proposal, SimilarityMatch } from '@/types';

/**
 * The duplicate gate (requirement h).
 *
 * When an incoming idea looks like one already in the archive, it stops here and an
 * admin sees BOTH side by side before anything is spent evaluating it. The decision is
 * binary and consequential:
 *
 *   Evaluate  — not a duplicate (or one worth evaluating anyway). Into the pipeline.
 *   Skip      — it IS a duplicate. Never evaluated, but the metadata is KEPT, so the
 *               idea stays searchable and can be revived later.
 *
 * Matching is semantic, not textual: it compares the substance of the idea (its problem
 * and its solution), so a reworded resubmission is caught where a hash or fuzzy string
 * match would sail straight past.
 */
export default function ReviewQueuePage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const isAdmin = useAuthStore((s) => s.hasRole('ADMIN'));
  const [selected, setSelected] = useState<string | null>(null);

  const { data: queue, isLoading } = useQuery({
    queryKey: ['review-queue'],
    queryFn: () => reviewApi.queue(),
    refetchInterval: 15_000,
  });

  const activeId = selected ?? queue?.proposals[0]?.id ?? null;

  const { data: detail } = useQuery({
    queryKey: ['proposal', activeId],
    queryFn: () => proposalApi.get(activeId!),
    enabled: !!activeId,
  });

  const resolve = useMutation({
    mutationFn: ({ id, evaluate }: { id: string; evaluate: boolean }) =>
      reviewApi.resolve(id, evaluate),
    onSuccess: (_result, variables) => {
      setSelected(null);
      toast.success(
        variables.evaluate ? 'Sent for evaluation' : 'Skipped as a duplicate',
        variables.evaluate
          ? 'It is now in the queue and can be evaluated.'
          : 'The metadata is kept — it stays searchable and can be revived later.',
      );
      queryClient.invalidateQueries({ queryKey: ['review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
    },
    onError: () => toast.error('Could not record that ruling'),
  });

  const proposal = detail?.proposal;
  const matches = detail?.similar ?? [];

  return (
    <AppLayout>
      <PageHeader
        title="Duplicate review"
        meta={queue?.total ? <Badge tone="warning">{queue.total} waiting</Badge> : undefined}
        description="These ideas closely resemble something already in the database. Compare them and decide whether to evaluate — nothing is spent until you do. Matching is semantic, so a reworded resubmission is caught where a text comparison would sail straight past."
      />

      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !queue?.proposals.length ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing waiting"
          description="No incoming idea currently resembles an existing one closely enough to need a second look."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          {/* The queue. A list rather than a stack of cards: an admin working
              through fifteen of these wants to move between them quickly. */}
          <aside className="h-fit overflow-hidden rounded-xl border border-border bg-surface shadow-card">
            <p className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              {queue.total} awaiting review
            </p>
            <div className="max-h-[70vh] divide-y divide-border overflow-y-auto">
              {queue.proposals.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelected(p.id)}
                  className={`w-full px-3 py-2.5 text-left transition-colors ${
                    p.id === activeId
                      ? 'border-l-2 border-l-primary bg-accent-light/60'
                      : 'border-l-2 border-l-transparent hover:bg-gray-50'
                  }`}
                >
                  <p className="truncate text-[13px] font-medium text-text">
                    {p.title || p.filename}
                  </p>
                  <p className="truncate text-xs text-text-muted">
                    {p.company_name ?? 'Company not identified'}
                  </p>
                </button>
              ))}
            </div>
          </aside>

          {/* Side-by-side comparison */}
          <section className="space-y-4">
            {!proposal ? (
              <Skeleton className="h-64 rounded-xl" />
            ) : (
              <>
                {matches.map((match) => (
                  <ComparisonCard key={match.id} incoming={proposal} match={match} />
                ))}

                {matches.length === 0 && (
                  <EmptyState
                    icon={AlertTriangle}
                    title="No matches recorded"
                    description="This proposal is in the review queue but its matches are missing. It can safely be sent for evaluation."
                  />
                )}

                <Section
                  title="Your decision"
                  description="Skipping keeps the idea and its metadata in the database — it simply never costs an evaluation, and can be revived later."
                >
                  {!isAdmin ? (
                    <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-text-muted">
                      Only an administrator can resolve a duplicate review.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        icon={ArrowRight}
                        onClick={() => resolve.mutate({ id: proposal.id, evaluate: true })}
                        loading={resolve.isPending}
                      >
                        Not a duplicate — evaluate it
                      </Button>
                      <Button
                        variant="outline"
                        icon={Ban}
                        onClick={() => resolve.mutate({ id: proposal.id, evaluate: false })}
                        loading={resolve.isPending}
                      >
                        It is a duplicate — skip it
                      </Button>
                    </div>
                  )}
                </Section>
              </>
            )}
          </section>
        </div>
      )}
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------

function ComparisonCard({
  incoming,
  match,
}: {
  incoming: Proposal;
  match: SimilarityMatch;
}) {
  const existing = match.matched_proposal;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        {/* Above 85% is very likely the same idea; between the threshold and
            there it is a genuine judgement call. Toning them the same would
            flatten that distinction away. */}
        <Badge tone={match.similarity > 0.85 ? 'danger' : 'warning'}>
          {(match.similarity * 100).toFixed(0)}% similar
        </Badge>
        <span className="text-xs text-text-muted">
          compared on the substance of the idea, not the wording
        </span>
      </header>

      {/* Why it was flagged. "Same company resubmitting" and "a different company with
          the same idea" call for opposite decisions, so this is the important part. */}
      {match.match_reasons?.length > 0 && (
        <ul className="mb-3 space-y-1 rounded-lg bg-amber-50 px-3 py-2">
          {match.match_reasons.map((reason, i) => (
            <li key={i} className="flex gap-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
              {reason}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <IdeaColumn label="Incoming" proposal={incoming} highlight />
        <IdeaColumn label="Already in the database" proposal={existing} />
      </div>
    </div>
  );
}

function IdeaColumn({
  label,
  proposal,
  highlight,
}: {
  label: string;
  proposal: Proposal;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight ? 'border-primary/30 bg-accent-light/20' : 'border-border bg-white/60'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {label}
        </span>
        <button
          onClick={() => proposalApi.openFile(proposal.id)}
          className="flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Open document
        </button>
      </div>

      <Link
        to={`/proposals/${proposal.id}`}
        className="text-sm font-semibold text-text hover:text-primary"
      >
        {proposal.title || proposal.filename}
      </Link>

      <div className="mt-2 space-y-1 text-xs text-text-muted">
        <p className="flex items-center gap-1.5">
          <Building2 className="h-3 w-3" />
          {proposal.company_name ?? 'Company not identified'}
        </p>
        <p className="flex items-center gap-1.5">
          <FolderTree className="h-3 w-3" />
          {proposal.category_label ?? 'Uncategorised'}
        </p>
        {proposal.is_evaluated && (
          <p className="flex items-center gap-1.5 text-emerald-700">
            <CheckCircle2 className="h-3 w-3" />
            Already evaluated
          </p>
        )}
      </div>

      {proposal.problem_statement && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold text-text-secondary">Problem</p>
          <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
            {proposal.problem_statement}
          </p>
        </div>
      )}

      {proposal.solution_summary && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-text-secondary">Solution</p>
          <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
            {proposal.solution_summary}
          </p>
        </div>
      )}
    </div>
  );
}
