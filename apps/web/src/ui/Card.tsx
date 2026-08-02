import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./utils";

export function Card({ className, children, ...props }: { children?: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-surface shadow-sm", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, action }: { title?: string; action?: ReactNode }) {
  if (!title && !action) return null;
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      {title && <h3 className="text-sm font-semibold text-text">{title}</h3>}
      {action}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn("p-4", className)}>{children}</div>;
}
