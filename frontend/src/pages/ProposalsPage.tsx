import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ExternalLink,
  FileStack,
  Filter,
  Play,
  RotateCcw,
  Search,
  Upload,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button, Input, Skeleton } from '@/components/ui';
import {
  DecisionBadge,
  EmptyState,
  ScoreValue,
  StatusBadge,
} from '@/components/domain';
import { analyticsApi, proposalApi } from '@/services/agrieval.service';

/** The filter presets that correspond to real working states, not arbitrary slices. */
const PRESETS = [
  { key: 'all', label: 'All', filters: {} },
  {
    key: 'unevaluated',
    label: 'Not evaluated',
    filters: { is_evaluated: false },
    hint: 'Metadata held — evaluate any of these without re-uploading the document',
  },
  { key: 'evaluated', label: 'Evaluated', filters: { is_evaluated: true } },
  {
    key: 'duplicates',
    label: 'Possible duplicates',
    filters: { review_decision: 'pending' },
  },
  {
    key: 'failed',
    label: 'Failed',
    filters: { status: 'failed' },
    hint: 'Retryable — the original document is still stored',
  },
] as const;

export default function ProposalsPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [categoryId, setCategoryId] = useState<string>('');

  // The dashboard tiles deep-link straight into a filtered view.
  const active =
    PRESETS.find((preset) =>
      Object.entries(preset.filters).every(
        ([key, value]) => params.get(key) === String(value),
      ) && Object.keys(preset.filters).length > 0,
    ) ?? PRESETS[0];

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: analyticsApi.categories,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['proposals', active.key, search, page, categoryId],
    queryFn: () =>
      proposalApi.list({
        ...active.filters,
        search: search || undefined,
        category_id: categoryId || undefined,
        page,
        limit: 20,
      }),
    refetchInterval: 15_000,
  });

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setPage(1);
    const next = new URLSearchParams();
    Object.entries(preset.filters).forEach(([key, value]) =>
      next.set(key, String(value)),
    );
    setParams(next);
  };

  return (
    <AppLayout>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text">Proposals</h1>
          <p className="mt-1 text-sm text-text-muted">
            {data?.total ?? 0} ideas in the archive
          </p>
        </div>
        <Link to="/upload">
          <Button>
            <Upload className="h-4 w-4" />
            Upload
          </Button>
        </Link>
      </header>

      {/* Filters */}
      <div className="glass-card-static mb-5 rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              onClick={() => applyPreset(preset)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                preset.key === active.key
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-text-secondary hover:bg-gray-200'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              placeholder="Search by title or filename"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>

          <select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-border bg-white/80 px-3 py-2.5 text-sm"
          >
            <option value="">All categories</option>
            {categories?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </div>

        {'hint' in active && active.hint && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-text-muted">
            <Filter className="h-3 w-3" />
            {active.hint}
          </p>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : !data?.proposals.length ? (
        <EmptyState
          icon={FileStack}
          title="Nothing here"
          description="No proposals match these filters."
        />
      ) : (
        <>
          <div className="glass-card-static divide-y divide-border/60 rounded-2xl">
            {data.proposals.map((proposal) => (
              <div
                key={proposal.id}
                className="flex flex-wrap items-center gap-4 p-4 transition-colors hover:bg-accent-light/20"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/proposals/${proposal.id}`}
                    className="truncate text-sm font-semibold text-text hover:text-primary"
                  >
                    {proposal.title || proposal.filename}
                  </Link>
                  <p className="truncate text-xs text-text-muted">
                    {proposal.company_name ?? 'Company not identified'}
                    {proposal.category_label && ` · ${proposal.category_label}`}
                    {proposal.retry_count > 0 && ` · ${proposal.retry_count} attempts`}
                  </p>
                </div>

                <StatusBadge status={proposal.status} />

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => proposalApi.openFile(proposal.id)}
                    title="Open the original document"
                    className="rounded-lg p-2 text-text-muted transition-colors hover:bg-gray-100 hover:text-text"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>

                  {proposal.status === 'failed' ? (
                    <Link
                      to={`/proposals/${proposal.id}`}
                      title="Retry"
                      className="rounded-lg p-2 text-red-500 transition-colors hover:bg-red-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Link>
                  ) : (
                    !proposal.is_evaluated &&
                    proposal.review_decision === 'approved_for_eval' && (
                      <Link
                        to={`/proposals/${proposal.id}`}
                        title="Evaluate"
                        className="rounded-lg p-2 text-primary transition-colors hover:bg-accent-light"
                      >
                        <Play className="h-4 w-4" />
                      </Link>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>

          {data.total_pages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="text-xs text-text-muted">
                Page {data.page} of {data.total_pages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= data.total_pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </AppLayout>
  );
}
