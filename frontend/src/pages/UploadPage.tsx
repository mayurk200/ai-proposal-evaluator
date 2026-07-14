import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Copy,
  FileCheck2,
  FileText,
  Layers,
  Play,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button, Progress } from '@/components/ui';
import { StatusBadge } from '@/components/domain';
import { batchApi, proposalApi } from '@/services/agrieval.service';
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

export default function UploadPage() {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<IngestResult | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    setResult(null);
    // Batch upload is just several files at once — the server groups them and processes
    // each independently, so one bad PDF in a set of twenty fails only itself.
    setFiles((current) => [...current, ...accepted].slice(0, 25));
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    maxSize: 50 * 1024 * 1024,
    maxFiles: 25,
  });

  const upload = useMutation({
    mutationFn: () => proposalApi.upload(files, setProgress),
    onSuccess: (data) => {
      setResult(data);
      setFiles([]);
      setProgress(0);
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  // Once uploaded, watch the batch progress through extraction / metadata / the
  // duplicate gate. Nothing is reported as done merely because the bytes arrived.
  const { data: batch } = useQuery({
    queryKey: ['batch', result?.batch_id],
    queryFn: () => batchApi.get(result!.batch_id!),
    enabled: !!result?.batch_id,
    refetchInterval: 5_000,
  });

  const evaluateBatch = useMutation({
    mutationFn: () => batchApi.evaluate(result!.batch_id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch'] });
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
    },
  });

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <AppLayout>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-text">Upload proposals</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          Drop one document or twenty-five. Each is extracted, given metadata, and checked
          against the archive for duplicates — independently, so one bad file never sinks
          the rest.
        </p>
      </header>

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`glass-card-static cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
          isDragActive
            ? 'border-primary bg-accent-light/40'
            : 'border-border hover:border-primary/40'
        }`}
      >
        <input {...getInputProps()} />
        <UploadCloud className="mx-auto mb-3 h-9 w-9 text-text-muted" />
        <p className="text-sm font-medium text-text">
          {isDragActive ? 'Drop them here' : 'Drag documents here, or click to choose'}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          PDF, DOCX, PPTX, TXT or images · up to 50MB each · up to 25 at a time
        </p>
      </div>

      {/* Selected files */}
      {files.length > 0 && (
        <section className="glass-card-static mt-5 rounded-2xl p-5">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">
              {files.length} file{files.length === 1 ? '' : 's'} ready ·{' '}
              {(totalBytes / 1024 / 1024).toFixed(1)} MB
            </h2>
            <button
              onClick={() => setFiles([])}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          </header>

          <div className="mb-4 max-h-64 space-y-1 overflow-y-auto">
            {files.map((file, i) => (
              <div
                key={`${file.name}-${i}`}
                className="flex items-center gap-3 rounded-lg bg-white/60 px-3 py-2"
              >
                <FileText className="h-4 w-4 flex-shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1 truncate text-sm text-text">
                  {file.name}
                </span>
                <span className="text-xs text-text-muted">
                  {(file.size / 1024).toFixed(0)} KB
                </span>
                <button
                  onClick={() => setFiles((f) => f.filter((_, idx) => idx !== i))}
                  className="text-text-muted hover:text-red-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {upload.isPending && progress > 0 && (
            <div className="mb-3">
              <Progress value={progress} />
              <p className="mt-1 text-xs text-text-muted">Uploading… {progress}%</p>
            </div>
          )}

          <Button onClick={() => upload.mutate()} loading={upload.isPending}>
            <Upload className="h-4 w-4" />
            Upload {files.length} file{files.length === 1 ? '' : 's'}
          </Button>

          {upload.isError && (
            <p className="mt-2 text-xs text-red-600">
              {(upload.error as any)?.response?.data?.message ?? 'Upload failed.'}
            </p>
          )}
        </section>
      )}

      {/* Result + live batch progress */}
      {result && (
        <section className="glass-card-static mt-5 rounded-2xl p-5">
          <header className="mb-3 flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-emerald-600" />
            <h2 className="text-sm font-semibold text-text">
              {result.accepted} accepted
              {result.duplicates > 0 && `, ${result.duplicates} already in the archive`}
            </h2>
          </header>

          {result.duplicates > 0 && (
            <p className="mb-3 flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-text-muted">
              <Copy className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              Files whose exact contents were already processed were skipped — no
              re-extraction, no second evaluation, no duplicate row.
            </p>
          )}

          {batch && (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Total" value={batch.total} />
                <Stat label="Evaluated" value={batch.evaluated} />
                <Stat label="Possible duplicates" value={batch.awaiting_review} />
                <Stat label="Failed" value={batch.failed} />
              </div>

              <div className="mb-4 max-h-72 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border">
                {batch.proposals.map((proposal) => (
                  <Link
                    key={proposal.id}
                    to={`/proposals/${proposal.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-accent-light/20"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-text">
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
                  before evaluating — batch evaluation skips anything still awaiting a
                  ruling.
                </p>
              )}

              <Button
                onClick={() => evaluateBatch.mutate()}
                loading={evaluateBatch.isPending}
                disabled={batch.total === batch.evaluated}
              >
                <Play className="h-4 w-4" />
                Evaluate the batch
              </Button>
              <p className="mt-2 text-[11px] text-text-muted">
                Evaluation is paced by the LLM token budget, so a large batch takes a
                while. You can leave this page — it runs on the server.
              </p>
            </>
          )}

          {!result.batch_id && result.proposals[0] && (
            <Link
              to={`/proposals/${result.proposals[0].proposal_id}`}
              className="text-sm text-primary hover:underline"
            >
              View the proposal
            </Link>
          )}
        </section>
      )}

      {!files.length && !result && (
        <div className="mt-5 flex items-start gap-2 rounded-xl bg-gray-50 px-4 py-3">
          <Layers className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-muted" />
          <p className="text-xs leading-relaxed text-text-muted">
            Uploading is cheap and immediate: the file is stored, then extraction, metadata
            and the duplicate check run in the background. Nothing is marked successful
            merely because the upload landed — a failure stays visible and retryable.
          </p>
        </div>
      )}
    </AppLayout>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/60 px-3 py-2">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="text-lg font-bold tabular-nums text-text">{value}</p>
    </div>
  );
}
