"use client";

import { createContext, useContext } from "react";
import type { WorkspaceManifest } from "@purnit/manifest-schema";

export interface BootstrapContextValue {
  manifest: WorkspaceManifest;
}

const BootstrapContext = createContext<BootstrapContextValue | null>(null);

export const BootstrapContextProvider = BootstrapContext.Provider;

export function useBootstrap(): BootstrapContextValue {
  const ctx = useContext(BootstrapContext);
  if (!ctx) throw new Error("useBootstrap() called outside the workspace layout");
  return ctx;
}
