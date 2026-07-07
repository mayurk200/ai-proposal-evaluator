import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { GitCompare, Check, Brain, Trophy, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, ScoreBadge, Skeleton } from '@/components/ui';
import { reportsApi, type FullReport, type ReportComparison } from '@/services/proposal.service';
import { formatDate, getApiErrorMessage, getRecommendationColor } from '@/utils';

const COLORS = ['#2E7D32', '#1565C0', '#E65100', '#6A1B9A', '#00838F'];

/** The 7 AIAIC parameters compared across reports (keys of FinalEvaluation). */
const PARAMETERS: { key: string; label: string }[] = [
  { key: 'problem_relevance_score', label: 'Problem Relevance' },
  { key: 'solution_readiness_score', label: 'Solution Readiness' },
  { key: 'pilot_design_score', label: 'Pilot Design' },
  { key: 'farmer_adoption_score', label: 'Farmer Adoption' },
  { key: 'scaleup_score', label: 'Scale-up Potential' },
  { key: 'team_capacity_score', label: 'Team Capacity' },
  { key: 'compliance_score', label: 'Compliance' },
];

export default function ComparePage() {
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<{ reports: FullReport[]; comparison: ReportComparison } | null>(null);

  // All completed full-evaluation reports (produced via "Evaluate" on the Proposals page).
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['evaluation-reports'],
    queryFn: () => reportsApi.list({ limit: 100, status: 'completed' }),
    retry: false,
  });
  const reports = data?.evaluations ?? [];

  const compareMut = useMutation({
    mutationFn: () => reportsApi.compare(selected),
    onSuccess: (d) => setResult({ reports: d.reports, comparison: d.comparison }),
  });

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 5 ? [...prev, id] : prev
    );

  // Order compared reports by the server ranking so colors match positions.
  const compared = result
    ? result.comparison.ranking
        .map((r) => result.reports.find((rep) => rep.id === r.id))
        .filter((r): r is FullReport => Boolean(r))
    : [];

  const radarData = compared.length
    ? PARAMETERS.map(({ key, label }) => {
        const d: Record<string, string | number> = { metric: label };
        compared.forEach((rep, i) => {
          const ev = rep.evaluation_report?.evaluation as Record<string, unknown> | undefined;
          d[`p${i}`] = typeof ev?.[key] === 'number' ? (ev[key] as number) : 0;
        });
        return d;
      })
    : [];

  const barData = compared.map((rep) => ({
    name: rep.filename.slice(0, 22),
    overall: rep.overall_score ?? 0,
  }));

  return (
    <AppLayout>
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h1 className="text-2xl font-bold text-text">Compare Proposals</h1>
          <p className="text-sm text-text-muted mt-1">
            Select 2-5 fully evaluated proposals to compare across the 7 evaluation parameters
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* ---- Selection panel ---- */}
          <div className="lg:col-span-1 space-y-4">
            <Card hover={false}>
              <h3 className="text-sm font-semibold mb-3">Evaluated proposals ({selected.length}/5 selected)</h3>
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : isError ? (
                <p className="text-sm text-red-600 py-4 text-center">
                  {getApiErrorMessage(error, 'Could not load evaluation reports.')}
                </p>
              ) : reports.length === 0 ? (
                <div className="text-center py-6">
                  <Brain className="w-10 h-10 text-text-muted mx-auto mb-3" />
                  <p className="text-sm text-text-secondary">No evaluated proposals yet</p>
                  <p className="text-xs text-text-muted mt-1 mb-4">
                    Run &ldquo;Evaluate&rdquo; on a proposal to generate its full AI evaluation.
                  </p>
                  <Link to="/proposals">
                    <Button size="sm" variant="secondary"><FileText className="w-4 h-4" /> Go to Proposals</Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {reports.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => toggle(r.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${
                        selected.includes(r.id)
                          ? 'border-primary bg-accent-light/50'
                          : 'border-transparent hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" title={r.filename}>{r.filename}</p>
                          <p className="text-xs text-text-muted mt-0.5">
                            Score: {Math.round(r.overall_score)}
                            {r.created_at ? ` · ${formatDate(r.created_at)}` : ''}
                          </p>
                        </div>
                        {selected.includes(r.id) && <Check className="w-5 h-5 text-primary flex-shrink-0" />}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {selected.length >= 2 && (
                <div className="mt-4">
                  <Button onClick={() => compareMut.mutate()} loading={compareMut.isPending} className="w-full">
                    <GitCompare className="w-4 h-4" /> Compare
                  </Button>
                  {compareMut.isError && (
                    <p className="text-xs text-red-600 mt-2">
                      {getApiErrorMessage(compareMut.error, 'Comparison failed.')}
                    </p>
                  )}
                </div>
              )}
            </Card>
          </div>

          {/* ---- Results ---- */}
          <div className="lg:col-span-2 space-y-6">
            {result && compared.length >= 2 ? (
              <>
                {/* Ranking */}
                <Card hover={false}>
                  <div className="flex items-center gap-2 mb-4">
                    <Trophy className="w-4 h-4 text-amber-500" />
                    <h3 className="text-base font-semibold">Ranking</h3>
                  </div>
                  <div className="space-y-2">
                    {result.comparison.ranking.map((r, i) => {
                      const rep = compared.find((c) => c.id === r.id);
                      return (
                        <div
                          key={r.id}
                          className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border/50"
                          style={{ borderLeftWidth: 4, borderLeftColor: COLORS[i % COLORS.length] }}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-lg font-bold text-text-muted w-6">#{r.rank}</span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate" title={r.filename}>{r.filename}</p>
                              {rep?.recommendation && (
                                <span className={`inline-block mt-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border ${getRecommendationColor(rep.recommendation)}`}>
                                  {rep.recommendation}
                                </span>
                              )}
                            </div>
                          </div>
                          <ScoreBadge score={Math.round(r.score)} />
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {/* Parameter radar */}
                <Card hover={false}>
                  <h3 className="text-base font-semibold mb-4">Parameter Comparison</h3>
                  <ResponsiveContainer width="100%" height={320}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="#E2E8F0" />
                      <PolarAngleAxis dataKey="metric" fontSize={11} stroke="#64748B" />
                      <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                      {compared.map((rep, i) => (
                        <Radar
                          key={rep.id}
                          dataKey={`p${i}`}
                          stroke={COLORS[i % COLORS.length]}
                          fill={COLORS[i % COLORS.length]}
                          fillOpacity={0.1}
                          strokeWidth={2}
                          name={rep.filename.slice(0, 18)}
                        />
                      ))}
                      <Legend />
                    </RadarChart>
                  </ResponsiveContainer>
                </Card>

                {/* Overall bar */}
                <Card hover={false}>
                  <h3 className="text-base font-semibold mb-4">Overall Scores</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={barData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="name" fontSize={11} stroke="#94A3B8" />
                      <YAxis domain={[0, 100]} fontSize={11} stroke="#94A3B8" />
                      <Tooltip />
                      <Bar dataKey="overall" fill="#2E7D32" radius={[6, 6, 0, 0]} name="Overall" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>

                {/* Per-report strengths/weaknesses */}
                <div className="grid md:grid-cols-2 gap-4">
                  {compared.map((rep, i) => {
                    const ev = rep.evaluation_report?.evaluation;
                    return (
                      <Card key={rep.id} hover={false} className="border-l-4" style={{ borderLeftColor: COLORS[i % COLORS.length] }}>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-semibold truncate" title={rep.filename}>{rep.filename}</p>
                          <ScoreBadge score={Math.round(rep.overall_score ?? 0)} />
                        </div>
                        {ev?.summary && <p className="text-xs text-text-secondary line-clamp-3 mb-2">{ev.summary}</p>}
                        {ev?.strengths?.length ? (
                          <p className="text-xs text-green-700"><span className="font-semibold">Top strength:</span> {ev.strengths[0]}</p>
                        ) : null}
                        {ev?.weaknesses?.length ? (
                          <p className="text-xs text-red-600 mt-1"><span className="font-semibold">Top weakness:</span> {ev.weaknesses[0]}</p>
                        ) : null}
                      </Card>
                    );
                  })}
                </div>
              </>
            ) : (
              <Card hover={false} className="text-center py-16">
                <GitCompare className="w-12 h-12 text-text-muted mx-auto mb-3" />
                <p className="text-text-secondary">
                  {reports.length < 2 && !isLoading
                    ? 'Evaluate at least 2 proposals to enable comparison'
                    : 'Select at least 2 evaluated proposals, then press Compare'}
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
