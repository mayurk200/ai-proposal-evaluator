import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Parse a timestamp from the API.
 *
 * The Python service stores naive UTC and serialises it without a zone, so
 * `new Date("2026-07-21T14:32:03")` is read by the browser as *local* time. In
 * India that lands five and a half hours in the past, which is how a proposal
 * uploaded a minute ago comes out as "5h ago". Appending the Z fixes the offset
 * at the boundary, once, rather than in every component that shows a date.
 */
function parseUtc(value: string): Date {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  return new Date(hasZone ? value : `${value}Z`);
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parseUtc(date));
}

export function formatDateTime(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parseUtc(date));
}

/**
 * "3m ago", "yesterday", "12 Mar".
 *
 * Relative for anything recent, absolute past a week. "47 days ago" is a number
 * nobody can convert to a date, and by then the exact date is what you wanted
 * anyway.
 */
export function formatRelative(date: string | null | undefined): string {
  if (!date) return '—';

  const then = parseUtc(date);
  const seconds = Math.round((Date.now() - then.getTime()) / 1000);

  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 172_800) return 'yesterday';
  if (seconds < 604_800) return `${Math.round(seconds / 86_400)}d ago`;

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    // Drop the year for dates inside the current one — it is noise on a list
    // where nearly everything shares it.
    year: then.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(then);
}

/** Seconds as a human duration. Used for job runtimes and evaluation timings. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export function formatFileSize(bytes: number): string {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

/** 1_284 -> "1.3k". For counts in tight spaces, where the exact figure is not
 *  the point and the column width is. */
export function formatCompact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
    .format(value);
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

/**
 * Score thresholds, in one place.
 *
 * They were previously duplicated across four files at three different cut-offs
 * — 80/60 in one, 70/45 in another — so the same 65 rendered amber in the list
 * and green on the detail page.
 */
export const SCORE_GOOD = 70;
export const SCORE_FAIR = 45;

export function scoreTone(score: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (score === null) return 'neutral';
  if (score >= SCORE_GOOD) return 'success';
  if (score >= SCORE_FAIR) return 'warning';
  return 'danger';
}

export function scoreTextClass(score: number | null): string {
  return {
    success: 'text-emerald-600',
    warning: 'text-amber-600',
    danger: 'text-red-600',
    neutral: 'text-text-muted',
  }[scoreTone(score)];
}

export function scoreBgClass(score: number | null): string {
  return {
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
    neutral: 'bg-gray-300',
  }[scoreTone(score)];
}
