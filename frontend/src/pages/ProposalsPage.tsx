import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileText, Search, Plus, Loader2, ChevronDown, ChevronUp, Tag, AlertTriangle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, Skeleton } from '@/components/ui';
import { uploadApi, type ProcessedProposal } from '@/services/proposal.service';
import { formatDate } from '@/utils';

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
    <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-medium ${style}`}>
      {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
      {s || 'unknown'}
    </span>
  );
}

function ProposalRow({ p, index }: { p: ProcessedProposal; index: number }) {
  const [open, setOpen] = useState(false);
  const detail = p.categorization || null;
  const title = detail?.title || p.filename || 'Untitled proposal';
  const summary = detail?.summary;
  const categories = p.categories?.length ? p.categories : detail?.categories || [];
  const hasDetail = Boolean(detail);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-accent/40 flex items-center justify-center flex-shrink-0">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text truncate" title={title}>{title}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                {p.created_at && <span>{formatDate(p.created_at)}</span>}
                {p.filename && <span className="truncate">{p.filename}</span>}
              </div>
              {summary && <p className="text-xs text-text-muted mt-2 line-clamp-2">{summary}</p>}
              {categories.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                  {categories.map((c) => (
                    <span key={c} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-accent/50 text-primary font-medium">
                      <Tag className="w-2.5 h-2.5" /> {labelForCategory(c)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <StatusBadge status={p.status} />
            {typeof p.rank === 'number' && p.rank > 0 && (
              <span className="text-xs font-semibold text-text-secondary">Rank {p.rank}</span>
            )}
          </div>
        </div>

        {hasDetail && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <button
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {open ? <><ChevronUp className="w-3.5 h-3.5" /> Hide details</> : <><ChevronDown className="w-3.5 h-3.5" /> Show details</>}
            </button>
            {open && detail && (
              <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                {detail.problem_statement && (
                  <Field label="Problem">{detail.problem_statement}</Field>
                )}
                {detail.proposed_solution && (
                  <Field label="Solution">{detail.proposed_solution}</Field>
                )}
                {detail.technologies?.length ? (
                  <Field label="Technologies">{detail.technologies.join(', ')}</Field>
                ) : null}
                {detail.target_beneficiaries?.length ? (
                  <Field label="Beneficiaries">{detail.target_beneficiaries.join(', ')}</Field>
                ) : null}
                {detail.geography && <Field label="Geography">{detail.geography}</Field>}
                {detail.stage && <Field label="Stage">{detail.stage}</Field>}
                {detail.keywords?.length ? (
                  <Field label="Keywords">{detail.keywords.join(', ')}</Field>
                ) : null}
                {typeof detail.agri_relevance === 'number' && (
                  <Field label="Agri relevance">{Math.round(detail.agri_relevance * 100)}%</Field>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold">{label}</p>
      <p className="text-text-secondary mt-0.5">{children}</p>
    </div>
  );
}

export default function ProposalsPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const categoriesQuery = useQuery({
    queryKey: ['processed-categories'],
    queryFn: uploadApi.listCategories,
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['processed-proposals', category],
    queryFn: () => uploadApi.listProcessed({ category: category || undefined, limit: 100 }),
    retry: false,
    // Poll while any row is still being processed so results appear live.
    refetchInterval: (query) => {
      const rows = query.state.data?.proposals ?? [];
      const busy = rows.some((p) => ['categorizing', 'extracting'].includes((p.status || '').toLowerCase()));
      return busy ? 4000 : false;
    },
  });

  const errorMessage =
    (error as any)?.response?.data?.error ||
    (error as any)?.response?.data?.message ||
    (error as any)?.message ||
    'Could not load processed proposals.';

  const proposals = data?.proposals ?? [];
  const filtered = proposals.filter((p) => {
    const hay = `${p.categorization?.title || ''} ${p.filename || ''}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text">Proposals</h1>
            <p className="text-sm text-text-muted mt-1">{data?.total ?? 0} processed proposals</p>
          </div>
          <Link to="/upload"><Button size="sm"><Plus className="w-4 h-4" /> Upload New</Button></Link>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <Input placeholder="Search proposals..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">All categories</option>
            {(categoriesQuery.data ?? []).map((c) => (
              <option key={c.category} value={c.category}>
                {labelForCategory(c.category)} ({c.count})
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="space-y-4">{[1, 2, 3].map((i) => <Card key={i} hover={false}><Skeleton className="h-20 w-full" /></Card>)}</div>
        ) : isError ? (
          <Card hover={false} className="border-red-200 bg-red-50/40 text-center py-14">
            <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="text-sm font-semibold text-red-700">Couldn’t load proposals</p>
            <p className="text-sm text-red-600 mt-1 max-w-md mx-auto">{errorMessage}</p>
            <p className="text-xs text-text-muted mt-2">
              The processing service must be running for this page to load.
            </p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" /> Retry
            </Button>
          </Card>
        ) : filtered.length === 0 ? (
          <Card hover={false} className="text-center py-16">
            <FileText className="w-12 h-12 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary">
              {category ? 'No proposals in this category' : 'No processed proposals yet'}
            </p>
            <Link to="/upload"><Button size="sm" className="mt-4">Go to files</Button></Link>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((p, i) => (
              <ProposalRow key={p.id} p={p} index={i} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
