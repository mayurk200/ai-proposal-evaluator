import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Copy,
  FileStack,
  FolderTree,
  Gauge,
  Loader2,
  Play,
  RotateCcw,
  TrendingUp,
  Upload,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge, Button, Skeleton } from '@/components/ui';
import { PageHeader, Section } from '@/components/ui/page';
import { EmptyState, StatTile, StatusBadge } from '@/components/domain';
import { analyticsApi, proposalApi } from '@/services/agrieval.service';
import { formatRelative, scoreTextClass } from '@/utils';

/**
 * The landing screen for someone who has just signed in.
 *
 * Ordered by what it is for: first, what is waiting on a human; then what the
 * server is doing on its own; then the portfolio. The previous version led with
 * approval charts, which are the least urgent thing on the page — nobody signs
 * in to look at a bar chart, they sign in to find out what needs them.
 */
export default function DashboardPage() {
  const navigate = useNavigate();

  const { data: overview, isLoading } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: analyticsApi.overview,
    refetchInterval: 15_000,
  });

  const { data: scores } = useQuery({
    queryKey: ['analytics', 'scores'],
    queryFn: analyticsApi.scores,
    refetchInterval: 60_000,
  });

  const { data: recent } = useQuery({
    queryKey: ['proposals', 'recent'],
    queryFn: () => proposalApi.list({ limit: 6 }),
    refetchInterval: 15_000,
  });

  const totals = overview?.totals;
  const queue = overview?.queue;

  // Approvals per month, summed across categories — requirement (f).
  const timelineData = Object.entries(
    (overview?.timeline ?? []).reduce<Record<string, number>>((acc, point) => {
      acc[point.period] = (acc[point.period] ?? 0) + point.approved_count;
      return acc;
    }, {}),
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, approved]) => ({ period, approved }));

  const categoryData = (overview?.by_category ?? []).slice(0, 8);
  const multiCategory = overview?.multi_category_companies ?? [];
  const topUndecided = scores?.top_undecided ?? [];

  return (
    <AppLayout>
      <PageHeader
        title="Dashboard"
        description="What is waiting on you, what the server is working through, and where the portfolio stands."
        actions={
          <Button icon={Upload} onClick={() => navigate('/upload')}>
            Upload proposals
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* --------------------------------------- 1. Waiting on a human */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              icon={Play}
              label="Ready to evaluate"
              value={totals?.ready_to_evaluate ?? 0}
              tone={totals?.ready_to_evaluate ? 'success' : 'default'}
              hint="Metadata held, no score yet, not a duplicate"
              onClick={() => navigate('/proposals?view=inbox')}
            />
            <StatTile
              icon={Copy}
              label="Possible duplicates"
              value={totals?.awaiting_review ?? 0}
              tone={totals?.awaiting_review ? 'warning' : 'default'}
              hint="Flagged by the gate; needs a ruling before anything is spent"
              onClick={() => navigate('/review')}
            />
            <StatTile
              icon={RotateCcw}
              label="Failed"
              value={totals?.failed ?? 0}
              tone={totals?.failed ? 'danger' : 'default'}
              hint="Retryable — the original document is still stored"
              onClick={() => navigate('/proposals?view=failed')}
            />
            <StatTile
              icon={CheckCircle2}
              label="Approved"
              value={totals?.approved ?? 0}
              tone="success"
              hint={`across ${totals?.categories ?? 0} categories`}
              onClick={() => navigate('/analytics')}
            />
          </div>

          {/* ------------------------------ 2. What the server is doing now */}
          {queue && queue.pending > 0 && (
            <section className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-card">
              <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-text">
                  {queue.pending} job{queue.pending === 1 ? '' : 's'} in progress
                </p>
                <p className="text-xs text-text-muted">
                  {/* Worth saying plainly: this is the whole point of moving the
                      work off the request cycle, and it is invisible otherwise. */}
                  Running on the server. You can close this tab — processing carries on
                  without you.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {Object.entries(queue.by_kind).map(([kind, statuses]) => {
                  const pending = (statuses.queued ?? 0) + (statuses.running ?? 0);
                  if (!pending) return null;
                  return (
                    <Badge key={kind} tone="info">
                      {pending} {kind === 'ingest' ? 'processing' : 'evaluating'}
                    </Badge>
                  );
                })}
                <Link to="/activity">
                  <Button variant="outline" size="sm">
                    View queue
                  </Button>
                </Link>
              </div>
            </section>
          )}

          {/* -------------------------------- 3. The most consequential (e) */}
          {multiCategory.length > 0 && (
            <section className="mt-4 rounded-xl border border-border border-l-4 border-l-amber-500 bg-surface p-4 shadow-card">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[13px] font-semibold text-text">
                    One company approved across multiple categories
                  </h2>
                  <p className="mt-0.5 text-xs text-text-muted">
                    These companies already hold approved ideas in more than one domain.
                    Check before granting another slot.
                  </p>
                  <div className="mt-2.5 space-y-1.5">
                    {multiCategory.map((company) => (
                      <div
                        key={company.company_id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-1.5"
                      >
                        <span className="flex items-center gap-2 text-[13px] font-medium text-text">
                          <Building2 className="h-3.5 w-3.5 text-amber-600" />
                          {company.name}
                        </span>
                        <span className="text-xs text-amber-800">
                          {company.approved_count} approved · {company.categories_spanned}{' '}
                          categories
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* --------------------------------------- 4. Strongest, undecided */}
          {topUndecided.length > 0 && (
            <Section
              className="mt-4"
              title="Highest scoring, no decision recorded"
              icon={Gauge}
              description="The most actionable rows in the system: assessed, strong, and still waiting on a call."
              actions={
                <Link
                  to="/proposals?view=evaluated&sort=score&order=desc"
                  className="text-xs text-primary hover:underline"
                >
                  See all
                </Link>
              }
              bodyClassName="p-0"
            >
              <div className="divide-y divide-border">
                {topUndecided.slice(0, 5).map((item) => (
                  <Link
                    key={item.proposal_id}
                    to={`/proposals/${item.proposal_id}`}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-gray-50"
                  >
                    <span
                      className={`w-10 flex-shrink-0 text-sm font-semibold tabular-nums ${scoreTextClass(
                        item.score,
                      )}`}
                    >
                      {item.score.toFixed(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-text">{item.title}</p>
                      <p className="truncate text-xs text-text-muted">
                        {item.category ?? 'Uncategorised'}
                      </p>
                    </div>
                    {item.recommendation && (
                      <span className="hidden flex-shrink-0 text-xs text-text-muted sm:block">
                        {item.recommendation}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {/* ------------------------------------------- 5. The portfolio */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {/* (d) Approvals per category */}
            <Section
              title="Approvals by category"
              icon={FolderTree}
              actions={
                <Link to="/analytics" className="text-xs text-primary hover:underline">
                  View all
                </Link>
              }
            >
              {categoryData.length === 0 ? (
                <EmptyState
                  icon={FolderTree}
                  title="No approvals yet"
                  description="Categories appear as ideas are approved. The taxonomy is discovered from the proposals themselves — nothing is predefined."
                />
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart data={categoryData} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid horizontal={false} stroke="#f0f0ee" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="label" width={116} tick={{ fontSize: 11 }} />
                      <Tooltip cursor={{ fill: '#f7f7f5' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Bar dataKey="approved_count" name="Approved" radius={[0, 4, 4, 0]}>
                        {categoryData.map((entry) => (
                          <Cell
                            key={entry.category_id}
                            // More than one approval in a category is exactly what
                            // the client wants to avoid — so it reads as a warning,
                            // not a win.
                            fill={entry.approved_count > 1 ? '#d97706' : '#10a37f'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="mt-2 text-[11px] text-text-muted">
                    Amber marks a category that already holds more than one approved idea.
                  </p>
                </>
              )}
            </Section>

            {/* (f) Timeline */}
            <Section title="Approvals over time" icon={TrendingUp}>
              {timelineData.length === 0 ? (
                <EmptyState
                  icon={TrendingUp}
                  title="No approval history yet"
                  description="Every approval is recorded against the month it actually happened in."
                />
              ) : (
                <ResponsiveContainer width="100%" height={210}>
                  <LineChart data={timelineData} margin={{ left: -18, right: 8 }}>
                    <CartesianGrid stroke="#f0f0ee" />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Line
                      type="monotone"
                      dataKey="approved"
                      name="Approved"
                      stroke="#10a37f"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Section>
          </div>

          {/* --------------------------------------------- 6. Recent arrivals */}
          <Section
            className="mt-4"
            title="Recently added"
            icon={Activity}
            actions={
              <Link to="/proposals?view=all" className="text-xs text-primary hover:underline">
                All proposals
              </Link>
            }
            bodyClassName="p-0"
          >
            {!recent?.proposals.length ? (
              <div className="p-4">
                <EmptyState
                  icon={FileStack}
                  title="No proposals yet"
                  description="Upload one or more documents to begin. Extraction, metadata and the duplicate check run on the server."
                  action={
                    <Button size="sm" icon={Upload} onClick={() => navigate('/upload')}>
                      Upload
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recent.proposals.map((proposal) => (
                  <Link
                    key={proposal.id}
                    to={`/proposals/${proposal.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-2.5 transition-colors hover:bg-gray-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-text">
                        {proposal.title || proposal.filename}
                      </p>
                      <p className="truncate text-xs text-text-muted">
                        {proposal.company_name ?? 'Company not identified'}
                        {proposal.category_label && ` · ${proposal.category_label}`}
                      </p>
                    </div>
                    <span className="hidden flex-shrink-0 text-xs text-text-muted sm:block">
                      {formatRelative(proposal.created_at)}
                    </span>
                    <StatusBadge status={proposal.status} />
                  </Link>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </AppLayout>
  );
}
