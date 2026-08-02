"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { WorkspaceManifest } from "@antigravity/manifest-schema";
import { callDataSource, callMutation } from "../lib/api-client";

export interface RenderContextValue {
  /** Backing store for `{{user.x}}` interpolation and `{ ref: "user.x" }` bindings. */
  user: WorkspaceManifest["user"];
  tenant: WorkspaceManifest["tenant"];
  callDataSource: typeof callDataSource;
  callMutation: typeof callMutation;
  navigate: (pageId: string) => void;
  /** Re-fetches the whole workspace bootstrap manifest — nav labels,
   * tenant branding, everything shell-level, not just one node's `bind`.
   * Needed the first time by Settings (renaming a nav item / changing the
   * accent color changes data that lives in the shell, not in any page's
   * content, so a per-node `useDataBinding().refetch()` can't reach it). */
  refetchBootstrap: () => void;
  /** Opens the global AI Assistant panel — from any `aiPrompt` action
   * (any module, any page) or the header's persistent "Ask AI" trigger
   * (no preset/context, an unscoped conversation). Phase B (Documents RAG)
   * is the first real consumer: `preset` is `"documents.summarize"` or
   * `"documents.qa"`, `context` is `{sourceType: "document", sourceId}`. */
  openAiPanel: (preset?: string, context?: unknown) => void;
  /** Mirrors the manifest's `aiAvailable` flag — modules that add their own
   * AI entry points (e.g. DocumentsPanel's per-row "Summarize"/"Ask AI"
   * buttons) gate on this rather than reaching into the manifest directly,
   * same as every other render-context-derived value. */
  aiAvailable: boolean;
}

const RenderContext = createContext<RenderContextValue | null>(null);

export function RenderContextProvider({
  value,
  children,
}: {
  value: RenderContextValue;
  children: ReactNode;
}) {
  return <RenderContext.Provider value={value}>{children}</RenderContext.Provider>;
}

export function useRenderContext(): RenderContextValue {
  const ctx = useContext(RenderContext);
  if (!ctx) throw new Error("useRenderContext() called outside a RenderContextProvider");
  return ctx;
}
