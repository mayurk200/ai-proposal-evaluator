import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  FileText, TrendingUp, Brain, Clock, Award,
  ArrowUpRight, Sparkles
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, Radar, PieChart, Pie, Cell
} from 'recharts';
import { Card, Badge, ScoreBadge, Skeleton, Progress } from '@/components/ui';
import { AppLayout } from '@/components/layout/AppLayout';
import { aiApi } from '@/services/proposal.service';
import { useAuthStore } from '@/store/authStore';
import { formatDate, getStatusColor, getScoreColor } from '@/utils';

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5 },
  }),
};

const COLORS = ['#2E7D32', '#66BB6A', '#C8E6C9', '#81C784', '#A5D6A7'];

function StatCard({ icon: Icon, label, value, change, index }: {
  icon: any; label: string; value: string | number; change?: string; index: number;
}) {
  return (
    <motion.div custom={index} initial="hidden" animate="visible" variants={fadeUp}>
      <Card className="relative overflow-hidden">
        <div className="absolute top-0 right-0 w-24 h-24 bg-accent/20 rounded-full -translate-y-8 translate-x-8" />
        <div className="flex items-start justify-between relative">
          <div>
            <p className="text-sm text-text-muted font-medium">{label}</p>
            <p className="text-3xl font-bold text-text mt-1">{value}</p>
            {change && (
              <div className="flex items-center gap-1 mt-2">
                <ArrowUpRight className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-medium text-primary">{change}</span>
              </div>
            )}
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
  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: aiApi.getDashboard,
  });

  if (isLoading) {
    return (
      <AppLayout>
        <DashboardSkeleton />
      </AppLayout>
    );
  }

  const scoreHistoryData = stats?.scoreHistory?.map((s, i) => ({
    name: `#${i + 1}`,
    overall: s.overallScore,
    problemRelevance: s.problemRelevanceScore || 0,
    solutionReadiness: s.solutionReadinessScore || 0,
    pilotDesign: s.pilotDesignScore || 0,
    farmerAdoption: s.farmerAdoptionScore || 0,
    scaleUp: s.scaleUpScore || 0,
    teamCapacity: s.teamCapacityScore || 0,
    compliance: s.complianceScore || 0,
  })) || [];

  const categoryData = stats?.categoryStats?.map((c) => ({
    name: c.recommendation,
    value: c._count,
  })) || [];

  const radarData = stats?.topProposals?.[0] ? [
    { metric: 'Problem Relevance', value: stats.topProposals[0].problemRelevanceScore || 0 },
    { metric: 'Solution Readiness', value: stats.topProposals[0].solutionReadinessScore || 0 },
    { metric: 'Pilot Design', value: stats.topProposals[0].pilotDesignScore || 0 },
    { metric: 'Farmer Adoption', value: stats.topProposals[0].farmerAdoptionScore || 0 },
    { metric: 'Scale-up', value: stats.topProposals[0].scaleUpScore || 0 },
    { metric: 'Team Capacity', value: stats.topProposals[0].teamCapacityScore || 0 },
    { metric: 'Compliance', value: stats.topProposals[0].complianceScore || 0 },
  ] : [];

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold text-text">
            Welcome back, <span className="text-gradient">{user?.name?.split(' ')[0] || 'Guest'}</span>
          </h1>
          <p className="text-sm text-text-muted mt-1">Here's your proposal evaluation overview</p>
        </motion.div>

        {/* Stat Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          <StatCard icon={FileText} label="Total Proposals" value={stats?.totalProposals || 0} index={0} />
          <StatCard icon={Award} label="Evaluated" value={stats?.evaluatedProposals || 0} index={1} />
          <StatCard icon={TrendingUp} label="Average Score" value={stats?.averageScore || 0} index={2} />
          <StatCard icon={Clock} label="Pending" value={stats?.pendingProposals || 0} index={3} />
        </div>

        {/* Charts Row */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Score Trend */}
          <motion.div custom={4} initial="hidden" animate="visible" variants={fadeUp} className="lg:col-span-2">
            <Card hover={false}>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-base font-semibold text-text">Score Trends</h3>
                  <p className="text-xs text-text-muted mt-0.5">Evaluation scores over time</p>
                </div>
                <div className="flex items-center gap-4 text-xs text-text-muted">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-primary" /> Overall</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Solution Readiness</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={scoreHistoryData}>
                  <defs>
                    <linearGradient id="colorOverall" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2E7D32" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#2E7D32" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorReadiness" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#D97706" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#D97706" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="name" fontSize={12} stroke="#94A3B8" />
                  <YAxis fontSize={12} stroke="#94A3B8" domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(255,255,255,0.9)',
                      backdropFilter: 'blur(12px)',
                      border: '1px solid rgba(255,255,255,0.4)',
                      borderRadius: '12px',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                    }}
                  />
                  <Area type="monotone" dataKey="overall" stroke="#2E7D32" strokeWidth={2.5} fill="url(#colorOverall)" />
                  <Area type="monotone" dataKey="solutionReadiness" stroke="#D97706" strokeWidth={2} fill="url(#colorReadiness)" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </motion.div>

          {/* Distribution or Radar */}
          <motion.div custom={5} initial="hidden" animate="visible" variants={fadeUp}>
            <Card hover={false} className="h-full">
              <h3 className="text-base font-semibold text-text mb-4">
                {radarData.length > 0 ? 'Top Proposal Profile' : 'Category Distribution'}
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                {radarData.length > 0 ? (
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#E2E8F0" />
                    <PolarAngleAxis dataKey="metric" fontSize={11} stroke="#64748B" />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar
                      dataKey="value"
                      stroke="#2E7D32"
                      fill="#2E7D32"
                      fillOpacity={0.15}
                      strokeWidth={2}
                    />
                  </RadarChart>
                ) : (
                  <PieChart>
                    <Pie
                      data={categoryData.length > 0 ? categoryData : [{ name: 'No data', value: 1 }]}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {(categoryData.length > 0 ? categoryData : [{ name: 'No data' }]).map((_, idx) => (
                        <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                )}
              </ResponsiveContainer>
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
                {stats?.recentProposals?.length ? stats.recentProposals.map((p) => (
                  <Link key={p.id} to={`/proposals/${p.id}`}>
                    <div className="flex items-center justify-between p-3 rounded-xl hover:bg-accent-light/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-accent/40 flex items-center justify-center">
                          <FileText className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text truncate max-w-[200px]">{p.title}</p>
                          <p className="text-xs text-text-muted">{formatDate(p.createdAt)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${getStatusColor(p.status)}`}>
                          {p.status}
                        </span>
                        {p.evaluation && <ScoreBadge score={p.evaluation.overallScore} size="sm" />}
                      </div>
                    </div>
                  </Link>
                )) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-text-muted">No proposals yet</p>
                    <Link to="/upload" className="text-sm text-primary font-medium mt-1 inline-block">Upload your first →</Link>
                  </div>
                )}
              </div>
            </Card>
          </motion.div>

          {/* AI Insights */}
          <motion.div custom={7} initial="hidden" animate="visible" variants={fadeUp}>
            <Card hover={false}>
              <div className="flex items-center gap-2 mb-5">
                <Sparkles className="w-5 h-5 text-primary" />
                <h3 className="text-base font-semibold text-text">AI Insights</h3>
              </div>
              <div className="space-y-4">
                {stats?.topProposals?.length ? (
                  <>
                    <div className="p-4 rounded-xl bg-accent-light/50 border border-accent/30">
                      <p className="text-sm font-medium text-primary">Top Performer</p>
                      <p className="text-lg font-bold text-text mt-1">
                        {stats.topProposals[0]?.proposal?.title}
                      </p>
                      <p className="text-xs text-text-muted mt-1">
                        Score: {stats.topProposals[0]?.overallScore}/100 — {stats.topProposals[0]?.recommendation}
                      </p>
                    </div>
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-text-muted uppercase tracking-wider">Score Breakdown</p>
                      {[
                        { label: 'Problem Relevance', value: stats.topProposals[0]?.problemRelevanceScore },
                        { label: 'Solution Readiness', value: stats.topProposals[0]?.solutionReadinessScore },
                        { label: 'Pilot Design', value: stats.topProposals[0]?.pilotDesignScore },
                        { label: 'Farmer Adoption', value: stats.topProposals[0]?.farmerAdoptionScore },
                        { label: 'Scale-up Potential', value: stats.topProposals[0]?.scaleUpScore },
                        { label: 'Team Capacity', value: stats.topProposals[0]?.teamCapacityScore },
                        { label: 'Compliance', value: stats.topProposals[0]?.complianceScore },
                      ].map((item) => (
                        <div key={item.label}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-text-secondary">{item.label}</span>
                            <span className={`font-medium ${getScoreColor(item.value || 0)}`}>
                              {Math.round(item.value || 0)}
                            </span>
                          </div>
                          <Progress value={item.value || 0} className="h-1.5" />
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8">
                    <Brain className="w-10 h-10 text-text-muted mx-auto mb-2" />
                    <p className="text-sm text-text-muted">AI insights will appear after your first evaluation</p>
                  </div>
                )}
              </div>
            </Card>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
}
