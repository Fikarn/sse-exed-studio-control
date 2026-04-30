import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Toast, type ToastAction, type ToastTone } from "@sse/design-system";

import styles from "./toastStack.module.css";

interface ToastEntry {
  id: number;
  tone: ToastTone;
  message: string;
  title?: string;
  action?: ToastAction;
}

export interface ToastInput {
  tone: ToastTone;
  message: string;
  title?: string;
  /** Inline action button (typically "Undo"). Click also dismisses the toast. */
  action?: ToastAction;
  /** Override auto-dismiss timing. Defaults: ok/info 3.5 s, error sticky. */
  durationMs?: number;
}

export interface ToastApi {
  /** Push a toast. Returns the id so the caller can dismiss it manually. */
  push: (toast: ToastInput) => number;
  /** Dismiss a specific toast by id. */
  dismiss: (id: number) => void;
  /** Dismiss every toast. Used on workspace switch / unmount. */
  clear: () => void;
}

const DEFAULT_DURATION_MS: Record<ToastTone, number | null> = {
  ok: 3500,
  info: 3500,
  error: null, // sticky until manual dismiss
};

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Wraps the app and exposes `useToast()`. Renders a bottom-right portal that
 * stacks up to a small number of toasts; tones drive auto-dismiss timing.
 *
 * Replaces the legacy per-workspace top-slide `feedback` banner. Workspaces
 * call `useToast().push({ tone, message, action? })`; the action button
 * (typically "Undo") clicks the provided handler then dismisses the toast.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);
  const idCounterRef = useRef(0);
  // Track auto-dismiss timers so dismiss() can clear them and we don't fire
  // stale setState after unmount.
  const timersRef = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      idCounterRef.current += 1;
      const id = idCounterRef.current;
      const entry: ToastEntry = {
        id,
        tone: input.tone,
        message: input.message,
        title: input.title,
        action: input.action,
      };
      setToasts((prev) => [...prev, entry]);
      const duration = input.durationMs ?? DEFAULT_DURATION_MS[input.tone];
      if (duration !== null) {
        const timer = window.setTimeout(() => {
          dismiss(id);
        }, duration);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismiss]
  );

  const clear = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
    setToasts([]);
  }, []);

  // Clear all timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ push, dismiss, clear }), [clear, dismiss, push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== "undefined"
        ? createPortal(
            <div className={styles.stack} role="region" aria-label="Notifications" aria-live="polite">
              {toasts.map((toast) => (
                <Toast
                  key={toast.id}
                  tone={toast.tone}
                  title={toast.title}
                  message={toast.message}
                  action={
                    toast.action
                      ? {
                          label: toast.action.label,
                          onClick: () => {
                            toast.action?.onClick();
                            dismiss(toast.id);
                          },
                        }
                      : undefined
                  }
                  onDismiss={() => dismiss(toast.id)}
                />
              ))}
            </div>,
            document.body
          )
        : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}
