import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Ban,
  Copy,
  ExternalLink,
  FileStack,
  FilterX,
  Play,
  RotateCcw,
  Undo2,
  Upload,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge, Button, Checkbox, IconButton, Select, Skeleton } from '@/components/ui';
import { PageHeader } from '@/components/ui/page';
import { ConfirmDialog, useToast } from '@/components/ui/overlays';
import {
  Pagination,
  SearchInput,
  SelectionBar,
  SortHeader,
  Table,
  TD,
  TH,
  THead,
  TR,
  type SortState,
} from '@/components/ui/data';
import {
  DuplicateBadge,
  EmptyState,
  ScoreCell,
  StatusBadge,
} from '@/components/domain';
import {
  analyticsApi,
  evaluationApi,
  proposalApi,
  type ProposalFilters,
} from '@/services/agrieval.service';
import { useAuthStore } from '@/store/authStore';
import { formatRelative } from '@/utils';
import type { BulkResult, Proposal, ProposalSortKey } from '@/types';

/**
 * The archive.
 *
 * Built on the assumption that this table holds thousands of rows after a few
 * years, which decides nearly every choice on the page:
 *
 *   - Filtering, sorting, counting and paging are all server-side. Sorting the
 *     current page in the browser would be a lie — page 2 of "highest score
 *     first" would be the wrong twenty rows.
 *   - Every control writes to the URL. A filtered, sorted view is then a link
 *     you can send to a colleague or come back to, and — the thing that was
 *     actually broken — opening a proposal and pressing Back returns you to the
 *     list you left rather than to page one of everything.
 *   - Selection drives bulk actions, because "evaluate these forty" is the
 *     normal operation on an archive this size, not forty separate clicks.
 */

/** Working states an operator actually returns to, not arbitrary slices. */
const VIEWS = [
  {
    key: 'inbox',
    label: 'To evaluate',
    icon: Play,
    filters: { is_evaluated: false, exclude_duplicates: true },
    hint: 'Metadata held, not scored, not ruled a duplicate. Evaluate any of these without re-uploading the document.',
  },
  {
    key: 'evaluated',
    label: 'Evaluated',
    filters: { is_evaluated: true },
    hint: 'Scored against the seven parameters, with the evidence behind every score kept.',
  },
  {
    key: 'duplicates',
    label: 'Duplicates',
    icon: Copy,
    filters: { review_decision: 'skipped_duplicate' },
    hint: 'Ruled duplicates. Kept and searchable, never evaluated — un-mark any of them to put it back in the queue.',
  },
  {
    key: 'review',
    label: 'Awaiting review',
    filters: { review_decision: 'pending' },
    hint: 'Flagged by the similarity gate. An admin has to compare them before anything is spent.',
  },
  {
    key: 'failed',
    label: 'Failed',
    icon: RotateCcw,
    filters: { status: 'failed' },
    hint: 'Retryable — the original document is still stored, so a retry costs no re-upload.',
  },
  {
    key: 'all',
    label: 'All',
    filters: {},
    hint: 'Every idea ever uploaded, evaluated or not. Filters, sorting and paging all run against the whole archive.',
  },
] as const;

type ViewKey = (typeof VIEWS)[number]['key'];

const SORT_LABELS: Record<string, string> = {
  created_at: 'Date added',
  title: 'Name',
  score: 'Score',
  status: 'Status',
};

export default function ProposalsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const isAdmin = useAuthStore((s) => s.hasRole('ADMIN'));

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<'evaluate' | 'duplicate' | 'unduplicate' | null>(
    null,
  );

  // --- URL is the state ----------------------------------------------------
  const view = (params.get('view') as ViewKey) || 'inbox';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 25);
  const search = params.get('q') || '';
  const categoryId = params.get('category') || '';
  const sort: SortState = {
    by: params.get('sort') || 'created_at',
    order: (params.get('order') as 'asc' | 'desc') || 'desc',
  };

  const patchParams = (changes: Record<string, string | number | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([key, value]) => {
      if (value === null || value === '') next.delete(key);
      else next.set(key, String(value));
    });
    // Any change to what is being listed invalidates the page number: staying
    // on page 7 of a filter that now has two results shows an empty table.
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
    setSelected(new Set());
  };

  const activeView = VIEWS.find((v) => v.key === view) ?? VIEWS[0];

  const filters: ProposalFilters = {
    ...activeView.filters,
    search: search || undefined,
    category_id: categoryId || undefined,
    page,
    limit,
    sort_by: sort.by as ProposalSortKey,
    sort_order: sort.order,
  };

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: analyticsApi.categories,
    staleTime: 5 * 60_000,
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['proposals', filters],
    queryFn: () => proposalApi.list(filters),
    // Ingestion and evaluation run on the server, so rows change status on
    // their own while this page sits open.
    refetchInterval: 15_000,
    placeholderData: (previous) => previous,
  });

  const proposals = data?.proposals ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['proposals'] });
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
  };

  // --- Bulk actions --------------------------------------------------------

  /** Turn a bulk result into one honest sentence. */
  const reportBulk = (result: BulkResult, verb: string) => {
    const done = result.queued ?? result.updated ?? 0;

    if (done === 0) {
      toast.error(
        `Nothing was ${verb}`,
        result.skipped_items[0]?.reason ?? 'Every selected item was ineligible.',
      );
    } else if (result.skipped > 0) {
      // Naming the first reason beats "6 skipped": the reason is what tells the
      // operator whether they need to do something about it.
      toast.toast({
        tone: 'warning',
        title: `${done} ${verb}, ${result.skipped} skipped`,
        description: result.skipped_items[0]?.reason,
      });
    } else {
      toast.success(`${done} ${verb}`);
    }

    setSelected(new Set());
    setConfirming(null);
    refresh();
  };

  const evaluateSelected = useMutation({
    mutationFn: () => evaluationApi.runMany([...selected]),
    onSuccess: (result) => reportBulk(result, 'queued for evaluation'),
    onError: () => toast.error('Could not queue these evaluations'),
  });

  const markDuplicates = useMutation({
    mutationFn: (isDuplicate: boolean) =>
      proposalApi.bulkMarkDuplicate([...selected], isDuplicate),
    onSuccess: (result, isDuplicate) =>
      reportBulk(result, isDuplicate ? 'marked as duplicates' : 'restored'),
    onError: () => toast.error('Could not update these proposals'),
  });

  // --- Selection -----------------------------------------------------------

  const selectableOnPage = useMemo(
    () => proposals.map((p) => p.id),
    [proposals],
  );
  const allSelected =
    selectableOnPage.length > 0 && selectableOnPage.every((id) => selected.has(id));
  const someSelected = selectableOnPage.some((id) => selected.has(id));

  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) selectableOnPage.forEach((id) => next.delete(id));
    else selectableOnPage.forEach((id) => next.add(id));
    setSelected(next);
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const hasFilters = Boolean(search || categoryId || view !== 'inbox');

  return (
    <AppLayout>
      <PageHeader
        title="Proposals"
        description={activeView.hint}
        meta={
          data && (
            <Badge tone="neutral">{data.total.toLocaleString()} in this view</Badge>
          )
        }
        actions={
          <Link to="/upload">
            <Button icon={Upload}>Upload</Button>
          </Link>
        }
      />

      {/* ------------------------------------------------------------ Views */}
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {VIEWS.map((item) => {
          const Icon = 'icon' in item ? item.icon : undefined;
          const isActive = item.key === view;

          return (
            <button
              key={item.key}
              onClick={() => patchParams({ view: item.key })}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                isActive
                  ? 'bg-primary text-white'
                  : 'text-text-secondary hover:bg-gray-100 hover:text-text'
              }`}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {item.label}
            </button>
          );
        })}
      </div>

      {/* ---------------------------------------------------------- Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={(value) => patchParams({ q: value || null })}
          placeholder="Search title, filename or problem statement"
          className="min-w-[260px] flex-1"
        />

        <Select
          value={categoryId}
          onChange={(e) => patchParams({ category: e.target.value || null })}
          className="w-auto min-w-[170px]"
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories?.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </Select>

        {/* Sorting is also on the column headers; this is here because on a
            narrow screen the headers scroll out of reach. */}
        <Select
          value={`${sort.by}:${sort.order}`}
          onChange={(e) => {
            const [by, order] = e.target.value.split(':');
            patchParams({ sort: by, order });
          }}
          className="w-auto"
          aria-label="Sort order"
        >
          {Object.entries(SORT_LABELS).flatMap(([key, label]) => [
            <option key={`${key}:desc`} value={`${key}:desc`}>
              {label} {key === 'title' ? 'Z–A' : '↓'}
            </option>,
            <option key={`${key}:asc`} value={`${key}:asc`}>
              {label} {key === 'title' ? 'A–Z' : '↑'}
            </option>,
          ])}
        </Select>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            icon={FilterX}
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
          >
            Reset
          </Button>
        )}
      </div>

      {/* ------------------------------------------------------------ Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        {isLoading ? (
          <div className="space-y-px p-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded" />
            ))}
          </div>
        ) : proposals.length === 0 ? (
          <EmptyState
            icon={FileStack}
            title={hasFilters ? 'Nothing matches these filters' : 'No proposals yet'}
            description={
              hasFilters
                ? 'Try a different view, or reset the filters.'
                : 'Upload a document to begin. Extraction, metadata and the duplicate check run on the server.'
            }
            action={
              hasFilters ? (
                <Button
                  variant="outline"
                  size="sm"
                  icon={FilterX}
                  onClick={() => setParams(new URLSearchParams(), { replace: true })}
                >
                  Reset filters
                </Button>
              ) : (
                <Link to="/upload">
                  <Button size="sm" icon={Upload}>
                    Upload
                  </Button>
                </Link>
              )
            }
          />
        ) : (
          <>
            <Table className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
              <THead>
                <tr>
                  <TH className="w-9 pr-0">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      onChange={toggleAll}
                      aria-label="Select all on this page"
                    />
                  </TH>
                  {/* w-full on the name column: in a table, the cell asking for
                      100% absorbs whatever the fixed columns leave, so the title
                      gets the room and everything else stays exactly as wide as
                      its content. */}
                  <SortHeader label="Proposal" sortKey="title" sort={sort} onSort={(s) => patchParams({ sort: s.by, order: s.order })} defaultOrder="asc" className="w-full" />
                  <TH className="hidden whitespace-nowrap lg:table-cell">Category</TH>
                  <TH className="whitespace-nowrap">Status</TH>
                  <SortHeader label="Score" sortKey="score" sort={sort} onSort={(s) => patchParams({ sort: s.by, order: s.order })} align="right" />
                  <SortHeader label="Added" sortKey="created_at" sort={sort} onSort={(s) => patchParams({ sort: s.by, order: s.order })} align="right" className="hidden sm:table-cell" />
                  <TH align="right" className="w-24">
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>

              <tbody>
                {proposals.map((proposal) => (
                  <ProposalRow
                    key={proposal.id}
                    proposal={proposal}
                    selected={selected.has(proposal.id)}
                    onToggle={() => toggleOne(proposal.id)}
                  />
                ))}
              </tbody>
            </Table>

            <Pagination
              page={data!.page}
              totalPages={data!.total_pages}
              total={data!.total}
              limit={data!.limit}
              onPage={(p) => patchParams({ page: p })}
              onLimit={(l) => patchParams({ limit: l, page: 1 })}
            />
          </>
        )}
      </div>

      {/* ------------------------------------------------- Bulk action bar */}
      <SelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button
          size="sm"
          icon={Play}
          loading={evaluateSelected.isPending}
          onClick={() => setConfirming('evaluate')}
        >
          Evaluate
        </Button>

        {isAdmin &&
          (view === 'duplicates' ? (
            <Button
              size="sm"
              variant="outline"
              icon={Undo2}
              loading={markDuplicates.isPending}
              onClick={() => setConfirming('unduplicate')}
            >
              Not duplicates
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              icon={Ban}
              loading={markDuplicates.isPending}
              onClick={() => setConfirming('duplicate')}
            >
              Mark duplicate
            </Button>
          ))}
      </SelectionBar>

      <ConfirmDialog
        open={confirming === 'evaluate'}
        title={`Evaluate ${selected.size} proposal${selected.size === 1 ? '' : 's'}?`}
        description="Each one runs the full agent pipeline — around 35,000 tokens and several minutes. They are queued on the server, so you can close this tab and come back to the results."
        confirmLabel="Queue evaluations"
        loading={evaluateSelected.isPending}
        onConfirm={() => evaluateSelected.mutate()}
        onCancel={() => setConfirming(null)}
      />

      <ConfirmDialog
        open={confirming === 'duplicate'}
        title={`Mark ${selected.size} as duplicate${selected.size === 1 ? '' : 's'}?`}
        description="They leave the working list and will not be evaluated. Nothing is deleted — the metadata is kept, the ideas stay searchable, and you can undo this from the Duplicates view."
        confirmLabel="Mark as duplicates"
        loading={markDuplicates.isPending}
        onConfirm={() => markDuplicates.mutate(true)}
        onCancel={() => setConfirming(null)}
      />

      <ConfirmDialog
        open={confirming === 'unduplicate'}
        title={`Restore ${selected.size} proposal${selected.size === 1 ? '' : 's'}?`}
        description="They go back into the queue as ideas that can be evaluated."
        confirmLabel="Restore"
        loading={markDuplicates.isPending}
        onConfirm={() => markDuplicates.mutate(false)}
        onCancel={() => setConfirming(null)}
      />
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------

function ProposalRow({
  proposal,
  selected,
  onToggle,
}: {
  proposal: Proposal;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <TR selected={selected}>
      <TD className="pr-0">
        <Checkbox
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${proposal.title || proposal.filename}`}
        />
      </TD>

      {/* max-w-0 with w-full on the header is the idiom that makes `truncate`
          work inside a table cell: without a resolved width the cell grows to
          fit its content instead of clipping it. */}
      <TD className="w-full max-w-0">
        <Link
          to={`/proposals/${proposal.id}`}
          className="block truncate text-[13px] font-medium text-text hover:text-primary"
          title={proposal.title || proposal.filename}
        >
          {proposal.title || proposal.filename}
        </Link>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="truncate text-xs text-text-muted">
            {proposal.company_name ?? 'Company not identified'}
          </span>
          <DuplicateBadge decision={proposal.review_decision} />
        </div>
      </TD>

      <TD className="hidden whitespace-nowrap lg:table-cell">
        <span className="text-xs text-text-secondary">
          {proposal.category_label ?? '—'}
        </span>
      </TD>

      <TD>
        <StatusBadge status={proposal.status} />
      </TD>

      <TD align="right">
        <ScoreCell score={proposal.latest_score} recommendation={proposal.latest_recommendation} />
      </TD>

      <TD align="right" className="hidden sm:table-cell">
        <span className="whitespace-nowrap text-xs text-text-muted" title={proposal.created_at}>
          {formatRelative(proposal.created_at)}
        </span>
      </TD>

      <TD align="right">
        <div className="flex items-center justify-end gap-0.5">
          <IconButton
            icon={ExternalLink}
            title="Open the original document"
            size="sm"
            onClick={() => proposalApi.openFile(proposal.id)}
          />
          {proposal.status === 'failed' && (
            <Link to={`/proposals/${proposal.id}`}>
              <IconButton icon={RotateCcw} title="Failed — open to retry" size="sm" variant="danger-soft" />
            </Link>
          )}
        </div>
      </TD>
    </TR>
  );
}
