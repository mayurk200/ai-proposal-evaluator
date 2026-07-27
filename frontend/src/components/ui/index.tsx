import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils';

/**
 * The primitives everything else is built from.
 *
 * One rule runs through all of them: a control's *appearance* states what it
 * does. Primary is the one action this screen exists for and there is at most
 * one per view; danger destroys something; outline and ghost are everything
 * else. Previously every affirmative button was the same filled green, so
 * "Evaluate the batch" and "Export PDF" carried identical visual weight and the
 * screen gave no guidance at all about which one mattered.
 *
 * Sizes are fixed heights rather than padding guesses, so a button, a select and
 * an input sitting on one toolbar row line up instead of nearly lining up.
 */

// ===========================================================================
// Button
// ===========================================================================

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'danger-soft';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-white shadow-sm hover:bg-primary-dark active:bg-primary-dark border border-transparent',
  secondary:
    'bg-accent-light text-primary-dark hover:bg-accent border border-transparent',
  outline:
    'bg-white text-text-secondary border border-border-strong hover:bg-gray-50 hover:text-text',
  ghost: 'bg-transparent text-text-secondary hover:bg-gray-100 hover:text-text border border-transparent',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 border border-transparent',
  'danger-soft': 'bg-white text-red-600 border border-red-200 hover:bg-red-50',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-sm gap-2 rounded-xl',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Rendered before the label. Pass the component, not an element. */
  icon?: React.ElementType;
  /** Square, icon-only. `title` becomes the accessible name. */
  iconOnly?: boolean;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading,
      icon: Icon,
      iconOnly,
      fullWidth,
      children,
      disabled,
      title,
      ...props
    },
    ref,
  ) => {
    // Icon-only buttons keep their height but lose horizontal padding, so a row
    // of them reads as one control strip rather than as scattered squares.
    const iconOnlyWidth = {
      xs: 'w-7 px-0',
      sm: 'w-8 px-0',
      md: 'w-9 px-0',
      lg: 'w-11 px-0',
    }[size];

    return (
      <button
        ref={ref}
        type={props.type ?? 'button'}
        title={title}
        aria-label={iconOnly ? title : undefined}
        aria-busy={loading || undefined}
        className={cn(
          'inline-flex items-center justify-center font-medium whitespace-nowrap',
          'transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1',
          'disabled:opacity-45 disabled:pointer-events-none',
          BUTTON_SIZES[size],
          BUTTON_VARIANTS[variant],
          iconOnly && iconOnlyWidth,
          fullWidth && 'w-full',
          className,
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          Icon && <Icon className={size === 'xs' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        )}
        {!iconOnly && children}
      </button>
    );
  },
);
Button.displayName = 'Button';

/** An icon-only button. `title` is required — an unlabelled icon is a guess. */
export const IconButton = React.forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'iconOnly' | 'children'> & { title: string }
>((props, ref) => <Button ref={ref} iconOnly variant={props.variant ?? 'ghost'} {...props} />);
IconButton.displayName = 'IconButton';

// ===========================================================================
// Form controls
// ===========================================================================

const FIELD_BASE =
  'w-full rounded-lg border border-border-strong bg-white text-sm text-text ' +
  'placeholder:text-text-muted transition-colors ' +
  'focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 ' +
  'disabled:bg-gray-50 disabled:text-text-muted';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: React.ElementType;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, icon: Icon, id, ...props }, ref) => (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-[13px] font-medium text-text">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        )}
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          className={cn(
            FIELD_BASE,
            'h-9 px-3',
            Icon && 'pl-9',
            error && 'border-red-300 focus:border-red-400 focus:ring-red-100',
            className,
          )}
          {...props}
        />
      </div>
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : (
        hint && <p className="text-xs text-text-muted">{hint}</p>
      )}
    </div>
  ),
);
Input.displayName = 'Input';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

/**
 * A styled native select.
 *
 * Native on purpose: it is keyboard-accessible, works on touch, and does not
 * trap focus — none of which a hand-rolled dropdown gets for free, and none of
 * which is worth re-implementing for a filter control.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, id, children, ...props }, ref) => (
    <div className={label ? 'space-y-1.5' : undefined}>
      {label && (
        <label htmlFor={id} className="block text-[13px] font-medium text-text">
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={id}
        className={cn(
          FIELD_BASE,
          'h-9 cursor-pointer appearance-none bg-no-repeat py-0 pl-3 pr-8',
          className,
        )}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundPosition: 'right 0.6rem center',
        }}
        {...props}
      >
        {children}
      </select>
    </div>
  ),
);
Select.displayName = 'Select';

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Some-but-not-all selected. Set on the header checkbox of a partial page. */
  indeterminate?: boolean;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate, ...props }, ref) => {
    const inner = React.useRef<HTMLInputElement | null>(null);

    // `indeterminate` has no HTML attribute — it exists only as a DOM property,
    // so it has to be assigned after render.
    React.useEffect(() => {
      if (inner.current) inner.current.indeterminate = Boolean(indeterminate);
    }, [indeterminate]);

    return (
      <input
        type="checkbox"
        ref={(node) => {
          inner.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        className={cn(
          'h-4 w-4 cursor-pointer rounded border-border-strong text-primary',
          'accent-[var(--color-primary)] focus:ring-2 focus:ring-primary/25',
          className,
        )}
        {...props}
      />
    );
  },
);
Checkbox.displayName = 'Checkbox';

// ===========================================================================
// Surfaces
// ===========================================================================

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Adds a hover affordance. Only for cards that are actually clickable. */
  interactive?: boolean;
  padded?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, padded = true, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border border-border bg-surface shadow-card',
        padded && 'p-5',
        interactive && 'cursor-pointer transition-shadow hover:shadow-card-hover',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

// ===========================================================================
// Status
// ===========================================================================

export type BadgeTone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'accent';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-gray-100 text-gray-700 ring-gray-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-blue-50 text-blue-700 ring-blue-200',
  accent: 'bg-violet-50 text-violet-700 ring-violet-200',
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: React.ElementType;
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  tone = 'neutral',
  icon: Icon,
  size = 'md',
  children,
  ...props
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 rounded-md font-medium ring-1 ring-inset whitespace-nowrap',
      size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-xs',
      BADGE_TONES[tone],
      className,
    )}
    {...props}
  >
    {Icon && <Icon className="h-3 w-3" />}
    {children}
  </span>
);

// ===========================================================================
// Loading
// ===========================================================================

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('skeleton', className)} />
);

export const Spinner: React.FC<{ className?: string }> = ({ className }) => (
  <Loader2 className={cn('h-4 w-4 animate-spin text-text-muted', className)} />
);

interface ProgressProps {
  value: number;
  max?: number;
  className?: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
}

export const Progress: React.FC<ProgressProps> = ({
  value,
  max = 100,
  className,
  tone = 'primary',
}) => {
  const tones = {
    primary: 'bg-primary',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
  };
  const percent = max > 0 ? Math.min((value / max) * 100, 100) : 0;

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-gray-100', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', tones[tone])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
};

// ===========================================================================
// Text
// ===========================================================================

/**
 * Clamp long prose to N lines with a Show more toggle.
 *
 * Used wherever the model's output lands on screen. A generated summary can run
 * to several hundred words, and the honest fix is neither to truncate it (the
 * detail is sometimes the point) nor to dump it all (nobody reads it) — it is to
 * show the first few lines and let the reader ask for the rest.
 */
export const Clamp: React.FC<{
  children: React.ReactNode;
  lines?: number;
  className?: string;
  moreLabel?: string;
}> = ({ children, lines = 3, className, moreLabel = 'Show more' }) => {
  const [expanded, setExpanded] = React.useState(false);
  const [clampable, setClampable] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Only offer the toggle if the content is actually longer than the clamp.
  React.useLayoutEffect(() => {
    const node = ref.current;
    if (node) setClampable(node.scrollHeight > node.clientHeight + 4);
  }, [children, lines]);

  return (
    <div className={className}>
      <div
        ref={ref}
        style={
          expanded
            ? undefined
            : {
                display: '-webkit-box',
                WebkitLineClamp: lines,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }
        }
      >
        {children}
      </div>
      {(clampable || expanded) && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? 'Show less' : moreLabel}
        </button>
      )}
    </div>
  );
};
