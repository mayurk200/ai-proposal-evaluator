import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  FileText, TrendingUp, Loader2, Clock, Award,
  Sparkles, Leaf, AlertTriangle, Inbox, type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, Skeleton, Progress, ScoreBadge } from '@/components/ui';
import { AppLayout } from '@/components/layout/AppLayout';
import { uploadApi, type ProcessedProposal } from '@/services/proposal.service';
import { useAuthStore } from '@/store/authStore';
import { formatDate } from '@/utils';

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5 },
  }),
};

/** Turn a kebab-case category slug into a readable label. */
function labelForCategory(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

const STATUS_STYLES: Record<string, string> = {
  categorized: 'bg-green-100 text-green-700',
  categorizing: 'bg-blue-100 text-blue-700',
  extracting: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-700',
};

function StatusBadge({ status }: { status?: string }) {
  const s = (status || '').toLowerCase();
  const style = STATUS_STYLES[s] || 'bg-accent/40 text-text-secondary';
  const isBusy = s === 'categorizing' || s === 'extracting';
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md font-medium ${style}`}>
      {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
      {s || 'unknown'}
    </span>
  );
}

function titleFor(p: ProcessedProposal): string {
  return p.categorization?.title || p.filename || 'Untitled proposal';
}

function StatCard({ icon: Icon, label, value, sub, index }: {
  icon: LucideIcon; label: string; value: string | number; sub?: string; index: number;
}) {
  return (
    <motion.div custom={index} initial="hidden" animate="visible" variants={fadeUp}>
      <Card className="relative overflow-hidden">
        <div className="absolute top-0 right-0 w-24 h-24 bg-accent/20 rounded-full -translate-y-8 translate-x-8" />
        <div className="flex items-start justify-between relative">
          <div>
            <p className="text-sm text-text-muted font-medium">{label}</p>
            <p className="text-3xl font-bold text-text mt-1">{value}</p>
            {sub && <p className="text-xs text-text-muted mt-2">{sub}</p>}
          </div>
          <div className="w-11 h-11 rounded-xl bg-accent/40 flex items-center justify-center">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} hover={false}>
            <Skeleton className="h-4 w-24 mb-3" />
            <Skeleton className="h-8 w-16 mb-2" />
            <Skeleton className="h-3 w-20" />
          </Card>
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-6">
        <Card hover={false} className="lg:col-span-2"><Skeleton className="h-64 w-full" /></Card>
        <Card hover={false}><Skeleton className="h-64 w-full" /></Card>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuthStore();

  // All three sources are the same live APIs the Proposals page uses.
  const { data: processed, isLoading: loadingProposals } = useQuery({
    queryKey: ['dashboard-processed'],
    queryFn: () => uploadApi.listProcessed({ limit: 100 }),
    refetchInterval: 15000,
  });
  const { data: categories, isLoading: loadingCategories } = useQuery({
    queryKey: ['dashboard-categories'],
    queryFn: uploadApi.listCategories,
    refetchInterval: 15000,
  });
  const { data: storedFiles } = useQuery({
    queryKey: ['dashboard-files'],
    queryFn: uploadApi.list,
    refetchInterval: 15000,
  });

  if (loadingProposals || loadingCategories) {
    return (
      <AppLayout>
        <DashboardSkeleton />
      </AppLayout>
    );
  }

  const proposals = processed?.proposals ?? [];
  const total = processed?.total ?? proposals.length;

  const categorized = proposals.filter((p) => (p.status || '').toLowerCase() === 'categorized');
  const processing = proposals.filter((p) =>
    ['categorizing', 'extracting'].includes((p.status || '').toLowerCase()));
  const failed = proposals.filter((p) => (p.status || '').toLowerCase() === 'failed');
  const agriRelevant = categorized.filter((p) => p.agri_relevant);
  const awaiting = storedFiles?.count ?? 0;

  // "rank" is the agent's 0–100 triage score (labelled "Score" in the UI).
  const scored = categorized
    .filter((p) => typeof p.rank === 'number')
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  const averageScore = scored.length
    ? Math.round(scored.reduce((sum, p) => sum + (p.rank ?? 0), 0) / scored.length)
    : null;

  const scoreChartData = scored.map((p) => ({
    id: p.id,
    name: titleFor(p),
    score: p.rank ?? 0,
  }));

  const categoryData = (categories ?? [])
    .slice()
    .sort((a, b) => b.count - a.count);
  const maxCategoryCount = categoryData.length
    ? Math.max(...categoryData.map((c) => c.count))
    : 0;

  const recent = proposals
    .slice()
    .sort((a, b) =>
      new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
    .slice(0, 5);

  const top = scored[0];

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold text-text">
            Welcome back, <span className="text-gradient">{user?.name?.split(' ')[0] || 'Guest'}</span>
          </h1>
          <p className="text-sm text-text-muted mt-1">Live overview of your proposal pipeline</p>
        </motion.div>

        {/* Stat Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          <StatCard
            icon={FileText}
            label="Total Proposals"
            value={total}
            sub={failed.length ? `${failed.length} failed` : undefined}
            index={0}
          />
          <StatCard
            icon={Award}
            label="Categorized"
            value={categorized.length}
            sub={processing.length ? `${processing.length} processing` : undefined}
            index={1}
          />
          <StatCard
            icon={TrendingUp}
            label="Average Score"
            value={averageScore ?? '—'}
            sub={agriRelevant.length ? `${agriRelevant.length} agri-relevant` : undefined}
            index={2}
          />
          <StatCard
            icon={Clock}
            label="Awaiting Processing"
            value={awaiting}
            sub="files uploaded, not yet processed"
            index={3}
          />
        </div>

        {/* Charts Row */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Proposal scores */}
          <motion.div custom={4} initial="hidden" animate="visible" variants={fadeUp} className="lg:col-span-2">
            <Card hover={false}>
              <div className="mb-6">
                <h3 className="text-base font-semibold text-text">Proposal Scores</h3>
                <p className="text-xs text-text-muted mt-0.5">
                  AI triage score (0–100) for each categorized proposal
                </p>
              </div>
              {scoreChartData.length ? (
                <ResponsiveContainer width="100%" height={Math.max(120, scoreChartData.length * 48)}>
                  <BarChart data={scoreChartData} layout="vertical" barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} fontSize={12} stroke="#94A3B8" />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={170}
                      fontSize={12}
                      stroke="#64748B"
                      tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(46,125,50,0.06)' }}
                      formatter={(value) => [`${value ?? 0}/100`, 'Score']}
                      contentStyle={{
                        background: 'rgba(255,255,255,0.95)',
                        border: '1px solid #E2E8F0',
                        borderRadius: '12px',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                      }}
                    />
                    <Bar dataKey="score" fill="#2E7D32" barSize={18} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center py-12">
                  <Inbox className="w-10 h-10 text-text-muted mx-auto mb-2" />
                  <p className="text-sm text-text-muted">No categorized proposals yet</p>
                  <Link to="/proposals" className="text-sm text-primary font-medium mt-1 inline-block">
                    Process your uploads →
                  </Link>
                </div>
              )}
            </Card>
          </motion.div>

          {/* Category distribution */}
          <motion.div custom={5} initial="hidden" animate="visible" variants={fadeUp}>
            <Card hover={false} className="h-full">
              <div className="mb-5">
                <h3 className="text-base font-semibold text-text">Category Distribution</h3>
                <p className="text-xs text-text-muted mt-0.5">Proposals per agri category</p>
              </div>
              {categoryData.length ? (
                <div className="space-y-3">
                  {categoryData.map((c) => (
                    <div key={c.category}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-secondary">{labelForCategory(c.category)}</span>
                        <span className="font-medium text-text">{c.count}</span>
                      </div>
                      <Progress value={c.count} max={maxCategoryCount} className="h-1.5" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Leaf className="w-10 h-10 text-text-muted mx-auto mb-2" />
                  <p className="text-sm text-text-muted">Categories appear once proposals are processed</p>
                </div>
              )}
            </Card>
          </motion.div>
        </div>

        {/* Recent & Top Row */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Recent Proposals */}
          <motion.div custom={6} initial="hidden" animate="visible" variants={fadeUp}>
            <Card hover={false}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-semibold text-text">Recent Proposals</h3>
                <Link to="/proposals" className="text-xs text-primary font-medium hover:underline">View all →</Link>
              </div>
              <div className="space-y-3">
                {recent.length ? recent.map((p) => (
                  <Link key={p.id} to="/proposals">
                    <div className="flex items-center justify-between p-3 rounded-xl hover:bg-accent-light/50 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-accent/40 flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-text truncate max-w-[220px]">{titleFor(p)}</p>
                          <p className="text-xs text-text-muted">
                            {p.created_at ? formatDate(p.created_at) : '—'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={p.status} />
                        {(p.status || '').toLowerCase() === 'categorized' && typeof p.rank === 'number' && (
                          <ScoreBadge score={p.rank} size="sm" />
                        )}
                      </div>
                    </div>
                  </Link>
                )) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-text-muted">No proposals yet</p>
                    <Link to="/proposals" className="text-sm text-primary font-medium mt-1 inline-block">Upload your first →</Link>
                  </div>
                )}
              </div>
            </Card>
          </motion.div>

          {/* Top Proposal */}
          <motion.div custom={7} initial="hidden" animate="visible" variants={fadeUp}>
            <Card hover={false}>
              <div className="flex items-center gap-2 mb-5">
                <Sparkles className="w-5 h-5 text-primary" />
                <h3 className="text-base font-semibold text-text">Top Proposal</h3>
              </div>
              {top ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-accent-light/50 border border-accent/30">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-lg font-bold text-text truncate">{titleFor(top)}</p>
                        {top.filename && (
                          <p className="text-xs text-text-muted mt-0.5 truncate">{top.filename}</p>
                        )}
                      </div>
                      <ScoreBadge score={top.rank ?? 0} />
                    </div>
                    {top.categorization?.summary && (
                      <p className="text-sm text-text-secondary mt-3 line-clamp-3">
                        {top.categorization.summary}
                      </p>
                    )}
                  </div>

                  {(top.categories?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">Categories</p>
                      <div className="flex flex-wrap gap-1.5">
                        {top.categories!.map((c) => (
                          <span key={c} className="text-xs px-2.5 py-1 rounded-lg bg-accent/40 text-text-secondary font-medium">
                            {labelForCategory(c)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="p-3 rounded-xl bg-accent-light/30">
                      <p className="text-xs text-text-muted">Agri relevance</p>
                      <p className="font-medium text-text mt-0.5 flex items-center gap-1.5">
                        {top.agri_relevant
                          ? <><Leaf className="w-3.5 h-3.5 text-primary" /> Relevant</>
                          : <><AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Not relevant</>}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-accent-light/30">
                      <p className="text-xs text-text-muted">Agent confidence</p>
                      <p className="font-medium text-text mt-0.5">
                        {typeof top.categorization?.confidence === 'number'
                          ? `${Math.round(top.categorization.confidence * 100)}%`
                          : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Inbox className="w-10 h-10 text-text-muted mx-auto mb-2" />
                  <p className="text-sm text-text-muted">Insights will appear after your first proposal is processed</p>
                </div>
              )}
            </Card>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
}
