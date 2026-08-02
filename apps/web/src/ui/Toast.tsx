"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { cn } from "./utils";

interface ToastItem {
  id: number;
  message: string;
  tone: "success" | "danger";
}

interface ToastContextValue {
  show: (message: string, tone?: "success" | "danger") => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, tone: "success" | "danger" = "success") => {
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
              "flex items-center gap-2 rounded-lg border bg-surface px-3.5 py-2.5 text-sm shadow-lg transition-all duration-200",
              t.tone === "success" ? "border-success/30 text-text" : "border-danger/30 text-text",
            )}
          >
            {t.tone === "success" ? (
              <Icon name="check_circle" size={16} className="text-success shrink-0" />
            ) : (
              <Icon name="cancel" size={16} className="text-danger shrink-0" />
            )}
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
