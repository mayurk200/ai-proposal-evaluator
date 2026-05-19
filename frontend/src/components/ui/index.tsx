import React from 'react';
import { cn } from '@/utils';

// ===== Button =====
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, children, disabled, ...props }, ref) => {
    const variants = {
      primary: 'btn-primary',
      secondary: 'btn-secondary',
      ghost: 'bg-transparent text-text-secondary hover:bg-accent-light rounded-xl transition-colors',
      danger: 'bg-red-500 text-white hover:bg-red-600 rounded-xl shadow-sm transition-colors font-semibold',
    };

    const sizes = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-5 py-2.5 text-sm',
      lg: 'px-8 py-3.5 text-base',
    };

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none',
          variants[variant],
          sizes[size],
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';

// ===== Input =====
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={id} className="block text-sm font-medium text-text">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={cn(
            'w-full px-4 py-2.5 rounded-xl border bg-white/80 backdrop-blur-sm text-sm',
            'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
            'placeholder:text-text-muted transition-all duration-200',
            error ? 'border-red-300 focus:ring-red-200' : 'border-border',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';

// ===== Card =====
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, hover = true, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(hover ? 'glass-card' : 'glass-card-static', 'p-6', className)}
      {...props}
    />
  )
);
Card.displayName = 'Card';

// ===== Badge =====
interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

export const Badge: React.FC<BadgeProps> = ({ className, variant = 'default', ...props }) => {
  const variants = {
    default: 'bg-gray-100 text-gray-700',
    success: 'bg-green-100 text-green-700',
    warning: 'bg-yellow-100 text-yellow-700',
    danger: 'bg-red-100 text-red-700',
    info: 'bg-blue-100 text-blue-700',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium',
        variants[variant],
        className
      )}
      {...props}
    />
  );
};

// ===== Skeleton =====
export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('skeleton', className)} />
);

// ===== Progress =====
interface ProgressProps {
  value: number;
  max?: number;
  className?: string;
  color?: string;
}

export const Progress: React.FC<ProgressProps> = ({ value, max = 100, className, color }) => (
  <div className={cn('w-full h-2 bg-gray-100 rounded-full overflow-hidden', className)}>
    <div
      className={cn('h-full rounded-full transition-all duration-700 ease-out', color || 'gradient-primary')}
      style={{ width: `${Math.min((value / max) * 100, 100)}%` }}
    />
  </div>
);

// ===== ScoreBadge =====
export const ScoreBadge: React.FC<{ score: number; size?: 'sm' | 'md' | 'lg' }> = ({ score, size = 'md' }) => {
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-lg',
  };

  const bgClass = score >= 80 ? 'score-high' : score >= 60 ? 'score-medium' : 'score-low';

  return (
    <div className={cn('score-badge', sizeClasses[size], bgClass)}>
      {Math.round(score)}
    </div>
  );
};
