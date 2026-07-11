import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Brain, FileText, Loader2, CheckCircle, AlertTriangle, TrendingUp, Shield, Sprout, Lightbulb, Target, Bookmark, XCircle, Users, ChevronDown, ChevronUp } from 'lucide-react';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, Progress, Skeleton } from '@/components/ui';
import { proposalApi } from '@/services/proposal.service';
import { formatDate, getScoreColor, getRecommendationColor } from '@/utils';
import { useAuthStore } from '@/store/authStore';

export default function ProposalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();
  const qc = useQueryClient();
  const [expandedParam, setExpandedParam] = useState<string | null>(null);

  const { data: proposal, isLoading } = useQuery({
    queryKey: ['proposal', id], queryFn: () => proposalApi.getById(id!), enabled: !!id,
  });
  const rejectMut = useMutation({
    mutationFn: () => proposalApi.reject(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposal', id] }),
  });
  if (isLoading) return <AppLayout><div className="space-y-6">{[1,2,3].map(i => <Card key={i} hover={false}><Skeleton className="h-32 w-full" /></Card>)}</div></AppLayout>;
  if (!proposal) return <AppLayout><Card hover={false} className="text-center py-16"><p>Proposal not found</p></Card></AppLayout>;
  const ev = proposal.evaluation;
  const radarData = ev ? [
    { metric: 'Problem Relevance', value: ev.problemRelevanceScore || 0, fullMark: 100 },
    { metric: 'Solution Readiness', value: ev.solutionReadinessScore || 0, fullMark: 100 },
    { metric: 'Pilot Design', value: ev.pilotDesignScore || 0, fullMark: 100 },
    { metric: 'Farmer Adoption', value: ev.farmerAdoptionScore || 0, fullMark: 100 },
    { metric: 'Scale-up Potential', value: ev.scaleUpScore || 0, fullMark: 100 },
    { metric: 'Team Capacity', value: ev.teamCapacityScore || 0, fullMark: 100 },
    { metric: 'Compliance', value: ev.complianceScore || 0, fullMark: 100 },
  ] : [];
  const barData = ev ? [
    { name: 'Problem Relevance', score: ev.problemRelevanceScore || 0, weight: '15%' },
    { name: 'Solution Readiness', score: ev.solutionReadinessScore || 0, weight: '20%' },
    { name: 'Pilot Design', score: ev.pilotDesignScore || 0, weight: '20%' },
    { name: 'Farmer Adoption', score: ev.farmerAdoptionScore || 0, weight: '15%' },
    { name: 'Scale-up Potential', score: ev.scaleUpScore || 0, weight: '15%' },
    { name: 'Team Capacity', score: ev.teamCapacityScore || 0, weight: '10%' },
    { name: 'Compliance', score: ev.complianceScore || 0, weight: '5%' },
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
            {isAuthenticated && proposal.status !== 'REJECTED' && (
              <Button variant="secondary" className="!bg-red-50 !text-red-600 hover:!bg-red-100 !border-red-200" onClick={() => rejectMut.mutate()} loading={rejectMut.isPending}>
                <XCircle className="w-4 h-4 mr-2" /> Reject Proposal
              </Button>
            )}
            {!isAuthenticated && (
              <Button variant="secondary" onClick={() => navigate(`/login?claimId=${id}`)}>
                <Bookmark className="w-4 h-4 mr-2" /> Save to Dashboard
              </Button>
            )}
            {(proposal.status === 'EVALUATING' || proposal.status === 'EXTRACTING') && (
              <Badge variant="info"><Loader2 className="w-3 h-3 animate-spin mr-1" /> Processing...</Badge>
            )}
            {proposal.status === 'REJECTED' && (
              <Badge className="bg-gray-200 text-gray-900"><XCircle className="w-3 h-3 mr-1" /> Rejected</Badge>
            )}
          </div>
        </motion.div>

        {/* Evaluation Results */}
        {ev ? (
          <>
            {/* Score Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <Card hover={false} className="text-center h-full flex flex-col justify-center py-6">
                  <p className="text-sm text-text-muted mb-2">Overall Score</p>
                  <div className="text-5xl font-bold text-gradient">{Math.round(ev.overallScore)}</div>
                  <span className={`inline-block mt-3 text-xs font-semibold px-3 py-1 rounded-lg border mx-auto ${getRecommendationColor(ev.recommendation)}`}>{ev.recommendation}</span>
                </Card>
              </motion.div>
              {[
                { key: 'problemRelevanceScore', label: 'Problem Relevance', icon: Target, color: 'text-rose-600', bg: 'bg-rose-50' },
                { key: 'solutionReadinessScore', label: 'Solution Readiness', icon: Lightbulb, color: 'text-amber-600', bg: 'bg-amber-50' },
                { key: 'pilotDesignScore', label: 'Pilot Design', icon: FileText, color: 'text-indigo-600', bg: 'bg-indigo-50' },
                { key: 'farmerAdoptionScore', label: 'Farmer Adoption', icon: Sprout, color: 'text-green-600', bg: 'bg-green-50' },
                { key: 'scaleUpScore', label: 'Scale-up Potential', icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                { key: 'teamCapacityScore', label: 'Team Capacity', icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
                { key: 'complianceScore', label: 'Compliance', icon: Shield, color: 'text-slate-600', bg: 'bg-slate-50' },
              ].map((item, i) => {
                const score = ev[item.key as keyof typeof ev] as number ?? 0;
                return (
                  <motion.div key={item.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + i * 0.04 }}>
                    <Card hover={false} className="h-full">
                      <div className="flex items-center gap-2 mb-3">
                        <div className={`w-7 h-7 rounded-lg ${item.bg} flex items-center justify-center`}><item.icon className={`w-4 h-4 ${item.color}`} /></div>
                        <p className="text-xs text-text-muted font-semibold leading-none">{item.label}</p>
                      </div>
                      <p className={`text-2xl font-bold ${getScoreColor(score)}`}>{Math.round(score)}</p>
                      <Progress value={score} className="mt-2 h-1.5" />
                    </Card>
                  </motion.div>
                );
              })}
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

            {/* Detailed Parameter Breakdown Accordion */}
            {ev.parameterBreakdown && Object.keys(ev.parameterBreakdown).length > 0 && (
              <Card hover={false} className="space-y-4">
                <h3 className="text-base font-semibold border-b pb-2">Detailed Parameter Breakdown</h3>
                <div className="space-y-2">
                  {Object.entries(ev.parameterBreakdown).map(([key, breakdown]) => {
                    const isExpanded = expandedParam === key;
                    return (
                      <div key={key} className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/30">
                        <button
                          className="w-full flex items-center justify-between p-4 font-semibold text-sm hover:bg-slate-50 transition text-left"
                          onClick={() => setExpandedParam(isExpanded ? null : key)}
                        >
                          <div className="flex items-center gap-3">
                            <span className={`text-lg font-bold ${getScoreColor(breakdown.parameter_score)}`}>
                              {Math.round(breakdown.parameter_score)}
                            </span>
                            <span className="text-text">{breakdown.parameter_name}</span>
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                        </button>
                        {isExpanded && (
                          <div className="p-4 bg-white border-t border-slate-200 space-y-4">
                            {/* Sub-questions list */}
                            <div className="space-y-4">
                              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Sub-Question Rubrics</h4>
                              {breakdown.sub_questions.map((sq, sIdx) => (
                                <div key={sIdx} className="space-y-2 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="space-y-0.5">
                                      <span className="text-xs font-bold text-slate-400 mr-2">{sq.question_id.toUpperCase()}</span>
                                      <span className="text-sm font-medium text-text">{sq.question}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className={`text-sm font-bold ${getScoreColor(sq.score * 10)}`}>{sq.score}/10</span>
                                    </div>
                                  </div>
                                  <div className="grid md:grid-cols-2 gap-3 text-xs mt-1">
                                    <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                                      <span className="font-bold text-slate-500 block mb-1">Justification:</span>
                                      <p className="text-text-secondary">{sq.justification}</p>
                                    </div>
                                    <div className="bg-green-50/40 p-2.5 rounded-lg border border-green-100/50">
                                      <span className="font-bold text-green-700 block mb-1">Evidence from Proposal:</span>
                                      <p className="text-green-950 font-medium italic">"{sq.evidence || 'N/A'}"</p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Key findings, red flags, recommendations */}
                            <div className="grid md:grid-cols-3 gap-4 pt-3 border-t border-slate-100">
                              <div>
                                <span className="text-xs font-bold text-slate-400 block mb-2 uppercase tracking-wider">Key Findings</span>
                                <ul className="list-disc pl-4 space-y-1 text-xs text-text-secondary">
                                  {breakdown.key_findings.map((f: string, fIdx: number) => <li key={fIdx}>{f}</li>)}
                                  {breakdown.key_findings.length === 0 && <li className="italic list-none pl-0">None reported</li>}
                                </ul>
                              </div>
                              <div>
                                <span className="text-xs font-bold text-red-500 block mb-2 uppercase tracking-wider">Red Flags</span>
                                <ul className="list-disc pl-4 space-y-1 text-xs text-red-600 font-medium">
                                  {breakdown.red_flags.map((rf: string, rfIdx: number) => (
                                    <li key={rfIdx} className="flex items-start gap-1">
                                      <AlertTriangle className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                                      {rf}
                                    </li>
                                  ))}
                                  {breakdown.red_flags.length === 0 && <li className="italic list-none pl-0 text-slate-400">None detected</li>}
                                </ul>
                              </div>
                              <div>
                                <span className="text-xs font-bold text-slate-400 block mb-2 uppercase tracking-wider">Recommendations</span>
                                <ul className="list-disc pl-4 space-y-1 text-xs text-text-secondary">
                                  {breakdown.recommendations.map((r: string, rIdx: number) => <li key={rIdx}>{r}</li>)}
                                  {breakdown.recommendations.length === 0 && <li className="italic list-none pl-0">None reported</li>}
                                </ul>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Debate Insights Section */}
            {ev.debateSummary && ev.debateSummary.debates && ev.debateSummary.debates.length > 0 && (
              <Card hover={false} className="border-emerald-200/50 bg-emerald-50/10">
                <div className="flex items-center justify-between border-b border-emerald-100 pb-3 mb-4">
                  <div className="flex items-center gap-2">
                    <Brain className="w-5 h-5 text-emerald-700" />
                    <h3 className="text-base font-bold text-emerald-800">Multi-Agent Debate Insights</h3>
                  </div>
                  <Badge variant="default" className="bg-emerald-100 text-emerald-800 border-emerald-200">
                    Confidence: {Math.round(ev.debateSummary.confidence * 100)}%
                  </Badge>
                </div>
                
                <p className="text-sm text-text-secondary mb-4 leading-relaxed">
                  The Debate Agent detected potential conflicts across the evaluations and triggered a cross-examination to resolve scoring differences.
                </p>

                <div className="space-y-4">
                  {ev.debateSummary.debates.map((debate, dIdx) => {
                    const conflict = ev.debateSummary?.conflicts?.find((c) => c.conflict_id === debate.conflict_id);
                    return (
                      <div key={dIdx} className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm space-y-3">
                        <div className="flex items-center justify-between gap-4">
                          <h4 className="text-sm font-bold text-text">{debate.topic}</h4>
                          {conflict && (
                            <Badge className={`
                              ${conflict.severity === 'high' ? 'bg-red-50 text-red-700 border-red-200' : ''}
                              ${conflict.severity === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200' : ''}
                              ${conflict.severity === 'low' ? 'bg-slate-50 text-slate-700 border-slate-200' : ''}
                              border text-xs px-2 py-0.5
                            `}>
                              {conflict.severity.toUpperCase()} SEVERITY
                            </Badge>
                          )}
                        </div>

                        {conflict && <p className="text-xs text-text-muted">{conflict.description}</p>}

                        <div className="grid md:grid-cols-2 gap-4 pt-2">
                          {debate.position_a && (
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                              <span className="text-xs font-bold text-slate-500 block mb-1">Position A ({debate.position_a.agent})</span>
                              <p className="text-xs text-text-secondary leading-relaxed mb-2">{debate.position_a.argument}</p>
                              {debate.position_a.evidence && (
                                <p className="text-[11px] text-slate-500 italic bg-white p-2 rounded border border-slate-100">
                                  "{debate.position_a.evidence}"
                                </p>
                              )}
                            </div>
                          )}
                          {debate.position_b && (
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                              <span className="text-xs font-bold text-slate-500 block mb-1">Position B ({debate.position_b.agent})</span>
                              <p className="text-xs text-text-secondary leading-relaxed mb-2">{debate.position_b.argument}</p>
                              {debate.position_b.evidence && (
                                <p className="text-[11px] text-slate-500 italic bg-white p-2 rounded border border-slate-100">
                                  "{debate.position_b.evidence}"
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="bg-emerald-50/40 p-3 rounded-lg border border-emerald-100/30">
                          <span className="text-xs font-bold text-emerald-700 block mb-1">Resolution & consensus</span>
                          <p className="text-xs text-text-secondary leading-relaxed">{debate.resolution}</p>
                        </div>

                        {debate.score_adjustments && debate.score_adjustments.length > 0 && (
                          <div className="pt-2">
                            <span className="text-xs font-bold text-slate-400 block mb-2 uppercase tracking-wider">Score Adjustments Applied</span>
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                  <tr className="border-b border-slate-100 text-slate-400 font-bold">
                                    <th className="py-2 pr-4">Parameter</th>
                                    <th className="py-2 pr-4">Sub-Question</th>
                                    <th className="py-2 pr-4 text-center">Raw Score</th>
                                    <th className="py-2 pr-4 text-center">Adjustment</th>
                                    <th className="py-2 text-center">Adjusted Score</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {debate.score_adjustments.map((adj, aIdx) => (
                                    <tr key={aIdx} className="border-b border-slate-50 last:border-0">
                                      <td className="py-2 pr-4 font-medium">{adj.parameter}</td>
                                      <td className="py-2 pr-4 text-slate-500">{adj.sub_question_id.toUpperCase()}</td>
                                      <td className="py-2 pr-4 text-center text-slate-500">{adj.current_score}/10</td>
                                      <td className="py-2 pr-4 text-center font-bold text-amber-600">{adj.adjustment > 0 ? `+${adj.adjustment}` : adj.adjustment}</td>
                                      <td className="py-2 text-center font-bold text-emerald-700">{adj.adjusted_score}/10</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                
                {ev.debateSummary.high_ambiguity_areas && ev.debateSummary.high_ambiguity_areas.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-emerald-100">
                    <span className="text-xs font-bold text-emerald-800 block mb-2 uppercase tracking-wider">Ambiguity & Due-Diligence Flags</span>
                    <ul className="list-disc pl-4 space-y-1 text-xs text-text-secondary">
                      {ev.debateSummary.high_ambiguity_areas.map((area: string, aIdx: number) => (
                        <li key={aIdx}>{area}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            )}

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
                <ul className="space-y-2">{(ev.strengths || []).map((s: string, i: number) => <li key={i} className="text-sm text-text-secondary flex items-start gap-2"><CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />{s}</li>)}</ul>
              </Card>
              <Card hover={false}>
                <h3 className="text-sm font-semibold text-red-600 mb-3">Key Weaknesses</h3>
                <ul className="space-y-2">{(ev.weaknesses || []).map((w: string, i: number) => <li key={i} className="text-sm text-text-secondary flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />{w}</li>)}</ul>
              </Card>
            </div>
          </>
        ) : (
          <Card hover={false} className="text-center py-16">
            <Brain className="w-14 h-14 text-text-muted mx-auto mb-4" />
            <h3 className="text-lg font-semibold">Not Evaluated Yet</h3>
            <p className="text-sm text-text-muted mt-1">Run the AI evaluation from the Proposals page to analyze this proposal</p>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
