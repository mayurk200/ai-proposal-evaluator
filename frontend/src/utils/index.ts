import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { isAxiosError } from 'axios';

/**
 * Extract a human-readable message from an unknown error (axios API errors
 * expose `error`/`message` in the response body; plain Errors have .message).
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const data = err.response?.data as { error?: string; message?: string } | undefined;
    return data?.error || data?.message || err.message || fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getScoreColor(score: number): string {
  if (score >= 80) return 'text-green-700';
  if (score >= 60) return 'text-yellow-600';
  return 'text-red-600';
}

export function getScoreBg(score: number): string {
  if (score >= 80) return 'score-high';
  if (score >= 60) return 'score-medium';
  return 'score-low';
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'EVALUATED': return 'bg-green-100 text-green-800';
    case 'EVALUATING': return 'bg-blue-100 text-blue-800';
    case 'EXTRACTING': return 'bg-yellow-100 text-yellow-800';
    case 'UPLOADED': return 'bg-gray-100 text-gray-800';
    case 'FAILED': return 'bg-red-100 text-red-800';
    case 'REJECTED': return 'bg-gray-200 text-gray-900 border border-gray-400';
    default: return 'bg-gray-100 text-gray-800';
  }
}

export function getRecommendationColor(rec: string): string {
  if (rec.includes('Highly')) return 'bg-green-100 text-green-800 border-green-200';
  if (rec.includes('Recommended')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (rec.includes('Conditionally')) return 'bg-yellow-50 text-yellow-700 border-yellow-200';
  return 'bg-red-50 text-red-700 border-red-200';
}
