import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileText, X, Loader2, Brain,
  CheckCircle, AlertTriangle, TrendingUp, Shield,
  Lightbulb, DollarSign, Target, Sprout, RotateCcw,
  Users, ChevronDown, ChevronUp
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button, Card, Input, Progress, ScoreBadge, Badge } from '@/components/ui';
import { proposalApi } from '@/services/proposal.service';
import { formatFileSize, getScoreColor, getRecommendationColor } from '@/utils';

type ViewState = 'upload' | 'evaluating' | 'results' | 'error';

export default function UploadPage() {
  const [view, setView] = useState<ViewState>('upload');
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [evaluation, setEvaluation] = useState<any>(null);
  const [error, setError] = useState('');
  const [expandedParam, setExpandedParam] = useState<string | null>(null);

  const evalMut = useMutation({
    mutationFn: () => {
      if (files.length > 1) {
        return proposalApi.evaluateBatch(files);
      }
      return proposalApi.evaluateFile(files[0]!, title || undefined);
    },
    onSuccess: (data) => {
      setEvaluation(data);
      setView('results');
    },
    onError: (e: any) => {
      setError(e.response?.data?.message || e.message || 'Evaluation failed. Please try again.');
      setView('error');
    },
  });

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length > 0) {
      setFiles(accepted);
      setTitle(accepted.length === 1 ? accepted[0].name.replace(/\.[^/.]+$/, '') : '');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
      'application/vnd.ms-powerpoint': ['.ppt'],
      'text/plain': ['.txt'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/tiff': ['.tiff'],
      'image/bmp': ['.bmp'],
    },
    maxSize: 52428800,
    multiple: true,
    maxFiles: 20,
  });

  const handleEvaluate = () => {
    if (files.length === 0) return;
    setView('evaluating');
    setError('');
    evalMut.mutate();
  };

  const handleReset = () => {
    setFiles([]);
    setTitle('');
    setEvaluation(null);
    setError('');
    setView('upload');
  };

  const ev = evaluation;
  const isBatchResult = ev && Array.isArray(ev.results);
  const radarData = ev ? [
    { metric: 'Problem Relevance', value: ev.problemRelevanceScore, fullMark: 100 },
    { metric: 'Solution Readiness', value: ev.solutionReadinessScore, fullMark: 100 },
    { metric: 'Pilot Design', value: ev.pilotDesignScore, fullMark: 100 },
    { metric: 'Farmer Adoption', value: ev.farmerAdoptionScore, fullMark: 100 },
    { metric: 'Scale-up Potential', value: ev.scaleUpScore, fullMark: 100 },
    { metric: 'Team Capacity', value: ev.teamCapacityScore, fullMark: 100 },
    { metric: 'Compliance', value: ev.complianceScore, fullMark: 100 },
  ] : [];

  const barData = ev ? [
    { name: 'Problem Relevance', score: ev.problemRelevanceScore },
    { name: 'Solution Readiness', score: ev.solutionReadinessScore },
    { name: 'Pilot Design', score: ev.pilotDesignScore },
    { name: 'Farmer Adoption', score: ev.farmerAdoptionScore },
    { name: 'Scale-up', score: ev.scaleUpScore },
    { name: 'Team Capacity', score: ev.teamCapacityScore },
    { name: 'Compliance', score: ev.complianceScore },
  ] : [];

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold text-text">
            {view === 'results' ? 'Evaluation Results' : 'Evaluate Proposal'}
          </h1>
          <p className="text-sm text-text-muted mt-1">
            {view === 'results'
              ? isBatchResult
                ? `Batch evaluation for ${ev.totalFiles} proposals`
                : `AI evaluation for "${ev?.title || title}"`
              : 'Upload one or more agriculture startup proposals for AI evaluation'}
          </p>
        </motion.div>

        <AnimatePresence mode="wait">
          {/* ===== UPLOAD VIEW ===== */}
          {view === 'upload' && (
            <motion.div key="upload" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
              {/* Drop Zone */}
              <div {...getRootProps()} className={`upload-zone cursor-pointer ${isDragActive ? 'active' : ''}`}>
                <input {...getInputProps()} />
                <motion.div animate={isDragActive ? { scale: 1.05 } : { scale: 1 }}>
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-accent/50 flex items-center justify-center mb-4">
                    <Upload className="w-7 h-7 text-primary/60" />
                  </div>
                  <p className="text-base font-medium text-text">{isDragActive ? 'Drop files here' : 'Drag & drop proposals'}</p>
                  <p className="text-sm text-text-muted mt-1">or click to browse</p>
                  <p className="text-xs text-text-muted mt-3">Supports PDF, DOCX, DOC, PPTX, PPT, TXT, PNG, JPG, TIFF, BMP • Max 20 files • 50MB each</p>
                </motion.div>
              </div>

              {/* File Preview */}
              {files.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <Card hover={false} className="p-5">
                    <div className="flex items-start gap-4">
                      <div className="w-11 h-11 rounded-xl bg-accent/40 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-3">
                        {files.length === 1 && (
                          <Input
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="Proposal title"
                            label="Title"
                          />
                        )}
                        <div className="space-y-2">
                          {files.map((selectedFile) => (
                            <div key={`${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-white px-3 py-2">
                              <p className="min-w-0 truncate text-xs text-text-muted">
                                {selectedFile.name} • {formatFileSize(selectedFile.size)}
                              </p>
                              <button
                                onClick={() => {
                                  const remaining = files.filter((f) => f !== selectedFile);
                                  setFiles(remaining);
                                  setTitle(remaining.length === 1 ? remaining[0]!.name.replace(/\.[^/.]+$/, '') : '');
                                }}
                                className="p-1 hover:bg-red-50 rounded-md"
                                aria-label={`Remove ${selectedFile.name}`}
                              >
                                <X className="w-3.5 h-3.5 text-text-muted" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                      <button onClick={() => { setFiles([]); setTitle(''); }} className="p-1.5 hover:bg-red-50 rounded-lg">
                        <X className="w-4 h-4 text-text-muted" />
                      </button>
                    </div>
                    <div className="mt-4 pt-4 border-t border-border/50">
                      <Button onClick={handleEvaluate} className="w-full" size="lg">
                        <Brain className="w-5 h-5" /> {files.length > 1 ? `Run Batch Evaluation (${files.length})` : 'Run AI Evaluation'}
                      </Button>
                    </div>
                  </Card>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* ===== EVALUATING VIEW ===== */}
          {view === 'evaluating' && (
            <motion.div key="evaluating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-20">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                className="w-20 h-20 rounded-2xl gradient-primary flex items-center justify-center mb-6 shadow-lg"
              >
                <Brain className="w-10 h-10 text-white" />
              </motion.div>
              <h2 className="text-xl font-bold text-text mb-2">
                {files.length > 1 ? 'Evaluating Proposal Batch' : 'Evaluating Your Proposal'}
              </h2>
              <p className="text-sm text-text-muted text-center max-w-md mb-6">
                {files.length > 1
                  ? `${files.length} documents are being evaluated sequentially according to the AIAIC Rubrics.`
                  : '7 domain-specific AI agents are evaluating your proposal according to the AIAIC Rubrics, followed by a multi-agent debate session.'}
              </p>
              <div className="flex items-center gap-3 text-sm text-text-muted">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>{files.length > 1 ? 'This can take several minutes for larger batches' : 'This may take 30-60 seconds'}</span>
              </div>

              {/* Animated Progress Steps */}
              <div className="mt-8 space-y-3 w-full max-w-sm">
                {[
                  'Extracting document data & tables',
                  'Problem Identification assessment',
                  'Solution Readiness assessment',
                  'Pilot Design & Implementation plan check',
                  'Farmer Adoption potential review',
                  'Scale-up & Sustainability review',
                  'Team Capacity & Execution strength check',
                  'Compliance validation',
                  'Running multi-agent debate & consensus'
                ].map((step, i) => (
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 3 + 1 }}
                    className="flex items-center gap-3 text-sm"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: i * 3 + 1 }}
                      className="w-6 h-6 rounded-full bg-accent/40 flex items-center justify-center flex-shrink-0"
                    >
                      <Loader2 className="w-3 h-3 animate-spin text-primary" />
                    </motion.div>
                    <span className="text-text-secondary">{step}...</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ===== ERROR VIEW ===== */}
          {view === 'error' && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Card hover={false} className="text-center py-16">
                <AlertTriangle className="w-14 h-14 text-red-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-text">Evaluation Failed</h3>
                <p className="text-sm text-text-muted mt-2 max-w-md mx-auto">{error}</p>
                <div className="flex items-center justify-center gap-3 mt-6">
                  <Button onClick={handleReset} variant="secondary">
                    <RotateCcw className="w-4 h-4" /> Try Again
                  </Button>
                </div>
              </Card>
            </motion.div>
          )}

          {/* ===== BATCH RESULTS VIEW ===== */}
          {view === 'results' && isBatchResult && (
            <motion.div key="batch-results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-text">Batch Results</h2>
                  <p className="text-xs text-text-muted">Batch ID: {ev.batchId}</p>
                </div>
                <Button onClick={handleReset} variant="secondary" size="sm">
                  <RotateCcw className="w-4 h-4" /> Evaluate Another
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <Card hover={false} className="text-center py-5">
                  <p className="text-xs text-text-muted mb-1">Total</p>
                  <p className="text-3xl font-bold text-text">{ev.totalFiles}</p>
                </Card>
                <Card hover={false} className="text-center py-5">
                  <p className="text-xs text-text-muted mb-1">Completed</p>
                  <p className="text-3xl font-bold text-green-600">{ev.completed}</p>
                </Card>
                <Card hover={false} className="text-center py-5">
                  <p className="text-xs text-text-muted mb-1">Failed</p>
                  <p className="text-3xl font-bold text-red-500">{ev.failed}</p>
                </Card>
              </div>

              <Card hover={false} className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                        <th className="py-3 pr-4 font-semibold">Document</th>
                        <th className="py-3 pr-4 font-semibold">Status</th>
                        <th className="py-3 pr-4 font-semibold">Score</th>
                        <th className="py-3 pr-4 font-semibold">Recommendation</th>
                        <th className="py-3 font-semibold">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ev.results.map((result: any) => (
                        <tr key={result.evaluationId || result.filename} className="border-b border-border/60 last:border-0">
                          <td className="py-3 pr-4 max-w-[280px]">
                            <p className="truncate font-medium text-text">{result.filename}</p>
                            {result.error && <p className="mt-1 text-xs text-red-500">{result.error}</p>}
                          </td>
                          <td className="py-3 pr-4">
                            <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-semibold ${result.status === 'completed' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                              {result.status}
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            {typeof result.overallScore === 'number' ? (
                              <span className={`font-bold ${getScoreColor(result.overallScore)}`}>{Math.round(result.overallScore)}</span>
                            ) : (
                              <span className="text-text-muted">-</span>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            {result.recommendation ? (
                              <span className={`inline-flex rounded-lg border px-2 py-1 text-xs font-semibold ${getRecommendationColor(result.recommendation)}`}>
                                {result.recommendation}
                              </span>
                            ) : (
                              <span className="text-text-muted">-</span>
                            )}
                          </td>
                          <td className="py-3 text-text-muted">
                            {typeof result.processingTimeSeconds === 'number' ? `${result.processingTimeSeconds}s` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </motion.div>
          )}

          {/* ===== RESULTS VIEW ===== */}
          {view === 'results' && ev && !isBatchResult && (
            <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              {/* Action Bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-accent/40 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text">{ev.title}</p>
                    <p className="text-xs text-text-muted">{ev.fileName} • {formatFileSize(ev.fileSize)}</p>
                  </div>
                </div>
                <Button onClick={handleReset} variant="secondary" size="sm">
                  <RotateCcw className="w-4 h-4" /> Evaluate Another
                </Button>
              </div>

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
                    <h3 className="text-base font-semibold mb-4">Score Breakdown</h3>
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

              {/* AI Summary */}
              <Card hover={false}>
                <h3 className="text-base font-semibold mb-3">AI Summary</h3>
                <p className="text-sm text-text-secondary leading-relaxed">{ev.summary}</p>
              </Card>

              {/* Detailed Parameter Breakdown Accordion */}
              {ev.parameterBreakdown && Object.keys(ev.parameterBreakdown).length > 0 && (
                <Card hover={false} className="space-y-4">
                  <h3 className="text-base font-semibold border-b pb-2">Detailed Parameter Breakdown</h3>
                  <div className="space-y-2">
                    {Object.entries(ev.parameterBreakdown).map(([key, breakdown]: any) => {
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
                                {breakdown.sub_questions.map((sq: any, sIdx: number) => (
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
                    {ev.debateSummary.debates.map((debate: any, dIdx: number) => {
                      const conflict = ev.debateSummary?.conflicts?.find((c: any) => c.conflict_id === debate.conflict_id);
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
                                    {debate.score_adjustments.map((adj: any, aIdx: number) => (
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

              {/* SWOT Analysis */}
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
                        {(s.items || []).map((item: string, j: number) => (
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

              {/* Key Strengths & Weaknesses */}
              <div className="grid md:grid-cols-2 gap-4">
                <Card hover={false}>
                  <h3 className="text-sm font-semibold text-green-700 mb-3">Key Strengths</h3>
                  <ul className="space-y-2">
                    {(ev.strengths || []).map((s: string, i: number) => (
                      <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />{s}
                      </li>
                    ))}
                  </ul>
                </Card>
                <Card hover={false}>
                  <h3 className="text-sm font-semibold text-red-600 mb-3">Key Weaknesses</h3>
                  <ul className="space-y-2">
                    {(ev.weaknesses || []).map((w: string, i: number) => (
                      <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />{w}
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
