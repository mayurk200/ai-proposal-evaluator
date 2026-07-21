import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileSearch,
  Gauge,
  Inbox,
  Loader2,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge, Button, IconButton, Skeleton } from '@/components/ui';
import { PageHeader, SegmentedControl } from '@/components/ui/page';
import { useToast } from '@/components/ui/overlays';
import {
  Pagination,
  Table,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui/data';
import { EmptyState, StatTile } from '@/components/domain';
import { jobApi } from '@/services/agrieval.service';
import { formatDuration, formatRelative } from '@/utils';
import type { Job, JobStatus } from '@/types';

/**
 * The work queue, made visible.
 *
 * This page exists because processing left the request cycle. That change is
 * what lets an operator upload twenty documents and shut their laptop — but it
 * also means that after clicking Upload, nothing on screen proves anything is
 * happening. Without somewhere to look, a busy server and a broken one are
 * indistinguishable, and the honest answer to "did that work?" was previously
 * "refresh the list in a few minutes and find out".
 */

const STATUS_META: Record<
  JobStatus,
  { label: string; tone: 'info' | 'success' | 'danger' | 'neutral'; icon: React.ElementType }
> = {
  queued: { label: 'Queued', tone: 'neutral', icon: Clock },
  running: { label: 'Running', tone: 'info', icon: Loader2 },
  succeeded: { label: 'Succeeded', tone: 'success', icon: CheckCircle2 },
  failed: { label: 'Failed', tone: 'danger', icon: XCircle },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: X },
};

const KIND_META: Record<string, { label: string; icon: React.ElementType; note: string }> = {
  ingest: {
    label: 'Process document',
    icon: FileSearch,
    note: 'Extract, sectionise, generate metadata, check for duplicates',
  },
  evaluate: {
    label: 'Evaluate',
    icon: Gauge,
    note: 'The full agent pipeline — around 35,000 tokens',
  },
};

const FILTERS = [
  { value: 'active', label: 'In progress' },
  { value: 'failed', label: 'Failed' },
  { value: '', label: 'All' },
] as const;

export default function ActivityPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('active');
  const [page, setPage] = useState(1);

  const { data: stats } = useQuery({
    queryKey: ['jobs', 'stats'],
    queryFn: jobApi.stats,
    refetchInterval: 5_000,
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['jobs', filter, page],
    // "In progress" is two statuses, and the API filters by one. Asking for
    // everything and letting the client narrow it would break pagination, so
    // this fetches queued and running separately and merges them.
    queryFn: async () => {
      if (filter !== 'active') {
        return jobApi.list({ page, limit: 25, status: filter || undefined });
      }
      const [queued, running] = await Promise.all([
        jobApi.list({ page: 1, limit: 50, status: 'queued' }),
        jobApi.list({ page: 1, limit: 50, status: 'running' }),
      ]);
      const jobs = [...running.jobs, ...queued.jobs];
      return {
        jobs,
        total: running.total + queued.total,
        page: 1,
        limit: jobs.length || 1,
        total_pages: 1,
      };
    },
    // Fast enough to feel live, slow enough not to hammer the database.
    refetchInterval: 5_000,
    placeholderData: (previous) => previous,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => jobApi.cancel(id),
    onSuccess: () => {
      toast.success('Job cancelled');
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: () =>
      toast.error(
        'Could not cancel',
        'Only a job that has not started can be cancelled — a running one is already spending tokens.',
      ),
  });

  const jobs = data?.jobs ?? [];

  return (
    <AppLayout>
      <PageHeader
        title="Activity"
        description="Extraction and evaluation run on the server, from a queue held in the database. Work continues after you close the tab, and anything interrupted by a restart is picked up again rather than lost."
        actions={
          <Button
            variant="outline"
            size="sm"
            icon={RefreshCw}
            loading={isFetching}
            onClick={() => queryClient.invalidateQueries({ queryKey: ['jobs'] })}
          >
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={Clock}
          label="Queued"
          value={stats?.totals.queued ?? 0}
          hint={
            stats?.oldest_queued_at
              ? `Oldest waiting since ${formatRelative(stats.oldest_queued_at)}`
              : 'Nothing waiting'
          }
        />
        <StatTile
          icon={Loader2}
          label="Running"
          value={stats?.totals.running ?? 0}
          tone={stats?.totals.running ? 'warning' : 'default'}
          hint="Being worked on right now"
        />
        <StatTile
          icon={CheckCircle2}
          label="Succeeded"
          value={stats?.totals.succeeded ?? 0}
          tone="success"
        />
        <StatTile
          icon={XCircle}
          label="Failed"
          value={stats?.totals.failed ?? 0}
          tone={stats?.totals.failed ? 'danger' : 'default'}
          hint="Out of retries — these need a person"
        />
      </div>

      <div className="mt-4 mb-3">
        <SegmentedControl
          options={FILTERS.map((f) => ({ value: f.value, label: f.label }))}
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setPage(1);
          }}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        {isLoading ? (
          <div className="space-y-px p-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={filter === 'active' ? 'Nothing in progress' : 'No jobs here'}
            description={
              filter === 'active'
                ? 'The queue is empty. Everything uploaded has been processed.'
                : 'Nothing matches this filter.'
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH className="w-full">Job</TH>
                  <TH className="whitespace-nowrap">Status</TH>
                  <TH align="center" className="whitespace-nowrap">
                    Attempt
                  </TH>
                  <TH align="right" className="whitespace-nowrap">
                    Started
                  </TH>
                  <TH align="right" className="w-10">
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {jobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    onCancel={() => cancel.mutate(job.id)}
                    cancelling={cancel.isPending}
                  />
                ))}
              </tbody>
            </Table>

            {filter !== 'active' && data && data.total_pages > 1 && (
              <Pagination
                page={data.page}
                totalPages={data.total_pages}
                total={data.total}
                limit={data.limit}
                onPage={setPage}
              />
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------

function JobRow({
  job,
  onCancel,
  cancelling,
}: {
  job: Job;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const kind = KIND_META[job.kind] ?? {
    label: job.kind,
    icon: Gauge,
    note: '',
  };
  const KindIcon = kind.icon;
  const status = STATUS_META[job.status];
  const StatusIcon = status.icon;

  const runtime =
    job.started_at && job.finished_at
      ? (new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()) / 1000
      : null;

  return (
    <TR>
      <TD className="w-full max-w-0">
        <div className="flex items-center gap-2.5">
          <KindIcon className="h-4 w-4 flex-shrink-0 text-text-muted" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {job.proposal_id ? (
                <Link
                  to={`/proposals/${job.proposal_id}`}
                  className="text-[13px] font-medium text-text hover:text-primary"
                >
                  {kind.label}
                </Link>
              ) : (
                <span className="text-[13px] font-medium text-text">{kind.label}</span>
              )}
            </div>
            <p className="truncate text-xs text-text-muted">
              {job.error ? (
                <span className="text-red-600">{job.error}</span>
              ) : (
                kind.note
              )}
            </p>
          </div>
        </div>
      </TD>

      <TD className="whitespace-nowrap">
        <Badge tone={status.tone}>
          <StatusIcon
            className={`h-3 w-3 ${job.status === 'running' ? 'animate-spin' : ''}`}
          />
          {status.label}
        </Badge>
      </TD>

      <TD align="center" className="whitespace-nowrap">
        <span
          className={`text-xs tabular-nums ${
            job.attempts > 1 ? 'font-medium text-amber-700' : 'text-text-muted'
          }`}
          title={
            job.attempts > 1
              ? 'This job has been retried. Retries back off, so a rate limit is not hammered.'
              : undefined
          }
        >
          {job.attempts}/{job.max_attempts}
          {job.attempts > 1 && <AlertTriangle className="ml-1 inline h-3 w-3" />}
        </span>
      </TD>

      <TD align="right" className="whitespace-nowrap">
        <span className="text-xs text-text-muted">
          {job.started_at ? formatRelative(job.started_at) : formatRelative(job.created_at)}
          {runtime !== null && ` · ${formatDuration(runtime)}`}
        </span>
      </TD>

      <TD align="right">
        {job.status === 'queued' && (
          <IconButton
            icon={X}
            title="Cancel this job"
            size="sm"
            disabled={cancelling}
            onClick={onCancel}
          />
        )}
      </TD>
    </TR>
  );
}
