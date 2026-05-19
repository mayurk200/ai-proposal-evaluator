import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { GitCompare, Check, Loader2 } from 'lucide-react';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, ScoreBadge } from '@/components/ui';
import { proposalApi, aiApi } from '@/services/proposal.service';
import type { Proposal } from '@/types';

const COLORS = ['#2E7D32', '#1565C0', '#E65100', '#6A1B9A', '#00838F'];

export default function ComparePage() {
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [result, setResult] = useState<any>(null);
  const { data } = useQuery({ queryKey: ['proposals', 1], queryFn: () => proposalApi.getAll(1, 50) });
  const compareMut = useMutation({
    mutationFn: () => aiApi.compare(selected, title || 'Comparison'),
    onSuccess: (data) => setResult(data),
  });
  const evaluated = data?.proposals?.filter((p: Proposal) => p.status === 'EVALUATED' && p.evaluation) || [];
  const toggle = (id: string) => setSelected(p => p.includes(id) ? p.filter(x => x !== id) : p.length < 5 ? [...p, id] : p);
  const selectedProposals = evaluated.filter((p: Proposal) => selected.includes(p.id));
  const radarData = selectedProposals.length > 0 ? ['Innovation', 'Market', 'Financial', 'Sustainability', 'Risk'].map(metric => {
    const d: any = { metric };
    selectedProposals.forEach((p: Proposal, i: number) => { if (p.evaluation) {
      const key = metric.toLowerCase();
      d[`p${i}`] = key === 'innovation' ? p.evaluation.innovationScore : key === 'market' ? p.evaluation.marketScore : key === 'financial' ? p.evaluation.financialScore : key === 'sustainability' ? p.evaluation.sustainabilityScore : p.evaluation.riskScore;
    }});
    return d;
  }) : [];
  const barData = selectedProposals.map((p: Proposal) => ({
    name: p.title.slice(0, 20), overall: p.evaluation?.overallScore || 0,
    innovation: p.evaluation?.innovationScore || 0, market: p.evaluation?.marketScore || 0,
  }));
  return (
    <AppLayout>
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h1 className="text-2xl font-bold text-text">Compare Proposals</h1>
          <p className="text-sm text-text-muted mt-1">Select 2-5 evaluated proposals to compare</p>
        </motion.div>
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <Card hover={false}>
              <h3 className="text-sm font-semibold mb-3">Select Proposals ({selected.length}/5)</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {evaluated.length === 0 ? <p className="text-sm text-text-muted py-4 text-center">No evaluated proposals</p> : evaluated.map((p: Proposal) => (
                  <button key={p.id} onClick={() => toggle(p.id)} className={`w-full text-left p-3 rounded-xl border transition-all ${selected.includes(p.id) ? 'border-primary bg-accent-light/50' : 'border-transparent hover:bg-gray-50'}`}>
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.title}</p>
                        <p className="text-xs text-text-muted mt-0.5">Score: {p.evaluation?.overallScore}</p>
                      </div>
                      {selected.includes(p.id) && <Check className="w-5 h-5 text-primary flex-shrink-0" />}
                    </div>
                  </button>
                ))}
              </div>
              {selected.length >= 2 && (
                <div className="mt-4 space-y-3">
                  <Input placeholder="Comparison title" value={title} onChange={e => setTitle(e.target.value)} />
                  <Button onClick={() => compareMut.mutate()} loading={compareMut.isPending} className="w-full">
                    <GitCompare className="w-4 h-4" /> Compare
                  </Button>
                </div>
              )}
            </Card>
          </div>
          <div className="lg:col-span-2 space-y-6">
            {selected.length >= 2 && (
              <>
                <Card hover={false}>
                  <h3 className="text-base font-semibold mb-4">Score Comparison</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="#E2E8F0" />
                      <PolarAngleAxis dataKey="metric" fontSize={11} stroke="#64748B" />
                      <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                      {selectedProposals.map((_: Proposal, i: number) => (
                        <Radar key={i} dataKey={`p${i}`} stroke={COLORS[i]} fill={COLORS[i]} fillOpacity={0.1} strokeWidth={2} name={selectedProposals[i]?.title?.slice(0, 15)} />
                      ))}
                      <Legend />
                    </RadarChart>
                  </ResponsiveContainer>
                </Card>
                <Card hover={false}>
                  <h3 className="text-base font-semibold mb-4">Overall Comparison</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={barData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="name" fontSize={11} stroke="#94A3B8" />
                      <YAxis domain={[0, 100]} fontSize={11} stroke="#94A3B8" />
                      <Tooltip />
                      <Bar dataKey="overall" fill="#2E7D32" radius={[6, 6, 0, 0]} name="Overall" />
                      <Bar dataKey="innovation" fill="#66BB6A" radius={[6, 6, 0, 0]} name="Innovation" />
                      <Bar dataKey="market" fill="#C8E6C9" radius={[6, 6, 0, 0]} name="Market" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
                <div className="grid md:grid-cols-2 gap-4">
                  {selectedProposals.map((p: Proposal, i: number) => (
                    <Card key={p.id} hover={false} className="border-l-4" style={{ borderLeftColor: COLORS[i] }}>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold truncate">{p.title}</p>
                        <ScoreBadge score={p.evaluation?.overallScore || 0} />
                      </div>
                      <p className="text-xs text-text-muted">{p.evaluation?.recommendation}</p>
                    </Card>
                  ))}
                </div>
              </>
            )}
            {result && (
              <Card hover={false}>
                <h3 className="text-base font-semibold mb-3">AI Comparison Summary</h3>
                <p className="text-sm text-text-secondary leading-relaxed">{result.summary || result.result?.comparison_summary}</p>
              </Card>
            )}
            {selected.length < 2 && (
              <Card hover={false} className="text-center py-16">
                <GitCompare className="w-12 h-12 text-text-muted mx-auto mb-3" />
                <p className="text-text-secondary">Select at least 2 proposals to compare</p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
