import React from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/utils';
import { Button } from '@/components/ui';

/**
 * Toasts and confirmation.
 *
 * Both exist for the same reason: work moved to a background queue, so the
 * screen no longer changes the instant you click. Queueing forty evaluations
 * used to be indistinguishable from clicking a dead button — the list looks the
 * same either way for the first few seconds. A toast is the acknowledgement.
 */

// ===========================================================================
// Toast
// ===========================================================================

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return context;
}

const TONE_META: Record<ToastTone, { icon: React.ElementType; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-emerald-600' },
  error: { icon: XCircle, className: 'text-red-600' },
  warning: { icon: AlertTriangle, className: 'text-amber-600' },
  info: { icon: Info, className: 'text-blue-600' },
};

// Errors stay until dismissed. A failure that vanishes after four seconds is a
// failure the operator will not have read.
const AUTO_DISMISS_MS: Record<ToastTone, number | null> = {
  success: 4000,
  info: 4000,
  warning: 8000,
  error: null,
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (input: Omit<Toast, 'id'>) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...input, id }]);

      const timeout = AUTO_DISMISS_MS[input.tone];
      if (timeout) setTimeout(() => dismiss(id), timeout);
    },
    [dismiss],
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast({ tone: 'success', title, description }),
      error: (title, description) => toast({ tone: 'error', title, description }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        // aria-live so a screen reader announces the outcome of an action whose
        // only other evidence is a list that will refresh in fifteen seconds.
        aria-live="polite"
        className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((item) => {
          const meta = TONE_META[item.tone];
          const Icon = meta.icon;

          return (
            <div
              key={item.id}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-surface p-3 shadow-elevated"
            >
              <Icon className={cn('mt-0.5 h-4 w-4 flex-shrink-0', meta.className)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text">{item.title}</p>
                {item.description && (
                  <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
                    {item.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => dismiss(item.id)}
                title="Dismiss"
                className="rounded p-1 text-text-muted hover:bg-gray-100 hover:text-text"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

// ===========================================================================
// Modal
// ===========================================================================

export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'sm' | 'md' | 'lg';
}> = ({ open, onClose, title, description, children, footer, width = 'sm' }) => {
  // Escape closes. A dialog you can only leave by finding the right button is a
  // trap, and this one can appear over a destructive action.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative w-full rounded-xl border border-border bg-surface shadow-elevated',
          widths[width],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-text">{title}</h2>
            {description && (
              <p className="mt-1 text-[13px] leading-relaxed text-text-muted">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            title="Close"
            className="rounded-lg p-1 text-text-muted hover:bg-gray-100 hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {children && <div className="px-5 py-4">{children}</div>}

        {footer && (
          <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
};

/**
 * Confirmation for an action that is hard to take back.
 *
 * Used sparingly and deliberately: a confirm on every button trains people to
 * dismiss them without reading, which is worse than having none. This is for
 * deletes and for bulk actions, where the cost of a misclick scales with the
 * selection.
 */
export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}> = ({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'primary',
  loading,
  onConfirm,
  onCancel,
  children,
}) => (
  <Modal open={open} onClose={onCancel} title={title} description={description}>
    {children}
    <div className="mt-4 flex justify-end gap-2">
      <Button variant="outline" onClick={onCancel} disabled={loading}>
        Cancel
      </Button>
      <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
        {confirmLabel}
      </Button>
    </div>
  </Modal>
);
