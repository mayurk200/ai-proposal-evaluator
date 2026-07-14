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
import { Button, Skeleton } from '@/components/ui';
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
    onSuccess: () => {
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ['review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
    },
  });

  const proposal = detail?.proposal;
  const matches = detail?.similar ?? [];

  return (
    <AppLayout>
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text">
          <Copy className="h-6 w-6 text-amber-500" />
          Duplicate review
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          These ideas closely resemble something already in the database. Compare them and
          decide whether to evaluate. Nothing is spent on an evaluation until you do.
        </p>
      </header>

      {isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !queue?.proposals.length ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing waiting"
          description="No incoming idea currently resembles an existing one closely enough to need a second look."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          {/* Queue */}
          <aside className="glass-card-static h-fit rounded-2xl p-3">
            <p className="px-2 pb-2 text-xs font-medium text-text-muted">
              {queue.total} awaiting review
            </p>
            <div className="space-y-1">
              {queue.proposals.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelected(p.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                    p.id === activeId
                      ? 'bg-accent-light text-primary'
                      : 'hover:bg-accent-light/40'
                  }`}
                >
                  <p className="truncate text-sm font-medium">
                    {p.title || p.filename}
                  </p>
                  <p className="truncate text-xs text-text-muted">
                    {p.company_name ?? 'Unknown company'}
                  </p>
                </button>
              ))}
            </div>
          </aside>

          {/* Side-by-side comparison */}
          <section className="space-y-5">
            {!proposal ? (
              <Skeleton className="h-64 rounded-2xl" />
            ) : (
              <>
                {matches.map((match) => (
                  <ComparisonCard key={match.id} incoming={proposal} match={match} />
                ))}

                {matches.length === 0 && (
                  <EmptyState
                    icon={AlertTriangle}
                    title="No matches recorded"
                    description="This proposal is in the review queue but its matches are missing. It can be safely sent for evaluation."
                  />
                )}

                {/* The decision */}
                <div className="glass-card-static rounded-2xl p-5">
                  <h3 className="text-sm font-semibold text-text">Your decision</h3>
                  <p className="mt-1 text-xs text-text-muted">
                    Skipping keeps the idea and its metadata in the database — it simply
                    never costs an evaluation, and can be revived later.
                  </p>

                  {!isAdmin ? (
                    <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-text-muted">
                      Only an administrator can resolve a duplicate review.
                    </p>
                  ) : (
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button
                        onClick={() =>
                          resolve.mutate({ id: proposal.id, evaluate: true })
                        }
                        loading={resolve.isPending}
                      >
                        <ArrowRight className="h-4 w-4" />
                        Not a duplicate — evaluate it
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          resolve.mutate({ id: proposal.id, evaluate: false })
                        }
                        loading={resolve.isPending}
                      >
                        <Ban className="h-4 w-4" />
                        It is a duplicate — skip it
                      </Button>
                    </div>
                  )}
                </div>
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
    <div className="glass-card-static rounded-2xl p-5">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-amber-100 px-2.5 py-1 text-sm font-bold text-amber-800 tabular-nums">
            {(match.similarity * 100).toFixed(0)}% similar
          </span>
          <span className="text-xs text-text-muted">
            compared on the substance of the idea, not the wording
          </span>
        </div>
      </header>

      {/* Why it was flagged. "Same company resubmitting" and "a different company with
          the same idea" call for opposite decisions, so this is the important part. */}
      {match.match_reasons?.length > 0 && (
        <ul className="mb-4 space-y-1 rounded-lg bg-amber-50/60 px-3 py-2">
          {match.match_reasons.map((reason, i) => (
            <li key={i} className="flex gap-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
              {reason}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 md:grid-cols-2">
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
