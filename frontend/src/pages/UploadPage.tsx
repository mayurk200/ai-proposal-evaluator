import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  Copy,
  FileText,
  Play,
  Server,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge, Button, IconButton, Progress } from '@/components/ui';
import { PageHeader, Section } from '@/components/ui/page';
import { useToast } from '@/components/ui/overlays';
import { StatusBadge } from '@/components/domain';
import { batchApi, proposalApi } from '@/services/agrieval.service';
import { formatFileSize } from '@/utils';
import type { IngestResult } from '@/types';

const ACCEPTED = {
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
};

const MAX_FILES = 25;

export default function UploadPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<IngestResult | null>(null);

  const onDrop = useCallback(
    (accepted: File[], rejected: unknown[]) => {
      setResult(null);
      setFiles((current) => [...current, ...accepted].slice(0, MAX_FILES));
      if (rejected.length) {
        toast.error(
          `${rejected.length} file${rejected.length === 1 ? '' : 's'} rejected`,
          'Unsupported format, or larger than 50MB.',
        );
      }
    },
    [toast],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    maxSize: 50 * 1024 * 1024,
    maxFiles: MAX_FILES,
  });

  const upload = useMutation({
    mutationFn: () => proposalApi.upload(files, setProgress),
    onSuccess: (data) => {
      setResult(data);
      setFiles([]);
      setProgress(0);
      toast.success(
        `${data.accepted} document${data.accepted === 1 ? '' : 's'} accepted`,
        'Processing has started on the server. You can leave this page.',
      );
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err: any) =>
      toast.error('Upload failed', err?.response?.data?.message ?? 'Nothing was stored.'),
  });

  // Once uploaded, watch the batch move through extraction, metadata and the
  // duplicate gate. Nothing is reported as done because the bytes arrived.
  const { data: batch } = useQuery({
    queryKey: ['batch', result?.batch_id],
    queryFn: () => batchApi.get(result!.batch_id!),
    enabled: !!result?.batch_id,
    refetchInterval: 5_000,
  });

  const evaluateBatch = useMutation({
    mutationFn: () => batchApi.evaluate(result!.batch_id!),
    onSuccess: (data: any) => {
      toast.success(
        `${data.queued} evaluation${data.queued === 1 ? '' : 's'} queued`,
        data.awaiting_review > 0
          ? `${data.awaiting_review} skipped — still awaiting a duplicate ruling.`
          : 'They run on the server; watch progress under Activity.',
      );
      queryClient.invalidateQueries({ queryKey: ['batch'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: () => toast.error('Could not queue the batch'),
  });

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const processed = batch ? batch.total - batch.in_progress : 0;

  return (
    <AppLayout>
      <PageHeader
        title="Upload proposals"
        description="Drop one document or twenty-five. Each is extracted, given metadata and checked against the archive independently, so one bad file never sinks the rest."
      />

      {/* ------------------------------------------------------- Dropzone */}
      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          isDragActive
            ? 'border-primary bg-accent-light/50'
            : 'border-border-strong bg-surface hover:border-primary/50 hover:bg-accent-light/20'
        }`}
      >
        <input {...getInputProps()} />
        <UploadCloud
          className={`mx-auto mb-3 h-8 w-8 ${isDragActive ? 'text-primary' : 'text-text-muted'}`}
        />
        <p className="text-sm font-medium text-text">
          {isDragActive ? 'Drop them here' : 'Drag documents here, or click to choose'}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          PDF, DOCX, PPTX, TXT or images · up to 50MB each · up to {MAX_FILES} at a time
        </p>
      </div>

      {/* --------------------------------------------------- Staged files */}
      {files.length > 0 && (
        <Section
          className="mt-4"
          title={`${files.length} file${files.length === 1 ? '' : 's'} ready · ${formatFileSize(totalBytes)}`}
          actions={
            <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setFiles([])}>
              Clear
            </Button>
          }
        >
          <div className="mb-4 max-h-64 space-y-1 overflow-y-auto">
            {files.map((file, i) => (
              <div
                key={`${file.name}-${i}`}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-1.5"
              >
                <FileText className="h-4 w-4 flex-shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-text">{file.name}</span>
                <span className="flex-shrink-0 text-xs tabular-nums text-text-muted">
                  {formatFileSize(file.size)}
                </span>
                <IconButton
                  icon={X}
                  title={`Remove ${file.name}`}
                  size="xs"
                  onClick={() => setFiles((f) => f.filter((_, idx) => idx !== i))}
                />
              </div>
            ))}
          </div>

          {upload.isPending && progress > 0 && (
            <div className="mb-3">
              <Progress value={progress} />
              <p className="mt-1 text-xs text-text-muted">
                {progress < 100
                  ? `Uploading… ${progress}%`
                  : 'Uploaded — the server is taking it from here.'}
              </p>
            </div>
          )}

          <Button icon={Upload} onClick={() => upload.mutate()} loading={upload.isPending}>
            Upload {files.length} file{files.length === 1 ? '' : 's'}
          </Button>
        </Section>
      )}

      {/* ------------------------------------------- Result + live progress */}
      {result && (
        <Section
          className="mt-4"
          title={`${result.accepted} accepted${
            result.duplicates > 0 ? `, ${result.duplicates} already in the archive` : ''
          }`}
          icon={CheckCircle2}
          description="Extraction, metadata and the duplicate check are running on the server. You can close this tab."
        >
          {result.duplicates > 0 && (
            <p className="mb-3 flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-text-muted">
              <Copy className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              Files whose exact contents were already processed were skipped — no
              re-extraction, no second evaluation, no duplicate row.
            </p>
          )}

          {batch && (
            <>
              <div className="mb-3">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-text-secondary">
                    {processed} of {batch.total} processed
                  </span>
                  <span className="tabular-nums text-text-muted">
                    {Math.round((processed / Math.max(batch.total, 1)) * 100)}%
                  </span>
                </div>
                <Progress value={processed} max={batch.total} />
              </div>

              <div className="mb-3 flex flex-wrap gap-2">
                {batch.awaiting_review > 0 && (
                  <Badge tone="warning" icon={Copy}>
                    {batch.awaiting_review} possible duplicate
                    {batch.awaiting_review === 1 ? '' : 's'}
                  </Badge>
                )}
                {batch.evaluated > 0 && (
                  <Badge tone="success">{batch.evaluated} evaluated</Badge>
                )}
                {batch.failed > 0 && <Badge tone="danger">{batch.failed} failed</Badge>}
              </div>

              <div className="mb-4 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {batch.proposals.map((proposal) => (
                  <Link
                    key={proposal.id}
                    to={`/proposals/${proposal.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-gray-50"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                      {proposal.title || proposal.filename}
                    </span>
                    <StatusBadge status={proposal.status} />
                  </Link>
                ))}
              </div>

              {batch.awaiting_review > 0 && (
                <p className="mb-3 text-xs text-amber-700">
                  {batch.awaiting_review} of these resemble ideas already in the database.{' '}
                  <Link to="/review" className="font-medium underline">
                    Review them
                  </Link>{' '}
                  first — batch evaluation skips anything still awaiting a ruling.
                </p>
              )}

              <Button
                icon={Play}
                onClick={() => evaluateBatch.mutate()}
                loading={evaluateBatch.isPending}
                disabled={batch.total === batch.evaluated}
              >
                Evaluate this batch
              </Button>
              <p className="mt-2 text-[11px] text-text-muted">
                Evaluation is paced by the token budget, so a large batch takes a while. It is
                queued on the server — leaving this page does not stop it.
              </p>
            </>
          )}

          {!result.batch_id && result.proposals[0] && (
            <Link
              to={`/proposals/${result.proposals[0].proposal_id}`}
              className="text-[13px] text-primary hover:underline"
            >
              View the proposal →
            </Link>
          )}
        </Section>
      )}

      {!files.length && !result && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-border bg-surface px-4 py-3">
          <Server className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-muted" />
          <p className="text-xs leading-relaxed text-text-muted">
            Uploading is immediate: the file is stored, then extraction, metadata and the
            duplicate check are queued as server-side jobs. Close your laptop if you like —
            the work carries on, and anything interrupted by a restart is picked up again
            rather than lost. Nothing is marked successful merely because the upload landed;
            a failure stays visible and retryable.
          </p>
        </div>
      )}
    </AppLayout>
  );
}
