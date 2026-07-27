import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/utils';

/**
 * Page furniture: headers, back navigation, sections, tabs.
 *
 * The back link is the reason this file exists. Every detail view in this app
 * was reachable and then unreachable-from: you clicked a proposal and the only
 * way out was the sidebar, which drops you at a different page than the one you
 * came from — a filtered, sorted, paginated list you would then have to rebuild
 * by hand.
 */

/**
 * Go back to where you came from.
 *
 * Prefers real history, because that preserves the list's filters, sort and
 * page. `fallback` is for the cases where there is no history to go back to: a
 * link pasted into chat, a bookmark, a fresh tab. Checking `idx > 0`
 * distinguishes the two — without it, a deep link would call back() and leave
 * the user on whatever site they were on before.
 */
export const BackLink: React.FC<{ to: string; label?: string; className?: string }> = ({
  to,
  label = 'Back',
  className,
}) => {
  const navigate = useNavigate();

  const goBack = () => {
    const hasHistory =
      typeof window !== 'undefined' && (window.history.state?.idx ?? 0) > 0;
    if (hasHistory) navigate(-1);
    else navigate(to);
  };

  return (
    <button
      onClick={goBack}
      className={cn(
        'group -ml-1 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium',
        'text-text-muted transition-colors hover:bg-gray-100 hover:text-text',
        className,
      )}
    >
      <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
      {label}
    </button>
  );
};

export const PageHeader: React.FC<{
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Rendered above the title. Use <BackLink> here on any detail view. */
  back?: React.ReactNode;
  /** Badges and status chips, inline with the title. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}> = ({ title, description, back, meta, actions, className }) => (
  <header className={cn('mb-5', className)}>
    {back && <div className="mb-2">{back}</div>}

    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
          {meta}
        </div>
        {description && (
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-text-muted">
            {description}
          </p>
        )}
      </div>

      {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  </header>
);

/** A titled block of content. Consistent heading weight everywhere. */
export const Section: React.FC<{
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ElementType;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}> = ({ title, description, icon: Icon, actions, children, className, bodyClassName }) => (
  <section className={cn('rounded-xl border border-border bg-surface shadow-card', className)}>
    {(title || actions) && (
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
            {Icon && <Icon className="h-4 w-4 text-text-muted" />}
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
    )}
    <div className={cn('p-4', bodyClassName)}>{children}</div>
  </section>
);

export interface TabItem {
  key: string;
  label: string;
  icon?: React.ElementType;
  /** A count shown next to the label. Zero renders nothing rather than "0". */
  count?: number;
}

export const Tabs: React.FC<{
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}> = ({ items, active, onChange, className }) => (
  <div className={cn('flex gap-1 overflow-x-auto border-b border-border', className)} role="tablist">
    {items.map((item) => {
      const isActive = item.key === active;
      const Icon = item.icon;

      return (
        <button
          key={item.key}
          role="tab"
          aria-selected={isActive}
          onClick={() => onChange(item.key)}
          className={cn(
            'flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
            isActive
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted hover:border-border-strong hover:text-text',
          )}
        >
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {item.label}
          {item.count ? (
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                isActive ? 'bg-accent-light text-primary-dark' : 'bg-gray-100 text-text-muted',
              )}
            >
              {item.count}
            </span>
          ) : null}
        </button>
      );
    })}
  </div>
);

/**
 * A segmented control for small, mutually exclusive choices.
 *
 * Distinct from Tabs: tabs switch what you are looking at, this switches how the
 * same thing is presented (group by category vs company, and so on).
 */
export const SegmentedControl = <T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: Array<{ value: T; label: string; icon?: React.ElementType }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) => (
  <div className={cn('inline-flex gap-0.5 rounded-lg bg-gray-100 p-0.5', className)}>
    {options.map((option) => {
      const Icon = option.icon;
      const isActive = option.value === value;

      return (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          aria-pressed={isActive}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-xs font-medium transition-colors',
            isActive
              ? 'bg-white text-text shadow-sm'
              : 'text-text-muted hover:text-text-secondary',
          )}
        >
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {option.label}
        </button>
      );
    })}
  </div>
);
