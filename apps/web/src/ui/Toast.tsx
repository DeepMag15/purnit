"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { cn } from "./utils";

type Tone = "success" | "danger" | "info" | "warning";

interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

interface ToastContextValue {
  show: (message: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_BORDER: Record<Tone, string> = {
  success: "border-success/30",
  danger: "border-danger/30",
  info: "border-info/30",
  warning: "border-warning/30",
};

const TONE_ICON: Record<Tone, { name: string; className: string }> = {
  success: { name: "check_circle", className: "text-success" },
  danger: { name: "cancel", className: "text-danger" },
  info: { name: "info", className: "text-info" },
  warning: { name: "warning", className: "text-warning" },
};

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, tone: Tone = "success") => {
    const id = ++nextId;
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 3500);
  }, []);

  function dismiss(id: number) {
    setToasts((current) => current.filter((t) => t.id !== id));
  }

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "flex items-center gap-2 rounded-lg border bg-surface px-3.5 py-2.5 text-sm text-text shadow-lg transition-all duration-[var(--duration-base)]",
              TONE_BORDER[t.tone],
            )}
          >
            <Icon name={TONE_ICON[t.tone].name} size={16} className={cn(TONE_ICON[t.tone].className, "shrink-0")} />
            <span>{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} className="ml-2 text-text-muted hover:text-text">
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() called outside a ToastProvider");
  return ctx;
}
