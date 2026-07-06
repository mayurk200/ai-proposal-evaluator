import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { FileText, Search, Plus, Loader2, ChevronDown, ChevronUp, Tag, AlertTriangle, RefreshCw, Info, X, ExternalLink, CheckCircle2, Trash2, Trophy, List } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, Select, Skeleton, Badge, ScoreBadge, Progress } from '@/components/ui';
import { uploadApi, type ProcessedProposal } from '@/services/proposal.service';
import { cn, formatDate } from '@/utils';

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

type StatusFilter = 'all' | 'categorized' | 'processing' | 'failed';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'categorized', label: 'Categorized' },
  { value: 'processing', label: 'Processing' },
  { value: 'failed', label: 'Failed' },
];

function statusGroup(status?: string): StatusFilter {
  const s = (status || '').toLowerCase();
  if (s === 'categorized') return 'categorized';
  if (s === 'categorizing' || s === 'extracting') return 'processing';
  if (s === 'failed') return 'failed';
  return 'all';
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** External link that only renders when a URL exists. */
function StorageLink({ url, label }: { url?: string | null; label: string }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
    >
      <ExternalLink className="w-3 h-3" /> {label}
    </a>
  );
}

/**
 * "More info" modal: the complete stored record for one proposal — file
 * metadata, storage links, extraction stats, the exact extracted text the
 * categorization agent analyzed, and the agent's full output.
 */
function MoreInfoModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: d, isLoading, isError, error } = useQuery({
    queryKey: ['proposal-detail', id],
    queryFn: () => uploadApi.getProcessedDetail(id),
    retry: false,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock the page scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const cat = d?.categorization || null;
  const flags = cat?.flags || {};

  // Portal to <body>: the card's hover transform would otherwise become the
  // containing block for position:fixed and misplace the overlay.
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border/60 bg-background/60">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-accent/40 flex items-center justify-center flex-shrink-0">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-base font-semibold text-text truncate">
                {cat?.title || d?.filename || 'Proposal details'}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <StatusBadge status={d?.status} />
                {d?.agri_relevant === false && <Badge variant="warning">Not agri-relevant</Badge>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {typeof d?.rank === 'number' && d.rank > 0 && <ScoreBadge score={d.rank} size="md" />}
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-lg hover:bg-accent/40 text-text-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-5 overflow-y-auto space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : isError ? (
            <div className="text-center py-8">
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <p className="text-sm text-red-600">
                {(error as any)?.response?.data?.error || (error as any)?.message || 'Could not load details.'}
              </p>
            </div>
          ) : d ? (
            <>
              {/* ---- File ---- */}
              <section className="rounded-xl border border-border/50 bg-background/50 p-4">
                <SectionTitle>File</SectionTitle>
                <div className="grid gap-3 text-xs sm:grid-cols-3 mt-2">
                  <Field label="Filename">{d.filename || '—'}</Field>
                  <Field label="Format">{(d.document_format || '—').toUpperCase()}</Field>
                  <Field label="Size">{formatBytes(d.file_size_bytes)}</Field>
                  <Field label="Content type">{d.file_content_type || '—'}</Field>
                  <Field label="Uploaded">{d.created_at ? formatDate(d.created_at) : '—'}</Field>
                  <Field label="Proposal ID">
                    <span className="font-mono break-all">{d.id}</span>
                  </Field>
                </div>
                {d.file_hash && (
                  <div className="mt-3">
                    <Field label="SHA-256 (dedup hash)">
                      <span className="font-mono break-all">{d.file_hash}</span>
                    </Field>
                  </div>
                )}
                <div className="flex flex-wrap gap-4 mt-3">
                  <StorageLink url={d.source_url || d.original_url} label="Open original file" />
                  <StorageLink url={d.extracted_url} label="Stored extracted text" />
                  <StorageLink url={d.manifest_url} label="Manifest (JSON index)" />
                </div>
                {d.error_message && (
                  <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                    <Field label="Processing error">
                      <span className="text-red-700">{d.error_message}</span>
                    </Field>
                  </div>
                )}
              </section>

              {/* ---- Extraction ---- */}
              <section className="rounded-xl border border-border/50 bg-background/50 p-4">
                <SectionTitle>Extraction — what was read from the file</SectionTitle>
                <div className="grid gap-3 text-xs grid-cols-2 sm:grid-cols-4 mt-2">
                  <Field label="Pages">{d.total_pages ?? 0}</Field>
                  <Field label="Words">{d.total_words ?? 0}</Field>
                  <Field label="Characters">{d.char_count ?? 0}</Field>
                  <Field label="Images">{d.total_images ?? 0}</Field>
                  <Field label="Tables">{d.total_tables ?? 0}</Field>
                  <Field label="Scanned content">{d.has_scanned_content ? 'Yes (OCR needed)' : 'No'}</Field>
                  <Field label="Extracted at">{d.extracted_at ? formatDate(d.extracted_at) : '—'}</Field>
                  <Field label="Categorized at">{d.categorized_at ? formatDate(d.categorized_at) : '—'}</Field>
                </div>
                {d.detected_sections?.length ? (
                  <div className="mt-3">
                    <Field label="Detected sections">{d.detected_sections.join(', ')}</Field>
                  </div>
                ) : null}
              </section>

              {/* ---- Agent input ---- */}
              <section className="rounded-xl border border-border/50 bg-background/50 p-4">
                <SectionTitle>Agent input — the text the agent analyzed</SectionTitle>
                {d.extracted_text ? (
                  <pre className="mt-2 text-xs text-text-secondary bg-accent/20 border border-border/60 rounded-xl p-3 max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
                    {d.extracted_text}
                  </pre>
                ) : (
                  <p className="text-xs text-text-muted mt-2">
                    No extracted text stored for this proposal.
                  </p>
                )}
              </section>

              {/* ---- Agent output ---- */}
              <section className="rounded-xl border border-border/50 bg-background/50 p-4">
                <SectionTitle>Agent output — full categorization result</SectionTitle>
                {cat ? (
                  <div className="mt-2 space-y-3">
                    <div className="grid gap-3 text-xs sm:grid-cols-2">
                      {cat.title && <Field label="Title">{cat.title}</Field>}
                      {cat.stage && <Field label="Stage">{cat.stage}</Field>}
                      {cat.summary && (
                        <div className="sm:col-span-2">
                          <Field label="Summary">{cat.summary}</Field>
                        </div>
                      )}
                      {cat.problem_statement && <Field label="Problem">{cat.problem_statement}</Field>}
                      {cat.proposed_solution && <Field label="Solution">{cat.proposed_solution}</Field>}
                      {cat.technologies?.length ? (
                        <Field label="Technologies">{cat.technologies.join(', ')}</Field>
                      ) : null}
                      {cat.target_beneficiaries?.length ? (
                        <Field label="Beneficiaries">{cat.target_beneficiaries.join(', ')}</Field>
                      ) : null}
                      {cat.geography && <Field label="Geography">{cat.geography}</Field>}
                      {cat.keywords?.length ? (
                        <Field label="Keywords">{cat.keywords.join(', ')}</Field>
                      ) : null}
                      <Field label="Score (0–100)">{typeof cat.rank === 'number' ? cat.rank : '—'}</Field>
                      <Field label="Agent confidence">
                        {typeof cat.confidence === 'number' ? `${Math.round(cat.confidence * 100)}%` : '—'}
                      </Field>
                    </div>
                    {(d.categories?.length || cat.categories?.length) ? (
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold mb-1.5">Categories</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(d.categories?.length ? d.categories : cat.categories || []).map((c) => (
                            <span key={c} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-accent/50 text-primary font-medium">
                              <Tag className="w-2.5 h-2.5" /> {labelForCategory(c)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold mb-1.5">Flags</p>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant={flags.agri_relevant === false ? 'warning' : 'success'}>
                          {flags.agri_relevant === false ? 'Not agri-relevant' : 'Agri-relevant'}
                        </Badge>
                        {flags.needs_review && <Badge variant="warning">Needs review</Badge>}
                        {flags.insufficient_text && <Badge variant="danger">Insufficient text</Badge>}
                        {flags.out_of_scope && <Badge variant="danger">Out of scope</Badge>}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted mt-2">
                    No categorization output yet — the agent has not finished (or failed) for this file.
                  </p>
                )}
              </section>
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-end px-6 py-3 border-t border-border/60 bg-background/60">
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-bold uppercase tracking-wide text-text-secondary">
      {children}
    </h3>
  );
}

/** Compact stat chip for the header row (slim version of the Dashboard StatCard). */
function StatChip({ icon: Icon, label, value, spinning, index }: {
  icon: any; label: string; value: number; spinning?: boolean; index: number;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
      <Card hover={false} className="p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent/40 flex items-center justify-center flex-shrink-0">
          <Icon className={cn('w-4 h-4 text-primary', spinning && 'animate-spin')} />
        </div>
        <div className="min-w-0">
          <p className="text-xl font-bold text-text leading-none">{value}</p>
          <p className="text-xs text-text-muted mt-1 truncate">{label}</p>
        </div>
      </Card>
    </motion.div>
  );
}

/** Category chip; clickable so it doubles as a filter toggle. */
function CategoryChip({ slug, active, onClick }: { slug: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? 'Clear category filter' : `Filter by ${labelForCategory(slug)}`}
      className={cn(
        'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium transition-colors cursor-pointer',
        active ? 'bg-primary text-white' : 'bg-accent/50 text-primary hover:bg-accent'
      )}
    >
      <Tag className="w-2.5 h-2.5" /> {labelForCategory(slug)}
    </button>
  );
}

/** Labelled percentage meter used in the expanded card details. */
function MeterField({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] uppercase tracking-wide text-text-muted font-semibold">{label}</span>
        <span className="text-xs font-medium text-text-secondary">{pct}%</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

function ProposalRow({ p, index, activeCategory, onCategoryClick, onDelete, deleting }: {
  p: ProcessedProposal;
  index: number;
  activeCategory: string;
  onCategoryClick: (slug: string) => void;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const detail = p.categorization || null;
  const title = detail?.title || p.filename || 'Untitled proposal';
  const summary = detail?.summary;
  const categories = p.categories?.length ? p.categories : detail?.categories || [];
  const hasDetail = Boolean(detail);
  const flags = detail?.flags || {};
  const needsReview = Boolean(flags.needs_review);
  const notAgriRelevant = p.agri_relevant === false || flags.agri_relevant === false;

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
              {(categories.length > 0 || detail?.stage || needsReview || notAgriRelevant) && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                  {categories.map((c) => (
                    <CategoryChip
                      key={c}
                      slug={c}
                      active={c === activeCategory}
                      onClick={() => onCategoryClick(c)}
                    />
                  ))}
                  {detail?.stage && (
                    <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium capitalize">
                      {detail.stage}
                    </span>
                  )}
                  {needsReview && <Badge variant="warning">Needs review</Badge>}
                  {notAgriRelevant && <Badge variant="danger">Not agri-relevant</Badge>}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <StatusBadge status={p.status} />
            {typeof p.rank === 'number' && p.rank > 0 && <ScoreBadge score={p.rank} size="md" />}
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-border/50">
          <div className="flex flex-wrap items-center gap-4">
            {hasDetail && (
              <button
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {open ? <><ChevronUp className="w-3.5 h-3.5" /> Hide details</> : <><ChevronDown className="w-3.5 h-3.5" /> Show details</>}
              </button>
            )}
            <button
              onClick={() => setShowInfo(true)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Info className="w-3.5 h-3.5" /> More info
            </button>
            {confirmDelete ? (
              <span className="inline-flex items-center gap-3 text-xs ml-auto">
                <span className="text-text-secondary">Delete this proposal and its files?</span>
                <button
                  onClick={() => onDelete(p.id)}
                  disabled={deleting}
                  className="inline-flex items-center gap-1 font-semibold text-red-600 hover:underline disabled:opacity-50"
                >
                  {deleting && <Loader2 className="w-3 h-3 animate-spin" />}
                  {deleting ? 'Deleting...' : 'Yes, delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="font-medium text-text-secondary hover:underline disabled:opacity-50"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1 text-xs font-medium text-red-500 hover:text-red-600 hover:underline ml-auto"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
          </div>
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
              {detail.keywords?.length ? (
                <Field label="Keywords">{detail.keywords.join(', ')}</Field>
              ) : null}
              {(typeof detail.confidence === 'number' || typeof detail.agri_relevance === 'number') && (
                <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2 pt-1">
                  {typeof detail.confidence === 'number' && (
                    <MeterField label="Agent confidence" value={detail.confidence} />
                  )}
                  {typeof detail.agri_relevance === 'number' && (
                    <MeterField label="Agri relevance" value={detail.agri_relevance} />
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {showInfo && <MoreInfoModal id={p.id} onClose={() => setShowInfo(false)} />}
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

/** Gold / silver / bronze / neutral styling for leaderboard positions. */
function positionClasses(position: number): string {
  if (position === 1) return 'bg-gradient-to-br from-amber-200 to-yellow-400 text-amber-900';
  if (position === 2) return 'bg-gradient-to-br from-slate-200 to-slate-400 text-slate-800';
  if (position === 3) return 'bg-gradient-to-br from-orange-200 to-orange-400 text-orange-900';
  return 'bg-accent/30 text-text-secondary';
}

/** Categories a proposal belongs to (row field first, agent output fallback). */
function categoriesOf(p: ProcessedProposal): string[] {
  return p.categories?.length ? p.categories : p.categorization?.categories || [];
}

/**
 * Ranking system view. Works from the full (unfiltered) proposal set so every
 * category can be compared against the total file count:
 *
 * 1. Category standings — categories ranked by how many of the total files
 *    fall into them (share of total), tie-broken by average score.
 * 2. Leaderboard — proposals ranked by the agent's score (0-100), best first;
 *    positions are computed within the selected category when one is active.
 */
function RankingBoard({ search, activeCategory, onCategoryClick }: {
  search: string;
  activeCategory: string;
  onCategoryClick: (slug: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['processed-proposals-rankings'],
    queryFn: () => uploadApi.listProcessed({ limit: 100 }),
    retry: false,
  });

  const all = data?.proposals ?? [];
  const totalFiles = data?.total ?? all.length;

  const standings = useMemo(() => {
    const byCat = new Map<string, { count: number; scoreSum: number; scored: number }>();
    for (const p of all) {
      for (const c of categoriesOf(p)) {
        const entry = byCat.get(c) ?? { count: 0, scoreSum: 0, scored: 0 };
        entry.count += 1;
        if (typeof p.rank === 'number' && p.rank > 0) {
          entry.scoreSum += p.rank;
          entry.scored += 1;
        }
        byCat.set(c, entry);
      }
    }
    return [...byCat.entries()]
      .map(([slug, e]) => ({
        slug,
        count: e.count,
        share: totalFiles > 0 ? e.count / totalFiles : 0,
        avgScore: e.scored > 0 ? Math.round(e.scoreSum / e.scored) : 0,
      }))
      .sort((a, b) => b.count - a.count || b.avgScore - a.avgScore || a.slug.localeCompare(b.slug));
  }, [all, totalFiles]);

  const ranked = useMemo(() => {
    const q = search.toLowerCase();
    return all
      .filter((p) => {
        if (statusGroup(p.status) !== 'categorized' || !(typeof p.rank === 'number' && p.rank > 0)) return false;
        if (activeCategory && !categoriesOf(p).includes(activeCategory)) return false;
        const hay = `${p.categorization?.title || ''} ${p.filename || ''}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        const byScore = (b.rank ?? 0) - (a.rank ?? 0);
        if (byScore !== 0) return byScore;
        // Tie-break: newest first, so fresh submissions surface.
        return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
      });
  }, [all, search, activeCategory]);

  const poolSize = activeCategory
    ? standings.find((s) => s.slug === activeCategory)?.count ?? ranked.length
    : totalFiles;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} hover={false} className="p-4">
            <div className="flex items-center gap-4">
              <Skeleton className="w-10 h-10 rounded-xl flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="w-10 h-10 rounded-xl flex-shrink-0" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---- Category standings ---- */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text">Category standings</h2>
          <span className="text-xs text-text-muted">{totalFiles} files total</span>
        </div>
        {standings.length === 0 ? (
          <Card hover={false} className="text-center py-8">
            <p className="text-sm text-text-muted">No categorized files yet.</p>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {standings.map((s, i) => (
              <motion.div key={s.slug} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <button
                  type="button"
                  onClick={() => onCategoryClick(s.slug)}
                  title={activeCategory === s.slug ? 'Clear category filter' : `Show ${labelForCategory(s.slug)} leaderboard`}
                  className="w-full text-left"
                >
                  <Card
                    hover={false}
                    className={cn(
                      'p-4 h-full transition-all hover:shadow-card-hover',
                      activeCategory === s.slug && 'ring-2 ring-primary/40'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={cn(
                            'w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0',
                            positionClasses(i + 1)
                          )}
                        >
                          {i + 1}
                        </span>
                        <p className="text-sm font-semibold text-text truncate">{labelForCategory(s.slug)}</p>
                      </div>
                      <span className="text-[11px] font-medium text-text-secondary flex-shrink-0">
                        avg score {s.avgScore}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-3 text-xs text-text-muted">
                      <span>{s.count} of {totalFiles} files</span>
                      <span>{Math.round(s.share * 100)}%</span>
                    </div>
                    <Progress value={s.share * 100} className="h-1.5 mt-1.5" />
                  </Card>
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* ---- Proposal leaderboard ---- */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text">
            Leaderboard{activeCategory ? ` — ${labelForCategory(activeCategory)}` : ''}
          </h2>
          <span className="text-xs text-text-muted">
            {ranked.length} ranked of {poolSize} files
          </span>
        </div>
        {ranked.length === 0 ? (
          <Card hover={false} className="text-center py-16">
            <Trophy className="w-12 h-12 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary">No ranked proposals{activeCategory ? ' in this category' : ' yet'}</p>
            <p className="text-xs text-text-muted mt-1 max-w-sm mx-auto">
              Scores are assigned by the categorization agent once processing finishes.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {ranked.map((p, i) => {
              const position = i + 1;
              const detail = p.categorization || null;
              const title = detail?.title || p.filename || 'Untitled proposal';
              const categories = categoriesOf(p);
              return (
                <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <Card className="p-4">
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col items-center flex-shrink-0">
                        <div
                          className={cn(
                            'w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm',
                            positionClasses(position)
                          )}
                        >
                          #{position}
                        </div>
                        <span className="text-[10px] text-text-muted mt-1">of {ranked.length}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-text truncate" title={title}>{title}</p>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted">
                          {p.filename && <span className="truncate">{p.filename}</span>}
                          {p.created_at && <span className="flex-shrink-0">{formatDate(p.created_at)}</span>}
                        </div>
                        {categories.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            {categories.map((c) => (
                              <CategoryChip
                                key={c}
                                slug={c}
                                active={c === activeCategory}
                                onClick={() => onCategoryClick(c)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="hidden sm:block w-32 flex-shrink-0">
                        <div className="flex items-center justify-between mb-1 text-[11px] text-text-muted">
                          <span className="uppercase tracking-wide font-semibold">Score</span>
                          <span className="font-medium text-text-secondary">{p.rank}/100</span>
                        </div>
                        <Progress value={p.rank ?? 0} className="h-1.5" />
                      </div>
                      <ScoreBadge score={p.rank ?? 0} size="md" />
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Loading placeholder that mirrors the real layout: stat chips + proposal cards. */
function ProposalsSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} hover={false} className="p-4 flex items-center gap-3">
            <Skeleton className="w-9 h-9 rounded-lg flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-10" />
              <Skeleton className="h-3 w-20" />
            </div>
          </Card>
        ))}
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} hover={false} className="p-5">
            <div className="flex items-start gap-4">
              <Skeleton className="w-11 h-11 rounded-xl flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
                <div className="flex gap-1.5 pt-1">
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                </div>
              </div>
              <Skeleton className="w-10 h-10 rounded-xl flex-shrink-0" />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

export default function ProposalsPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<'newest' | 'rank'>('newest');
  const [view, setView] = useState<'list' | 'rankings'>('list');
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => uploadApi.deleteProcessed(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['processed-proposals'] });
      queryClient.invalidateQueries({ queryKey: ['processed-proposals-rankings'] });
      queryClient.invalidateQueries({ queryKey: ['processed-categories'] });
    },
  });

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

  const stats = useMemo(() => {
    let categorized = 0;
    let processing = 0;
    let needsReview = 0;
    for (const p of proposals) {
      const group = statusGroup(p.status);
      if (group === 'categorized') categorized += 1;
      if (group === 'processing') processing += 1;
      if (p.categorization?.flags?.needs_review || p.agri_relevant === false) needsReview += 1;
    }
    return { total: data?.total ?? proposals.length, categorized, processing, needsReview };
  }, [proposals, data?.total]);

  const searchFiltered = useMemo(
    () =>
      proposals.filter((p) => {
        const hay = `${p.categorization?.title || ''} ${p.filename || ''}`.toLowerCase();
        return hay.includes(search.toLowerCase());
      }),
    [proposals, search]
  );

  const filtered = useMemo(() => {
    let rows = searchFiltered;
    if (statusFilter !== 'all') {
      rows = rows.filter((p) => statusGroup(p.status) === statusFilter);
    }
    if (sort === 'rank') {
      rows = [...rows].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
    }
    return rows;
  }, [searchFiltered, statusFilter, sort]);

  const hasActiveFilters = search.trim() !== '' || category !== '' || statusFilter !== 'all';

  const clearFilters = () => {
    setSearch('');
    setCategory('');
    setStatusFilter('all');
  };

  // Clicking a card's category chip toggles the category filter.
  const handleCategoryClick = (slug: string) => {
    setCategory((current) => (current === slug ? '' : slug));
  };

  const categoryOptions = [
    { value: '', label: 'All categories' },
    ...(categoriesQuery.data ?? []).map((c) => ({
      value: c.category,
      label: `${labelForCategory(c.category)} (${c.count})`,
    })),
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text">Proposals</h1>
            <p className="text-sm text-text-muted mt-1">
              Every uploaded file, processed and categorized by the agent
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-xl border border-border bg-white p-1">
              <button
                type="button"
                onClick={() => setView('list')}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  view === 'list' ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:bg-accent-light'
                )}
              >
                <List className="w-3.5 h-3.5" /> List
              </button>
              <button
                type="button"
                onClick={() => setView('rankings')}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  view === 'rankings' ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:bg-accent-light'
                )}
              >
                <Trophy className="w-3.5 h-3.5" /> Rankings
              </button>
            </div>
            <Link to="/upload"><Button size="sm"><Plus className="w-4 h-4" /> Upload New</Button></Link>
          </div>
        </div>

        {isLoading ? (
          <ProposalsSkeleton />
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
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatChip icon={FileText} label="Total" value={stats.total} index={0} />
              <StatChip icon={CheckCircle2} label="Categorized" value={stats.categorized} index={1} />
              <StatChip icon={Loader2} label="Processing" value={stats.processing} spinning={stats.processing > 0} index={2} />
              <StatChip icon={AlertTriangle} label="Needs review" value={stats.needsReview} index={3} />
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1 sm:max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted z-10" />
                <Input placeholder="Search proposals..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
              </div>
              <div className="w-full sm:w-56">
                <Select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  options={categoryOptions}
                  aria-label="Filter by category"
                />
              </div>
              {view === 'list' && (
                <div className="w-full sm:w-44">
                  <Select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as 'newest' | 'rank')}
                    options={[
                      { value: 'newest', label: 'Newest first' },
                      { value: 'rank', label: 'Highest score' },
                    ]}
                    aria-label="Sort proposals"
                  />
                </div>
              )}
            </div>

            {view === 'list' && (
              <div className="flex flex-wrap items-center gap-2">
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setStatusFilter(f.value)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      statusFilter === f.value
                        ? 'bg-primary text-white shadow-sm'
                        : 'bg-white border border-border text-text-secondary hover:bg-accent-light'
                    )}
                  >
                    {f.label}
                  </button>
                ))}
                {hasActiveFilters && (
                  <div className="flex items-center gap-3 ml-auto text-xs text-text-muted">
                    <span>{filtered.length} of {proposals.length} shown</span>
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    >
                      <X className="w-3 h-3" /> Clear filters
                    </button>
                  </div>
                )}
              </div>
            )}

            {deleteMutation.isError && (
              <div className="rounded-xl border border-red-200 bg-red-50/60 px-4 py-2.5 text-xs text-red-700">
                Could not delete the proposal:{' '}
                {(deleteMutation.error as any)?.response?.data?.error || (deleteMutation.error as any)?.message}
              </div>
            )}

            {view === 'rankings' ? (
              <RankingBoard
                search={search}
                activeCategory={category}
                onCategoryClick={handleCategoryClick}
              />
            ) : filtered.length === 0 ? (
              <Card hover={false} className="text-center py-16">
                <FileText className="w-12 h-12 text-text-muted mx-auto mb-3" />
                {proposals.length === 0 && !category ? (
                  <>
                    <p className="text-text-secondary">No processed proposals yet</p>
                    <Link to="/upload">
                      <Button size="sm" className="mt-4"><Plus className="w-4 h-4" /> Upload your first</Button>
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="text-text-secondary">
                      {search.trim()
                        ? <>No proposals match &ldquo;{search.trim()}&rdquo;</>
                        : 'No proposals match the current filters'}
                    </p>
                    <Button variant="secondary" size="sm" className="mt-4" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  </>
                )}
              </Card>
            ) : (
              <div className="space-y-3">
                {filtered.map((p, i) => (
                  <ProposalRow
                    key={p.id}
                    p={p}
                    index={i}
                    activeCategory={category}
                    onCategoryClick={handleCategoryClick}
                    onDelete={(id) => deleteMutation.mutate(id)}
                    deleting={deleteMutation.isPending && deleteMutation.variables === p.id}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
