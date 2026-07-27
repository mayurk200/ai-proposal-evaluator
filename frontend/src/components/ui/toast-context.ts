import { createContext, useContext } from 'react';

/**
 * The toast context, separated from the provider component.
 *
 * Not an aesthetic split: React Fast Refresh can only hot-reload a module whose
 * exports are all components. A hook exported alongside `<ToastProvider>` makes
 * every edit to a toast style a full page reload, which loses whatever state you
 * were mid-way through testing.
 */

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

export interface ToastContextValue {
  toast: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return context;
}
