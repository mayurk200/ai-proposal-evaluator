import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileText, X, Loader2, Brain,
  CheckCircle, AlertTriangle, TrendingUp, Shield,
  Lightbulb, DollarSign, Target, Sprout, RotateCcw
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button, Card, Input, Progress, ScoreBadge } from '@/components/ui';
import { proposalApi } from '@/services/proposal.service';
import { formatFileSize, getScoreColor, getRecommendationColor } from '@/utils';

type ViewState = 'upload' | 'evaluating' | 'results' | 'error';

export default function UploadPage() {
  const [view, setView] = useState<ViewState>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [evaluation, setEvaluation] = useState<any>(null);
  const [error, setError] = useState('');

  const evalMut = useMutation({
    mutationFn: () => proposalApi.evaluateFile(file!, title || undefined),
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
      const f = accepted[0];
      setFile(f);
      setTitle(f.name.replace(/\.[^/.]+$/, ''));
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
    multiple: false,
  });

  const handleEvaluate = () => {
    if (!file) return;
    setView('evaluating');
    setError('');
    evalMut.mutate();
  };

  const handleReset = () => {
    setFile(null);
    setTitle('');
    setEvaluation(null);
    setError('');
    setView('upload');
  };

  const ev = evaluation;
  const radarData = ev ? [
    { metric: 'Innovation', value: ev.innovationScore, fullMark: 100 },
    { metric: 'Market', value: ev.marketScore, fullMark: 100 },
    { metric: 'Financial', value: ev.financialScore, fullMark: 100 },
    { metric: 'Sustainability', value: ev.sustainabilityScore, fullMark: 100 },
    { metric: 'Agriculture', value: ev.agricultureScore, fullMark: 100 },
    { metric: 'Risk', value: ev.riskScore, fullMark: 100 },
  ] : [];

  const barData = ev ? [
    { name: 'Innovation', score: ev.innovationScore },
    { name: 'Market', score: ev.marketScore },
    { name: 'Agriculture', score: ev.agricultureScore },
    { name: 'Financial', score: ev.financialScore },
    { name: 'Scalability', score: ev.scalabilityScore },
    { name: 'Sustainability', score: ev.sustainabilityScore },
    { name: 'Risk', score: ev.riskScore },
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
              ? `AI evaluation for "${ev?.title || title}"`
              : 'Upload your agriculture startup proposal for instant AI evaluation'}
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
                  <p className="text-base font-medium text-text">{isDragActive ? 'Drop file here' : 'Drag & drop your proposal'}</p>
                  <p className="text-sm text-text-muted mt-1">or click to browse</p>
                  <p className="text-xs text-text-muted mt-3">Supports PDF, DOCX, DOC, PPTX, PPT, TXT, PNG, JPG, TIFF, BMP • Max 50MB</p>
                </motion.div>
              </div>

              {/* File Preview */}
              {file && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <Card hover={false} className="p-5">
                    <div className="flex items-start gap-4">
                      <div className="w-11 h-11 rounded-xl bg-accent/40 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-3">
                        <Input
                          value={title}
                          onChange={e => setTitle(e.target.value)}
                          placeholder="Proposal title"
                          label="Title"
                        />
                        <p className="text-xs text-text-muted">{file.name} • {formatFileSize(file.size)}</p>
                      </div>
                      <button onClick={() => { setFile(null); setTitle(''); }} className="p-1.5 hover:bg-red-50 rounded-lg">
                        <X className="w-4 h-4 text-text-muted" />
                      </button>
                    </div>
                    <div className="mt-4 pt-4 border-t border-border/50">
                      <Button onClick={handleEvaluate} className="w-full" size="lg">
                        <Brain className="w-5 h-5" /> Run AI Evaluation
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
              <h2 className="text-xl font-bold text-text mb-2">Evaluating Your Proposal</h2>
              <p className="text-sm text-text-muted text-center max-w-md mb-6">
                7 AI agents are analyzing your proposal across innovation, market potential, financial viability, sustainability, and more...
              </p>
              <div className="flex items-center gap-3 text-sm text-text-muted">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>This may take 30-60 seconds</span>
              </div>

              {/* Animated Progress Steps */}
              <div className="mt-8 space-y-3 w-full max-w-sm">
                {['Extracting text', 'Agriculture analysis', 'Financial analysis', 'Innovation scoring', 'Risk assessment', 'Sustainability check', 'Final scoring'].map((step, i) => (
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

          {/* ===== RESULTS VIEW ===== */}
          {view === 'results' && ev && (
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
