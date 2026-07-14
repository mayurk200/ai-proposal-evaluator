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
  Layers,
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
import { Button, Skeleton } from '@/components/ui';
import { EmptyState, StatTile, StatusBadge } from '@/components/domain';
import { analyticsApi, proposalApi } from '@/services/agrieval.service';

export default function DashboardPage() {
  const navigate = useNavigate();

  const { data: overview, isLoading } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: analyticsApi.overview,
    // Ingestion and evaluation run in the background, so these counts move on their own.
    refetchInterval: 15_000,
  });

  const { data: recent } = useQuery({
    queryKey: ['proposals', 'recent'],
    queryFn: () => proposalApi.list({ limit: 8 }),
    refetchInterval: 10_000,
  });

  const totals = overview?.totals;

  // Approvals per month, summed across categories — requirement (f).
  const byPeriod = (overview?.timeline ?? []).reduce<Record<string, number>>(
    (acc, point) => {
      acc[point.period] = (acc[point.period] ?? 0) + point.approved_count;
      return acc;
    },
    {},
  );
  const timelineData = Object.entries(byPeriod)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, approved]) => ({ period, approved }));

  const categoryData = (overview?.by_category ?? []).slice(0, 8);
  const multiCategory = overview?.multi_category_companies ?? [];

  return (
    <AppLayout>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text">Dashboard</h1>
          <p className="mt-1 text-sm text-text-muted">
            Portfolio balance, approval history, and anything waiting on you.
          </p>
        </div>
        <Button onClick={() => navigate('/upload')}>
          <Upload className="h-4 w-4" />
          Upload proposals
        </Button>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {/* The queues come first: these are the items that need a human. */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              icon={Copy}
              label="Possible duplicates"
              value={totals?.awaiting_review ?? 0}
              tone={totals?.awaiting_review ? 'warning' : 'default'}
              hint="Waiting on a decision to evaluate or skip"
              onClick={() => navigate('/review')}
            />
            <StatTile
              icon={RotateCcw}
              label="Failed"
              value={totals?.failed ?? 0}
              tone={totals?.failed ? 'danger' : 'default'}
              hint="Retryable — the original document is still stored"
              onClick={() => navigate('/proposals?status=failed')}
            />
            <StatTile
              icon={FileStack}
              label="Not evaluated"
              value={totals?.not_evaluated ?? 0}
              hint="Metadata held; evaluate any of these without re-uploading"
              onClick={() => navigate('/proposals?is_evaluated=false')}
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

          {/* (e) The most consequential warning on this page. */}
          {multiCategory.length > 0 && (
            <section className="glass-card-static mt-6 rounded-2xl border-l-4 border-l-amber-400 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-text">
                    One company approved across multiple categories
                  </h2>
                  <p className="mt-0.5 text-xs text-text-muted">
                    These companies already hold approved ideas in more than one domain.
                    Check before granting them another slot.
                  </p>

                  <div className="mt-3 space-y-2">
                    {multiCategory.map((company) => (
                      <div
                        key={company.company_id}
                        className="flex items-center justify-between rounded-lg bg-amber-50/70 px-3 py-2"
                      >
                        <span className="flex items-center gap-2 text-sm font-medium text-text">
                          <Building2 className="h-4 w-4 text-amber-600" />
                          {company.name}
                        </span>
                        <span className="text-xs text-amber-800">
                          {company.approved_count} approved ·{' '}
                          {company.categories_spanned} categories
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {/* (d) Approvals per category */}
            <section className="glass-card-static rounded-2xl p-5">
              <header className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderTree className="h-4 w-4 text-text-secondary" />
                  <h2 className="text-sm font-semibold text-text">Approvals by category</h2>
                </div>
                <Link to="/analytics" className="text-xs text-primary hover:underline">
                  View all
                </Link>
              </header>

              {categoryData.length === 0 ? (
                <EmptyState
                  icon={FolderTree}
                  title="No approvals yet"
                  description="Categories appear here as ideas are approved. The taxonomy is discovered from the proposals themselves — nothing is predefined."
                />
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart
                      data={categoryData}
                      layout="vertical"
                      margin={{ left: 8, right: 16 }}
                    >
                      <CartesianGrid horizontal={false} stroke="#f0f0ee" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={116}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip
                        cursor={{ fill: '#f7f7f5' }}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Bar dataKey="approved_count" name="Approved" radius={[0, 4, 4, 0]}>
                        {categoryData.map((entry) => (
                          <Cell
                            key={entry.category_id}
                            // More than one approval in a category is precisely what the
                            // client wants to avoid — so it reads as a warning, not a win.
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
            </section>

            {/* (f) Timeline */}
            <section className="glass-card-static rounded-2xl p-5">
              <header className="mb-4 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-text-secondary" />
                <h2 className="text-sm font-semibold text-text">Approvals over time</h2>
              </header>

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
            </section>
          </div>

          <section className="glass-card-static mt-6 rounded-2xl p-5">
            <header className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-text-secondary" />
                <h2 className="text-sm font-semibold text-text">Recent activity</h2>
              </div>
              <Link to="/proposals" className="text-xs text-primary hover:underline">
                All proposals
              </Link>
            </header>

            {!recent?.proposals.length ? (
              <EmptyState
                icon={Layers}
                title="No proposals yet"
                description="Upload one or more documents to begin. Batch upload is supported."
                action={
                  <Button size="sm" onClick={() => navigate('/upload')}>
                    <Upload className="h-4 w-4" />
                    Upload
                  </Button>
                }
              />
            ) : (
              <div className="divide-y divide-border/60">
                {recent.proposals.map((proposal) => (
                  <Link
                    key={proposal.id}
                    to={`/proposals/${proposal.id}`}
                    className="flex items-center justify-between gap-4 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent-light/30"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text">
                        {proposal.title || proposal.filename}
                      </p>
                      <p className="truncate text-xs text-text-muted">
                        {proposal.company_name ?? 'Company not identified'}
                        {proposal.category_label && ` · ${proposal.category_label}`}
                      </p>
                    </div>
                    <StatusBadge status={proposal.status} />
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </AppLayout>
  );
}
