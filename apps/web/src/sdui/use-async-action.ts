"use client";

import { useState } from "react";

/**
 * Replaces the `creating`/`createError`/`try-catch-finally` boilerplate
 * duplicated 17 times across module composites. Never rethrows — this hook
 * fully owns the error, matching how every existing handler's own `catch`
 * block already fully handles the failure itself. Supports both existing
 * call-site shapes found in research: read `error` directly for an inline
 * `<Alert>` (the `createError`-style forms), or pass `onError` to push into
 * `useToast()` instead (the `handleStatusChange`-style handlers).
 */
export function useAsyncAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>, options?: { onError?: (message: string) => void }) {
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      options?.onError?.(message);
    } finally {
      setPending(false);
    }
  }

  return { pending, error, run, clearError: () => setError(null) };
}
