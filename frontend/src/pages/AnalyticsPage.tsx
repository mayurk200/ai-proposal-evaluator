import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, Building2, FolderTree, TrendingUp } from 'lucide-react';
import {
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
import { Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/domain';
import { analyticsApi } from '@/services/agrieval.service';

// A categorical palette for the timeline series. Distinct enough to tell apart, muted
// enough to sit behind the data.
const SERIES_COLOURS = [
  '#10a37f', '#6366f1', '#d97706', '#dc2626',
  '#0891b2', '#7c3aed', '#65a30d', '#db2777',
];

export default function AnalyticsPage() {
  const [groupBy, setGroupBy] = useState<'category' | 'company'>('category');

  const { data: overview, isLoading } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: analyticsApi.overview,
  });

  const { data: timeline } = useQuery({
    queryKey: ['analytics', 'timeline', groupBy],
    queryFn: () => analyticsApi.timeline(groupBy),
  });

  // Pivot the flat timeline rows into one row per period with a column per series, which
  // is the shape a multi-line chart needs.
  const periods = [...new Set((timeline ?? []).map((p) => p.period))].sort();
  const seriesNames = [
    ...new Set(
      (timeline ?? []).map((p) => (groupBy === 'category' ? p.category : p.company) ?? '—'),
    ),
  ];
  const timelineData = periods.map((period) => {
    const row: Record<string, string | number> = { period };
    seriesNames.forEach((name) => {
      row[name] =
        (timeline ?? [])
          .filter(
            (p) =>
              p.period === period &&
              ((groupBy === 'category' ? p.category : p.company) ?? '—') === name,
          )
          .reduce((sum, p) => sum + p.approved_count, 0) || 0;
    });
    return row;
  });

  if (isLoading) {
    return (
      <AppLayout>
        <Skeleton className="h-96 rounded-2xl" />
      </AppLayout>
    );
  }

  const categories = overview?.by_category ?? [];
  const companies = overview?.by_company ?? [];

  return (
    <AppLayout>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-text">Approval analytics</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          Where funding has gone, to whom, and when. Counts reflect approvals — a rejected
          idea appears nowhere here.
        </p>
      </header>

      {/* -------------------------------------------------------------- (d) */}
      <section className="glass-card-static mb-5 rounded-2xl p-5">
        <header className="mb-4 flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-text-secondary" />
          <h2 className="text-sm font-semibold text-text">Approvals by category</h2>
        </header>

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
      </section>

      {/* -------------------------------------------------------------- (e) */}
      <section className="glass-card-static mb-5 rounded-2xl p-5">
        <header className="mb-4 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-text-secondary" />
          <h2 className="text-sm font-semibold text-text">Approvals by company</h2>
        </header>

        {companies.length === 0 ? (
          <EmptyState icon={Building2} title="No approvals yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted">
                  <th className="pb-2 font-medium">Company</th>
                  <th className="pb-2 text-center font-medium">Approved</th>
                  <th className="pb-2 text-center font-medium">Categories</th>
                  <th className="pb-2 font-medium">Flag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {companies.map((company) => (
                  <tr key={company.company_id}>
                    <td className="py-2.5 font-medium text-text">{company.name}</td>
                    <td className="py-2.5 text-center tabular-nums">
                      {company.approved_count}
                    </td>
                    <td className="py-2.5 text-center tabular-nums">
                      {company.categories_spanned}
                    </td>
                    <td className="py-2.5">
                      {company.multi_category && (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          <AlertTriangle className="h-3 w-3" />
                          Winning across domains
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] text-text-muted">
              Companies are matched on a normalised name, so “Acme Agri Pvt. Ltd.” and
              “ACME AGRI” count as one company — otherwise the same firm could quietly take
              a slot in every section.
            </p>
          </div>
        )}
      </section>

      {/* -------------------------------------------------------------- (f) */}
      <section className="glass-card-static rounded-2xl p-5">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-text-secondary" />
            <h2 className="text-sm font-semibold text-text">Approvals over time</h2>
          </div>

          <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
            {(['category', 'company'] as const).map((option) => (
              <button
                key={option}
                onClick={() => setGroupBy(option)}
                className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  groupBy === option
                    ? 'bg-white text-text shadow-sm'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                by {option}
              </button>
            ))}
          </div>
        </header>

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
                  stroke={SERIES_COLOURS[i % SERIES_COLOURS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      <p className="mt-5 text-center text-xs text-text-muted">
        Looking for something to act on?{' '}
        <Link to="/review" className="text-primary hover:underline">
          Duplicate review queue
        </Link>
      </p>
    </AppLayout>
  );
}
