import React from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search, X } from 'lucide-react';
import { cn } from '@/utils';
import { Button, IconButton, Select } from '@/components/ui';

/**
 * Table, sorting and pagination.
 *
 * Built for an archive that grows for years. Two consequences run through the
 * whole file: the row is dense enough that a screen shows twenty of them rather
 * than six, and every operation that depends on the whole set — sorting,
 * counting, paging — is a server concern. Sorting the current page client-side
 * would be a lie: page 2 of "highest score first" would be the wrong rows.
 */

// ===========================================================================
// Table
// ===========================================================================

export const Table: React.FC<React.TableHTMLAttributes<HTMLTableElement>> = ({
  className,
  ...props
}) => (
  // The wrapper scrolls, not the page. A wide table must never push the whole
  // layout sideways.
  <div className="w-full overflow-x-auto">
    <table className={cn('w-full border-collapse text-sm', className)} {...props} />
  </div>
);

export const THead: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  className,
  ...props
}) => (
  <thead
    className={cn(
      // Sticky so the column meanings survive scrolling a long page of results.
      'sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm',
      className,
    )}
    {...props}
  />
);

export const TH: React.FC<
  React.ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }
> = ({ className, align = 'left', ...props }) => (
  <th
    scope="col"
    className={cn(
      'border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted',
      align === 'right' && 'text-right',
      align === 'center' && 'text-center',
      align === 'left' && 'text-left',
      className,
    )}
    {...props}
  />
);

export const TR: React.FC<React.HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }> = ({
  className,
  selected,
  ...props
}) => (
  <tr
    className={cn(
      'border-b border-border/60 transition-colors last:border-0',
      selected ? 'bg-accent-light/50' : 'hover:bg-gray-50/80',
      className,
    )}
    {...props}
  />
);

export const TD: React.FC<
  React.TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }
> = ({ className, align = 'left', ...props }) => (
  <td
    className={cn(
      'px-3 py-2.5 align-middle',
      align === 'right' && 'text-right',
      align === 'center' && 'text-center',
      className,
    )}
    {...props}
  />
);

// ===========================================================================
// Sorting
// ===========================================================================

export interface SortState {
  by: string;
  order: 'asc' | 'desc';
}

/**
 * A sortable column header.
 *
 * Clicking an inactive column sorts by it in its natural direction — newest
 * first for a date, highest first for a score, A-Z for a name. Defaulting
 * everything to ascending would mean one click on "Score" shows you the worst
 * proposals, which is never what anyone wanted.
 */
export const SortHeader: React.FC<{
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (next: SortState) => void;
  defaultOrder?: 'asc' | 'desc';
  align?: 'left' | 'right' | 'center';
  className?: string;
}> = ({ label, sortKey, sort, onSort, defaultOrder = 'desc', align = 'left', className }) => {
  const active = sort.by === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.order === 'asc' ? ArrowUp : ArrowDown;

  return (
    <TH align={align} className={cn('p-0', className)} aria-sort={
      active ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'
    }>
      <button
        onClick={() =>
          onSort({
            by: sortKey,
            order: active ? (sort.order === 'asc' ? 'desc' : 'asc') : defaultOrder,
          })
        }
        className={cn(
          'flex w-full items-center gap-1 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide transition-colors',
          'hover:text-text focus-visible:outline-none focus-visible:text-primary',
          active ? 'text-primary' : 'text-text-muted',
          align === 'right' && 'justify-end',
          align === 'center' && 'justify-center',
        )}
      >
        {label}
        <Icon className={cn('h-3 w-3', !active && 'opacity-40')} />
      </button>
    </TH>
  );
};

// ===========================================================================
// Pagination
// ===========================================================================

/**
 * Page numbers around the current page, with ellipses.
 *
 * Prev/Next alone is fine for three pages and useless for two hundred: an
 * operator who knows the archive is sorted by date has no way to reach the
 * middle of it without clicking ninety times.
 */
function pageWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set<number>([1, total, current]);
  for (const offset of [-1, 1]) {
    const page = current + offset;
    if (page > 1 && page < total) pages.add(page);
  }
  // Keep the row a constant width near the ends, so the control does not
  // visibly resize as you page through.
  if (current <= 3) [2, 3, 4].forEach((p) => p < total && pages.add(p));
  if (current >= total - 2)
    [total - 1, total - 2, total - 3].forEach((p) => p > 1 && pages.add(p));

  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  sorted.forEach((page, i) => {
    if (i > 0 && page - sorted[i - 1] > 1) out.push('gap');
    out.push(page);
  });
  return out;
}

export const Pagination: React.FC<{
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPage: (page: number) => void;
  onLimit?: (limit: number) => void;
  pageSizes?: number[];
}> = ({ page, totalPages, total, limit, onPage, onLimit, pageSizes = [25, 50, 100] }) => {
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2.5">
      <p className="text-xs text-text-muted">
        {/* The absolute position matters more than the page number when the set
            is large: "1–25 of 1,284" tells you how much is left. */}
        <span className="font-medium text-text-secondary tabular-nums">
          {first.toLocaleString()}–{last.toLocaleString()}
        </span>{' '}
        of <span className="tabular-nums">{total.toLocaleString()}</span>
      </p>

      <div className="flex items-center gap-2">
        {onLimit && (
          <Select
            value={limit}
            onChange={(e) => onLimit(Number(e.target.value))}
            className="h-8 w-auto text-xs"
            aria-label="Rows per page"
          >
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {size} per page
              </option>
            ))}
          </Select>
        )}

        <nav className="flex items-center gap-1" aria-label="Pagination">
          <IconButton
            icon={ChevronLeft}
            title="Previous page"
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          />

          {pageWindow(page, Math.max(totalPages, 1)).map((entry, i) =>
            entry === 'gap' ? (
              <span key={`gap-${i}`} className="px-1 text-xs text-text-muted">
                …
              </span>
            ) : (
              <button
                key={entry}
                onClick={() => onPage(entry)}
                aria-current={entry === page ? 'page' : undefined}
                className={cn(
                  'h-8 min-w-8 rounded-lg px-2 text-xs font-medium tabular-nums transition-colors',
                  entry === page
                    ? 'bg-primary text-white'
                    : 'text-text-secondary hover:bg-gray-100',
                )}
              >
                {entry}
              </button>
            ),
          )}

          <IconButton
            icon={ChevronRight}
            title="Next page"
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
          />
        </nav>
      </div>
    </div>
  );
};

// ===========================================================================
// Search
// ===========================================================================

/**
 * A search box that debounces before it queries.
 *
 * Typing "irrigation" without this is ten requests, nine of them already stale
 * by the time they land, each one a full filtered count over the archive. The
 * input itself stays instant — only the value handed upward waits.
 */
export const SearchInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  delay?: number;
  className?: string;
}> = ({ value, onChange, placeholder = 'Search', delay = 300, className }) => {
  const [local, setLocal] = React.useState(value);
  const [lastValue, setLastValue] = React.useState(value);

  // Keep in step when the value is reset from outside (clearing all filters).
  // Adjusted during render rather than in an effect: an effect would render the
  // stale value once, then immediately re-render — visible as a flicker of the
  // old search term after the Reset button is pressed.
  if (value !== lastValue) {
    setLastValue(value);
    setLocal(value);
  }

  React.useEffect(() => {
    if (local === value) return;
    const timer = setTimeout(() => onChange(local), delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, delay]);

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
      <input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className={
          'h-9 w-full rounded-lg border border-border-strong bg-white pl-9 pr-8 text-sm ' +
          'placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15'
        }
      />
      {local && (
        <button
          onClick={() => setLocal('')}
          title="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-gray-100 hover:text-text"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};

// ===========================================================================
// Bulk selection bar
// ===========================================================================

/**
 * The action bar that appears when rows are selected.
 *
 * Anchored to the bottom of the viewport rather than the top of the table: with
 * fifty rows on screen the selection you made is often scrolled away, and a
 * toolbar that goes with it takes the actions with it.
 */
export const SelectionBar: React.FC<{
  count: number;
  onClear: () => void;
  children: React.ReactNode;
}> = ({ count, onClear, children }) => {
  if (count === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-5">
      <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 shadow-elevated">
        <span className="text-sm font-medium text-text tabular-nums">
          {count.toLocaleString()} selected
        </span>
        <span className="h-5 w-px bg-border" />
        {children}
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
};
