import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Brain, FileText, Loader2, CheckCircle, AlertTriangle, TrendingUp, Shield, Sprout, Lightbulb, DollarSign, Target, Bookmark } from 'lucide-react';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, ScoreBadge, Progress, Skeleton } from '@/components/ui';
import { proposalApi, aiApi } from '@/services/proposal.service';
import { formatDate, getScoreColor, getRecommendationColor } from '@/utils';
import { useAuthStore } from '@/store/authStore';

export default function ProposalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();
  const qc = useQueryClient();
  const { data: proposal, isLoading } = useQuery({
    queryKey: ['proposal', id], queryFn: () => proposalApi.getById(id!), enabled: !!id,
  });
  const evalMut = useMutation({
    mutationFn: () => aiApi.evaluate(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposal', id] }),
  });
  if (isLoading) return <AppLayout><div className="space-y-6">{[1,2,3].map(i => <Card key={i} hover={false}><Skeleton className="h-32 w-full" /></Card>)}</div></AppLayout>;
  if (!proposal) return <AppLayout><Card hover={false} className="text-center py-16"><p>Proposal not found</p></Card></AppLayout>;
  const ev = proposal.evaluation;
  const radarData = ev ? [
    { metric: 'Innovation', value: ev.innovationScore, fullMark: 100 },
    { metric: 'Market', value: ev.marketScore, fullMark: 100 },
    { metric: 'Financial', value: ev.financialScore, fullMark: 100 },
    { metric: 'Sustainability', value: ev.sustainabilityScore, fullMark: 100 },
    { metric: 'Agriculture', value: ev.agricultureScore, fullMark: 100 },
    { metric: 'Risk', value: ev.riskScore, fullMark: 100 },
  ] : [];
  const barData = ev ? [
    { name: 'Innovation', score: ev.innovationScore, weight: '20%' },
    { name: 'Market', score: ev.marketScore, weight: '20%' },
    { name: 'Agriculture', score: ev.agricultureScore, weight: '20%' },
    { name: 'Financial', score: ev.financialScore, weight: '15%' },
    { name: 'Scalability', score: ev.scalabilityScore, weight: '10%' },
    { name: 'Sustainability', score: ev.sustainabilityScore, weight: '10%' },
    { name: 'Risk', score: ev.riskScore, weight: '5%' },
  ] : [];
  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent/40 flex items-center justify-center"><FileText className="w-6 h-6 text-primary" /></div>
            <div>
              <h1 className="text-xl font-bold text-text">{proposal.title}</h1>
              <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                <span>{formatDate(proposal.createdAt)}</span><span>{proposal.fileName}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {!isAuthenticated && (
              <Button variant="outline" onClick={() => navigate(`/login?claimId=${id}`)}>
                <Bookmark className="w-4 h-4 mr-2" /> Save to Dashboard
              </Button>
            )}
            {!ev && proposal.status !== 'EVALUATING' && proposal.status !== 'EXTRACTING' && (
              <Button onClick={() => evalMut.mutate()} loading={evalMut.isPending}>
                <Brain className="w-4 h-4 mr-2" /> Run AI Evaluation
              </Button>
            )}
            {(proposal.status === 'EVALUATING' || proposal.status === 'EXTRACTING') && (
              <Badge variant="info"><Loader2 className="w-3 h-3 animate-spin mr-1" /> Processing...</Badge>
            )}
          </div>
        </motion.div>

        {/* Evaluation Results */}
        {ev ? (
          <>
            {/* Score Overview */}
            <div className="grid md:grid-cols-4 gap-4">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <Card hover={false} className="text-center">
                  <p className="text-sm text-text-muted mb-2">Overall Score</p>
                  <div className="text-5xl font-bold text-gradient">{Math.round(ev.overallScore)}</div>
                  <span className={`inline-block mt-2 text-xs font-medium px-3 py-1 rounded-lg border ${getRecommendationColor(ev.recommendation)}`}>{ev.recommendation}</span>
                </Card>
              </motion.div>
              {[
                { icon: Lightbulb, label: 'Innovation', score: ev.innovationScore, color: 'text-blue-600' },
                { icon: Target, label: 'Market', score: ev.marketScore, color: 'text-purple-600' },
                { icon: DollarSign, label: 'Financial', score: ev.financialScore, color: 'text-emerald-600' },
              ].map((item, i) => (
                <motion.div key={item.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.05 }}>
                  <Card hover={false}>
                    <div className="flex items-center gap-2 mb-3">
                      <item.icon className={`w-4 h-4 ${item.color}`} />
                      <p className="text-sm text-text-muted">{item.label}</p>
                    </div>
                    <p className={`text-2xl font-bold ${getScoreColor(item.score)}`}>{Math.round(item.score)}</p>
                    <Progress value={item.score} className="mt-2" />
                  </Card>
                </motion.div>
              ))}
            </div>

            {/* Charts */}
            <div className="grid lg:grid-cols-2 gap-6">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
                <Card hover={false}>
                  <h3 className="text-base font-semibold mb-4">Score Profile</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="#E2E8F0" />
                      <PolarAngleAxis dataKey="metric" fontSize={11} stroke="#64748B" />
                      <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                      <Radar dataKey="value" stroke="#2E7D32" fill="#2E7D32" fillOpacity={0.15} strokeWidth={2} />
                    </RadarChart>
                  </ResponsiveContainer>
                </Card>
              </motion.div>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
                <Card hover={false}>
                  <h3 className="text-base font-semibold mb-4">Weighted Scores</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={barData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis type="number" domain={[0, 100]} fontSize={11} stroke="#94A3B8" />
                      <YAxis type="category" dataKey="name" fontSize={11} stroke="#94A3B8" width={90} />
                      <Tooltip contentStyle={{ background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.4)', borderRadius: '12px' }} />
                      <Bar dataKey="score" fill="#2E7D32" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </motion.div>
            </div>

            {/* Summary */}
            <Card hover={false}>
              <h3 className="text-base font-semibold mb-3">AI Summary</h3>
              <p className="text-sm text-text-secondary leading-relaxed">{ev.summary}</p>
            </Card>

            {/* SWOT */}
            <div className="grid md:grid-cols-2 gap-4">
              {[
                { title: 'Strengths', items: ev.swotAnalysis?.strengths, icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50' },
                { title: 'Weaknesses', items: ev.swotAnalysis?.weaknesses, icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50' },
                { title: 'Opportunities', items: ev.swotAnalysis?.opportunities, icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50' },
                { title: 'Threats', items: ev.swotAnalysis?.threats, icon: Shield, color: 'text-yellow-600', bg: 'bg-yellow-50' },
              ].map((s, i) => (
                <motion.div key={s.title} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + i * 0.05 }}>
                  <Card hover={false} className="h-full">
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-7 h-7 rounded-lg ${s.bg} flex items-center justify-center`}><s.icon className={`w-4 h-4 ${s.color}`} /></div>
                      <h4 className="text-sm font-semibold">{s.title}</h4>
                    </div>
                    <ul className="space-y-2">
                      {(s.items || []).map((item, j) => (
                        <li key={j} className="text-sm text-text-secondary flex items-start gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${s.color.replace('text-', 'bg-')} mt-1.5 flex-shrink-0`} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </Card>
                </motion.div>
              ))}
            </div>

            {/* Strengths & Weaknesses */}
            <div className="grid md:grid-cols-2 gap-4">
              <Card hover={false}>
                <h3 className="text-sm font-semibold text-green-700 mb-3">Key Strengths</h3>
                <ul className="space-y-2">{(ev.strengths || []).map((s, i) => <li key={i} className="text-sm text-text-secondary flex items-start gap-2"><CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />{s}</li>)}</ul>
              </Card>
              <Card hover={false}>
                <h3 className="text-sm font-semibold text-red-600 mb-3">Key Weaknesses</h3>
                <ul className="space-y-2">{(ev.weaknesses || []).map((w, i) => <li key={i} className="text-sm text-text-secondary flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />{w}</li>)}</ul>
              </Card>
            </div>
          </>
        ) : (
          <Card hover={false} className="text-center py-16">
            <Brain className="w-14 h-14 text-text-muted mx-auto mb-4" />
            <h3 className="text-lg font-semibold">Not Evaluated Yet</h3>
            <p className="text-sm text-text-muted mt-1 mb-4">Run AI evaluation to analyze this proposal</p>
            <Button onClick={() => evalMut.mutate()} loading={evalMut.isPending}><Brain className="w-4 h-4" /> Run Evaluation</Button>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
