import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  CircuitBoard,
  Copy,
  Cpu,
  Database,
  FileInput,
  HardDrive,
  RefreshCw,
  ScanText,
  ShieldCheck,
  User,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge, Button, Skeleton } from '@/components/ui';
import { PageHeader, Section } from '@/components/ui/page';
import { systemApi } from '@/services/agrieval.service';
import { useAuthStore } from '@/store/authStore';

/**
 * What the system is actually configured to do.
 *
 * This page previously showed a profile form that saved nowhere, notification
 * toggles wired to nothing, and a hardcoded model name that had been wrong since
 * the model changed. Every value here is read from the running service, so it is
 * either true or visibly unavailable — a settings screen that lies is worse than
 * no settings screen.
 *
 * Read-only on purpose. These are deployment-time values: the model, the token
 * budget, the similarity threshold. Editing them from a browser would mean the
 * running configuration and the configuration file disagreeing, and the answer
 * to "why did this proposal get flagged?" becoming unknowable after the fact.
 */

const SERVICE_META: Record<string, { label: string; icon: React.ElementType; note: string }> = {
  database: {
    label: 'Database',
    icon: Database,
    note: 'Holds every proposal, evaluation and approval. A hard dependency.',
  },
  storage: {
    label: 'Document storage',
    icon: HardDrive,
    note: 'The original files. Without it an uploaded idea has no source to show.',
  },
  llm: {
    label: 'Language model',
    icon: Cpu,
    note: 'Only evaluation needs it. Ingestion and review keep working without it.',
  },
  ocr: {
    label: 'OCR',
    icon: ScanText,
    note: 'Optional. Without it, scanned PDFs and images cannot be read.',
  },
};

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['system'],
    queryFn: systemApi.info,
    refetchInterval: 30_000,
  });

  return (
    <AppLayout>
      <PageHeader
        title="System"
        description="How this instance is configured, and whether its dependencies are up. Values are read from the running service."
        actions={
          <Button
            variant="outline"
            size="sm"
            icon={RefreshCw}
            loading={isFetching}
            onClick={() => refetch()}
          >
            Refresh
          </Button>
        }
      />

      {isLoading || !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* ---------------------------------------------------- Services */}
          <Section title="Dependencies" icon={Activity} className="lg:col-span-2" bodyClassName="p-0">
            <div className="divide-y divide-border">
              {Object.entries(data.services).map(([key, value]) => {
                const meta = SERVICE_META[key] ?? {
                  label: key,
                  icon: CircuitBoard,
                  note: '',
                };
                const Icon = meta.icon;
                const healthy = value === 'connected' || value === 'ok' || value === 'available';

                return (
                  <div key={key} className="flex items-start gap-3 px-4 py-3">
                    <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-text">{meta.label}</span>
                        <Badge tone={healthy ? 'success' : 'danger'} size="sm">
                          {value}
                        </Badge>
                      </div>
                      {meta.note && (
                        <p className="mt-0.5 text-xs text-text-muted">{meta.note}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* -------------------------------------------------- Evaluation */}
          <Section title="Evaluation" icon={Cpu}>
            <dl className="space-y-2.5 text-sm">
              <Row label="Scoring model" value={data.evaluation.model} mono />
              <Row
                label="Metadata model"
                value={data.evaluation.fast_model}
                mono
                hint="Ingestion runs on the small model — a fraction of the cost, and it frees token budget for the judgment agents."
              />
              <Row
                label="Token budget"
                value={`${data.evaluation.tokens_per_minute.toLocaleString()} / min`}
                hint="The binding constraint on how fast an evaluation can run."
              />
              <Row label="Concurrent agent calls" value={data.evaluation.max_concurrency} />
              <Row label="Retries before giving up" value={data.evaluation.max_retries} />
              <Row
                label="API key"
                value={
                  <Badge tone={data.evaluation.api_key_configured ? 'success' : 'danger'} size="sm">
                    {data.evaluation.api_key_configured ? 'Configured' : 'Missing'}
                  </Badge>
                }
                hint="Held server-side. It is never sent to the browser."
              />
            </dl>
          </Section>

          {/* ---------------------------------------------- Duplicate gate */}
          <Section title="Duplicate gate" icon={Copy}>
            <dl className="space-y-2.5 text-sm">
              <Row
                label="Similarity threshold"
                value={data.duplicate_gate.similarity_threshold}
                hint="Above this, two ideas are shown side by side for a ruling. Set low on purpose: a false positive costs one glance, a false negative funds the same idea twice."
              />
              <Row
                label="Candidates considered"
                value={data.duplicate_gate.candidates_considered}
              />
              <Row label="Embedding model" value={data.duplicate_gate.embedding_model} mono />
            </dl>
          </Section>

          {/* --------------------------------------------------- Ingestion */}
          <Section title="Ingestion" icon={FileInput}>
            <dl className="space-y-2.5 text-sm">
              <Row label="Maximum file size" value={`${data.ingestion.max_file_size_mb} MB`} />
              <Row
                label="OCR"
                value={
                  <Badge tone={data.ingestion.ocr_enabled ? 'success' : 'neutral'} size="sm">
                    {data.ingestion.ocr_enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                }
              />
              <div>
                <dt className="text-text-secondary">Accepted formats</dt>
                <dd className="mt-1.5 flex flex-wrap gap-1">
                  {data.ingestion.supported_formats.map((format) => (
                    <Badge key={format} size="sm" tone="neutral">
                      {format}
                    </Badge>
                  ))}
                </dd>
              </div>
            </dl>
          </Section>

          {/* ------------------------------------------------------ Worker */}
          <Section title="Background worker" icon={Activity}>
            <p className="mb-3 text-xs leading-relaxed text-text-muted">
              Extraction and evaluation run on the server, from a queue held in the
              database. Uploads keep processing after you close this tab, and work
              interrupted by a restart is picked up again rather than lost.
            </p>
            <dl className="space-y-2.5 text-sm">
              <Row
                label="Status"
                value={
                  <Badge tone={data.worker.enabled ? 'success' : 'warning'} size="sm">
                    {data.worker.enabled ? 'Running' : 'Disabled'}
                  </Badge>
                }
              />
              <Row
                label="Ingest slots"
                value={data.worker.ingest_slots}
                hint="Reserved, so extraction is never queued behind a long evaluation."
              />
              <Row label="General slots" value={data.worker.evaluate_slots} />
              <Row label="Jobs in flight" value={data.queue.pending} />
            </dl>
          </Section>

          {/* ----------------------------------------------------- Account */}
          <Section title="Your account" icon={User}>
            <dl className="space-y-2.5 text-sm">
              <Row label="Name" value={user?.name ?? '—'} />
              <Row label="Email" value={user?.email ?? '—'} />
              <Row
                label="Role"
                value={
                  <Badge tone={user?.role === 'ADMIN' ? 'accent' : 'neutral'} size="sm" icon={ShieldCheck}>
                    {user?.role ?? '—'}
                  </Badge>
                }
                hint={
                  user?.role === 'ADMIN'
                    ? 'You can resolve duplicate reviews, rule ideas duplicates, and record approvals.'
                    : 'You can upload, process, retry and read everything. Decisions are reserved to administrators.'
                }
              />
              <Row label="Environment" value={data.environment} />
            </dl>
            <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs leading-relaxed text-text-muted">
              Accounts are seeded server-side. This is an internal console — anyone
              who could sign themselves up would be able to read every proposal and
              every funding decision.
            </p>
          </Section>
        </div>
      )}
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------

function Row({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <dt className="text-text-secondary">{label}</dt>
        {hint && <p className="mt-0.5 max-w-md text-xs leading-relaxed text-text-muted">{hint}</p>}
      </div>
      <dd
        className={`flex-shrink-0 font-medium text-text ${mono ? 'font-mono text-xs' : 'tabular-nums'}`}
      >
        {value}
      </dd>
    </div>
  );
}
