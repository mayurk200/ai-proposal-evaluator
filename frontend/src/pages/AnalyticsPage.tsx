import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { BarChart3, TrendingUp, PieChart as PieIcon } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, Legend } from 'recharts';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Skeleton } from '@/components/ui';
import { aiApi } from '@/services/proposal.service';

const COLORS = ['#2E7D32', '#66BB6A', '#C8E6C9', '#81C784', '#A5D6A7', '#E8F5E9'];

export default function AnalyticsPage() {
  const { data: stats, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: aiApi.getDashboard });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-6">
          {[1, 2, 3].map(i => (
            <Card key={i} hover={false}>
              <Skeleton className="h-64 w-full" />
            </Card>
          ))}
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mb-4">
            <BarChart3 className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-lg font-semibold text-text mb-2">Failed to load analytics</h2>
          <p className="text-sm text-text-muted">Please try refreshing the page</p>
        </div>
      </AppLayout>
    );
  }

  const history = stats?.scoreHistory?.map((s: any, i: number) => ({
    name: `#${i + 1}`,
    overall: s.overallScore ?? 0,
    innovation: s.innovationScore ?? 0,
    market: s.marketScore ?? 0,
    financial: s.financialScore ?? 0,
    sustainability: s.sustainabilityScore ?? 0,
  })) || [];

  const catData = stats?.categoryStats?.map((c: any) => ({
    name: c.recommendation || 'Unknown',
    value: c._count || 0,
    avg: Math.round(c._avg?.overallScore || 0),
  })) || [];

  const scoreDistribution = [
    { range: '0-20', count: stats?.scoreHistory?.filter((s: any) => s.overallScore <= 20)?.length || 0 },
    { range: '21-40', count: stats?.scoreHistory?.filter((s: any) => s.overallScore > 20 && s.overallScore <= 40)?.length || 0 },
    { range: '41-60', count: stats?.scoreHistory?.filter((s: any) => s.overallScore > 40 && s.overallScore <= 60)?.length || 0 },
    { range: '61-80', count: stats?.scoreHistory?.filter((s: any) => s.overallScore > 60 && s.overallScore <= 80)?.length || 0 },
    { range: '81-100', count: stats?.scoreHistory?.filter((s: any) => s.overallScore > 80)?.length || 0 },
  ];

  const pieData = catData.length > 0 ? catData : [{ name: 'No data yet', value: 1, avg: 0 }];

  return (
    <AppLayout>
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h1 className="text-2xl font-bold text-text">Analytics</h1>
          <p className="text-sm text-text-muted mt-1">Track evaluation performance and trends</p>
        </motion.div>

        {/* Stat cards */}
        <div className="grid md:grid-cols-3 gap-5">
          {[
            { icon: BarChart3, label: 'Total Evaluated', val: stats?.evaluatedProposals || 0 },
            { icon: TrendingUp, label: 'Avg Score', val: stats?.averageScore || 0 },
            { icon: PieIcon, label: 'Categories', val: catData.length },
          ].map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
              <Card>
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-accent/40 flex items-center justify-center">
                    <s.icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-text-muted">{s.label}</p>
                    <p className="text-2xl font-bold">{s.val}</p>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Score Trends */}
          <Card hover={false}>
            <h3 className="text-base font-semibold mb-4">Score Trends</h3>
            {history.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="aOverall" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2E7D32" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#2E7D32" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="aInnovation" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#66BB6A" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#66BB6A" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="name" fontSize={11} stroke="#94A3B8" />
                  <YAxis domain={[0, 100]} fontSize={11} stroke="#94A3B8" />
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(255,255,255,0.9)',
                      backdropFilter: 'blur(12px)',
                      borderRadius: '12px',
                      border: '1px solid rgba(255,255,255,0.4)',
                    }}
                  />
                  <Area type="monotone" dataKey="overall" stroke="#2E7D32" strokeWidth={2} fill="url(#aOverall)" />
                  <Area type="monotone" dataKey="innovation" stroke="#66BB6A" strokeWidth={1.5} fill="url(#aInnovation)" />
                  <Legend />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-sm text-text-muted">
                No evaluation data yet. Evaluate proposals to see trends.
              </div>
            )}
          </Card>

          {/* Recommendation Distribution */}
          <Card hover={false}>
            <h3 className="text-base font-semibold mb-4">Recommendation Distribution</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={4}
                  dataKey="value"
                  label={(props: any) =>
                    `${props.name || ''} (${((props.percent || 0) * 100).toFixed(0)}%)`
                  }
                  labelLine={false}
                >
                  {pieData.map((_: any, i: number) => (
                    <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </div>

        {/* Score Distribution */}
        <Card hover={false}>
          <h3 className="text-base font-semibold mb-4">Score Distribution</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={scoreDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="range" fontSize={11} stroke="#94A3B8" />
              <YAxis fontSize={11} stroke="#94A3B8" allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#2E7D32" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </AppLayout>
  );
}
