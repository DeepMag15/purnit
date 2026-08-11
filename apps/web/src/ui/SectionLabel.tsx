import type { ReactNode } from "react";
import { cn } from "./utils";

/** Visual Polish & Consistency Pass — extracted from `RolesPermissionsWorkspace.tsx`,
 * which repeated this exact class string literally 5 times across its own
 * file. A small, muted, uppercase group-label convention (module names,
 * subsection headers) distinct from `Card`'s own `text-sm font-semibold`
 * title scale and `PageHeader`/`DetailPageShell`'s larger page-title scale. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-xs font-semibold uppercase tracking-wide text-text-muted", className)}>{children}</div>;
}
