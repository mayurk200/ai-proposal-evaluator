import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Building2,
  Copy,
  Cpu,
  FolderTree,
  Gauge,
  GitBranch,
  Quote,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge, Skeleton } from '@/components/ui';
import { PageHeader, SegmentedControl, Section, Tabs } from '@/components/ui/page';
import { Table, TD, TH, THead, TR } from '@/components/ui/data';
import { EmptyState } from '@/components/domain';
import { analyticsApi } from '@/services/agrieval.service';
import { formatCompact, scoreTextClass } from '@/utils';

/**
 * Analytics, split by the question being asked.
 *
 * The page used to answer only one of them — who was approved, in which
 * category, when. Useful, and the client asked for it, but it says nothing
 * about the thing an operator deals with daily: what is stuck, how the scoring
 * came out, and what it cost. Those are different questions with different
 * truth sources (an append-only decision ledger vs. the current state of the
 * pipeline), so they get different tabs rather than being interleaved.
 */

// Distinct enough to tell apart, muted enough to sit behind the data.
const SERIES = ['#10a37f', '#6366f1', '#d97706', '#dc2626', '#0891b2', '#7c3aed', '#65a30d', '#db2777'];

// Green through amber to red, matching the score thresholds used everywhere
// else. A histogram whose colours disagree with the badges is worse than a
// monochrome one.
const BAND_COLOURS: Record<string, string> = {
  '0-40': '#dc2626',
  '40-55': '#ea580c',
  '55-70': '#d97706',
  '70-85': '#10a37f',
  '85-100': '#059669',
};

type TabKey = 'approvals' | 'scores' | 'pipeline';

export default function AnalyticsPage() {
  const [tab, setTab] = useState<TabKey>('approvals');
  const [groupBy, setGroupBy] = useState<'category' | 'company'>('category');

  const { data: overview, isLoading } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: analyticsApi.overview,
  });

  const { data: timeline } = useQuery({
    queryKey: ['analytics', 'timeline', groupBy],
    queryFn: () => analyticsApi.timeline(groupBy),
    enabled: tab === 'approvals',
  });

  const { data: scores } = useQuery({
    queryKey: ['analytics', 'scores'],
    queryFn: analyticsApi.scores,
    enabled: tab === 'scores',
  });

  const { data: throughput } = useQuery({
    queryKey: ['analytics', 'throughput'],
    queryFn: () => analyticsApi.throughput(12),
    enabled: tab === 'pipeline',
  });

  const { data: operations } = useQuery({
    queryKey: ['analytics', 'operations'],
    queryFn: analyticsApi.operations,
    enabled: tab === 'pipeline',
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <AppLayout>
        <Skeleton className="h-96 rounded-xl" />
      </AppLayout>
    );
  }

  const categories = overview?.by_category ?? [];
  const companies = overview?.by_company ?? [];

  // Pivot the flat timeline rows into one row per period with a column per
  // series — the shape a multi-line chart needs.
  const periods = [...new Set((timeline ?? []).map((p) => p.period))].sort();
  const seriesNames = [
    ...new Set(
      (timeline ?? []).map((p) => (groupBy === 'category' ? p.category : p.company) ?? '—'),
    ),
  ];
  const timelineData = periods.map((period) => {
    const row: Record<string, string | number> = { period };
    seriesNames.forEach((name) => {
      row[name] = (timeline ?? [])
        .filter(
          (p) =>
            p.period === period &&
            ((groupBy === 'category' ? p.category : p.company) ?? '—') === name,
        )
        .reduce((sum, p) => sum + p.approved_count, 0);
    });
    return row;
  });

  return (
    <AppLayout>
      <PageHeader
        title="Analytics"
        description="Where funding has gone, how the scoring came out, and what the pipeline is costing."
      />

      <Tabs
        className="mb-4"
        active={tab}
        onChange={(key) => setTab(key as TabKey)}
        items={[
          { key: 'approvals', label: 'Approvals', icon: FolderTree },
          { key: 'scores', label: 'Scoring', icon: Gauge },
          { key: 'pipeline', label: 'Pipeline & cost', icon: GitBranch },
        ]}
      />

      {/* ======================================================= Approvals */}
      {tab === 'approvals' && (
        <div className="space-y-4">
          <p className="text-xs text-text-muted">
            Counts reflect approvals — a rejected idea appears nowhere here. History is
            append-only: an idea approved in March and defunded in June still counts as a
            March approval, because that is what happened.
          </p>

          {/* ---------------------------------------------------------- (d) */}
          <Section title="Approvals by category" icon={FolderTree}>
            {categories.length === 0 ? (
              <EmptyState
                icon={FolderTree}
                title="No approvals yet"
                description="Categories are discovered from the ideas themselves — nothing is predefined, so this list grows as proposals arrive."
              />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={Math.max(220, categories.length * 34)}>
                  <BarChart data={categories} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid horizontal={false} stroke="#f0f0ee" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 11 }} />
                    <Tooltip cursor={{ fill: '#f7f7f5' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="approved_count" name="Approved" radius={[0, 4, 4, 0]}>
                      {categories.map((entry) => (
                        <Cell
                          key={entry.category_id}
                          fill={entry.approved_count > 1 ? '#d97706' : '#10a37f'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="mt-2 text-[11px] text-text-muted">
                  Amber marks a category holding more than one approved idea — the
                  concentration this system exists to help you avoid.
                </p>
              </>
            )}
          </Section>

          {/* ---------------------------------------------------------- (e) */}
          <Section title="Approvals by company" icon={Building2} bodyClassName="p-0">
            {companies.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={Building2} title="No approvals yet" />
              </div>
            ) : (
              <>
                <Table>
                  <THead>
                    <tr>
                      <TH className="w-full">Company</TH>
                      <TH align="center">Approved</TH>
                      <TH align="center">Categories</TH>
                      <TH>Flag</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {companies.map((company) => (
                      <TR key={company.company_id}>
                        <TD className="w-full font-medium text-text">{company.name}</TD>
                        <TD align="center" className="tabular-nums">
                          {company.approved_count}
                        </TD>
                        <TD align="center" className="tabular-nums">
                          {company.categories_spanned}
                        </TD>
                        <TD>
                          {company.multi_category && (
                            <Badge tone="warning" icon={AlertTriangle}>
                              Winning across domains
                            </Badge>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
                <p className="border-t border-border px-4 py-2.5 text-[11px] text-text-muted">
                  Companies are matched on a normalised name, so “Acme Agri Pvt. Ltd.” and
                  “ACME AGRI” count as one — otherwise the same firm could quietly take a
                  slot in every section.
                </p>
              </>
            )}
          </Section>

          {/* ---------------------------------------------------------- (f) */}
          <Section
            title="Approvals over time"
            icon={TrendingUp}
            actions={
              <SegmentedControl
                options={[
                  { value: 'category', label: 'By category' },
                  { value: 'company', label: 'By company' },
                ]}
                value={groupBy}
                onChange={setGroupBy}
              />
            }
          >
            {timelineData.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="No approval history yet"
                description="Each approval is recorded against the year and month it happened in, and stays there even if the idea is recategorised later."
              />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={timelineData} margin={{ left: -18, right: 8 }}>
                  <CartesianGrid stroke="#f0f0ee" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {seriesNames.map((name, i) => (
                    <Line
                      key={name}
                      type="monotone"
                      dataKey={name}
                      stroke={SERIES[i % SERIES.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </Section>
        </div>
      )}

      {/* ========================================================= Scoring */}
      {tab === 'scores' && (
        <div className="space-y-4">
          {!scores || scores.distribution.scored === 0 ? (
            <EmptyState
              icon={Gauge}
              title="Nothing scored yet"
              description="Score analytics appear once proposals have been evaluated."
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Evaluated" value={scores.distribution.scored} />
                <Stat
                  label="Median score"
                  value={scores.distribution.median?.toFixed(1) ?? '—'}
                  className={scoreTextClass(scores.distribution.median)}
                  hint="The middle proposal. Less swayed by one outlier than the mean."
                />
                <Stat
                  label="Mean score"
                  value={scores.distribution.average?.toFixed(1) ?? '—'}
                  className={scoreTextClass(scores.distribution.average)}
                />
                <Stat
                  label="Range"
                  value={`${scores.distribution.lowest?.toFixed(0)}–${scores.distribution.highest?.toFixed(0)}`}
                />
              </div>

              <Section
                title="Score distribution"
                icon={Gauge}
                description="The shape matters more than the average: a mean of 62 could be everything at 62, or half at 30 and half at 94 — two portfolios calling for opposite decisions."
              >
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={scores.distribution.bands} margin={{ left: -20, right: 8 }}>
                    <CartesianGrid vertical={false} stroke="#f0f0ee" />
                    <XAxis dataKey="band" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip cursor={{ fill: '#f7f7f5' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="count" name="Proposals" radius={[4, 4, 0, 0]}>
                      {scores.distribution.bands.map((entry) => (
                        <Cell key={entry.band} fill={BAND_COLOURS[entry.band] ?? '#94a3b8'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Section>

              <div className="grid gap-4 lg:grid-cols-2">
                <Section title="Recommendations" icon={Quote} bodyClassName="p-0">
                  <div className="divide-y divide-border">
                    {scores.distribution.by_recommendation.map((row) => (
                      <div
                        key={row.recommendation}
                        className="flex items-center justify-between px-4 py-2.5"
                      >
                        <span className="text-[13px] text-text">{row.recommendation}</span>
                        <span className="text-sm font-semibold tabular-nums text-text">
                          {row.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section
                  title="Average score by category"
                  icon={FolderTree}
                  description="What approval counts cannot tell you: is one approval per category quality, or policy?"
                  bodyClassName="p-0"
                >
                  {scores.by_category.length === 0 ? (
                    <div className="p-4 text-[13px] text-text-muted">
                      No categories with scored proposals yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {scores.by_category.map((row) => (
                        <div key={row.category_id} className="flex items-center gap-3 px-4 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] text-text">{row.label}</p>
                            <p className="text-xs text-text-muted">
                              {row.evaluated_count} evaluated · range {row.lowest?.toFixed(0)}–
                              {row.highest?.toFixed(0)}
                            </p>
                          </div>
                          <span
                            className={`text-sm font-semibold tabular-nums ${scoreTextClass(
                              row.average_score,
                            )}`}
                          >
                            {row.average_score?.toFixed(1)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </div>

              <Section
                title="Highest scoring, no decision recorded"
                icon={Gauge}
                description="A worklist, not a leaderboard — these are assessed, strong, and still waiting on a call."
                bodyClassName="p-0"
              >
                {scores.top_undecided.length === 0 ? (
                  <div className="p-4 text-[13px] text-text-muted">
                    Every scored idea has a decision recorded against it.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {scores.top_undecided.map((item) => (
                      <Link
                        key={item.proposal_id}
                        to={`/proposals/${item.proposal_id}`}
                        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-gray-50"
                      >
                        <span
                          className={`w-10 flex-shrink-0 text-sm font-semibold tabular-nums ${scoreTextClass(
                            item.score,
                          )}`}
                        >
                          {item.score.toFixed(0)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-text">{item.title}</p>
                          <p className="truncate text-xs text-text-muted">
                            {item.category ?? 'Uncategorised'}
                            {item.recommendation && ` · ${item.recommendation}`}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}
        </div>
      )}

      {/* ================================================ Pipeline & cost */}
      {tab === 'pipeline' && (
        <div className="space-y-4">
          <Section
            title="Where every idea currently sits"
            icon={GitBranch}
            description="The whole archive, by lifecycle stage. Includes the two counts nobody wants and everybody needs: waiting on a human, and failed."
          >
            <div className="space-y-1.5">
              {(overview?.pipeline ?? [])
                .filter((stage) => stage.count > 0)
                .map((stage) => {
                  const total = overview?.totals.total || 1;
                  const percent = (stage.count / total) * 100;
                  const isProblem = stage.key === 'failed';
                  const isBlocked = stage.key === 'pending_review';

                  return (
                    <div key={stage.key} className="flex items-center gap-3">
                      <span className="w-48 flex-shrink-0 text-xs text-text-secondary">
                        {stage.label}
                      </span>
                      <div className="h-5 flex-1 overflow-hidden rounded bg-gray-100">
                        <div
                          className={`h-full rounded transition-all ${
                            isProblem
                              ? 'bg-red-500'
                              : isBlocked
                                ? 'bg-amber-500'
                                : stage.key === 'evaluated'
                                  ? 'bg-emerald-500'
                                  : 'bg-primary'
                          }`}
                          style={{ width: `${Math.max(percent, 2)}%` }}
                        />
                      </div>
                      <span className="w-16 flex-shrink-0 text-right text-xs font-medium tabular-nums text-text">
                        {stage.count.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
            </div>
          </Section>

          <Section
            title="Received vs scored"
            icon={TrendingUp}
            description="The gap between the two lines is the backlog. A gap that grows every month is the thing to notice early rather than discover at a deadline."
          >
            {!throughput?.length ? (
              <EmptyState icon={TrendingUp} title="Not enough history yet" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={throughput} margin={{ left: -20, right: 8 }}>
                  <CartesianGrid stroke="#f0f0ee" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area
                    type="monotone"
                    dataKey="received"
                    name="Received"
                    stroke="#6366f1"
                    fill="#6366f1"
                    fillOpacity={0.12}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="evaluated"
                    name="Evaluated"
                    stroke="#10a37f"
                    fill="#10a37f"
                    fillOpacity={0.12}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Section>

          {operations && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Section title="Cost and reliability" icon={Cpu}>
                <dl className="space-y-2.5 text-[13px]">
                  <OpRow
                    label="Evaluations completed"
                    value={operations.operations.evaluations_completed.toLocaleString()}
                  />
                  <OpRow
                    label="Tokens spent"
                    value={formatCompact(operations.operations.total_tokens)}
                    hint="Across every completed evaluation"
                  />
                  <OpRow
                    label="Average per evaluation"
                    value={`${formatCompact(
                      operations.operations.average_tokens_per_evaluation,
                    )} tokens · ${operations.operations.average_seconds_per_evaluation}s`}
                  />
                  <OpRow
                    label="Average evidence coverage"
                    value={
                      operations.operations.average_evidence_coverage !== null
                        ? `${(operations.operations.average_evidence_coverage * 100).toFixed(0)}%`
                        : '—'
                    }
                    hint="Share of sub-questions proposals actually answer. A low figure says more about the submissions than about the system."
                  />
                  <OpRow label="Model" value={operations.operations.model ?? '—'} />
                </dl>

                {operations.operations.failures_by_stage.length > 0 && (
                  <div className="mt-4 border-t border-border pt-3">
                    <p className="mb-2 text-xs font-medium text-text-secondary">
                      Failures by stage
                    </p>
                    {/* Grouped, because "extraction keeps failing" and "the LLM
                        keeps timing out" are different problems with different
                        fixes, and one total hides both. */}
                    <div className="space-y-1">
                      {operations.operations.failures_by_stage.map((row) => (
                        <div
                          key={row.stage}
                          className="flex items-center justify-between rounded bg-red-50 px-2.5 py-1.5"
                        >
                          <span className="text-xs capitalize text-red-800">{row.stage}</span>
                          <span className="text-xs font-semibold tabular-nums text-red-800">
                            {row.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Section>

              <Section
                title="The duplicate gate"
                icon={Copy}
                description="Ingestion costs one small LLM call; an evaluation costs tens of thousands of tokens. Every idea correctly ruled a duplicate is an evaluation not paid for."
              >
                <dl className="space-y-2.5 text-[13px]">
                  <OpRow
                    label="Flagged by the gate"
                    value={operations.duplicates.flagged_by_gate}
                    hint="Ideas the embedding found a near-neighbour for"
                  />
                  <OpRow
                    label="Confirmed duplicates"
                    value={operations.duplicates.confirmed_duplicates}
                  />
                  <OpRow
                    label="Dismissed as distinct"
                    value={operations.duplicates.dismissed_as_distinct}
                    hint="A human looked and disagreed with the machine — the gate is advisory."
                  />
                  <OpRow
                    label="Awaiting a ruling"
                    value={operations.duplicates.awaiting_review}
                  />
                </dl>

                {operations.duplicates.estimated_tokens_saved !== null && (
                  <div className="mt-4 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5">
                    <Zap className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                    <div>
                      <p className="text-[13px] font-semibold text-emerald-900">
                        ~{formatCompact(operations.duplicates.estimated_tokens_saved)} tokens
                        not spent
                      </p>
                      <p className="mt-0.5 text-xs text-emerald-800/80">
                        Estimated from this system's own average cost per evaluation, not a
                        published figure.
                      </p>
                    </div>
                  </div>
                )}
              </Section>
            </div>
          )}
        </div>
      )}
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3.5 shadow-card" title={hint}>
      <p className="text-xs text-text-muted">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums text-text ${className ?? ''}`}>
        {value}
      </p>
    </div>
  );
}

function OpRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <div className="min-w-0">
        <dt className="text-text-secondary">{label}</dt>
        {hint && <p className="mt-0.5 max-w-sm text-xs leading-relaxed text-text-muted">{hint}</p>}
      </div>
      <dd className="flex-shrink-0 font-medium tabular-nums text-text">{value}</dd>
    </div>
  );
}
