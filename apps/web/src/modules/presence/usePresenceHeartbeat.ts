"use client";

import { useEffect } from "react";
import { callMutation } from "../../lib/api-client";

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Presence & Status (module 4 of 6). Mounted once, at the top of
 * `workspace/layout.tsx` — deliberately uses the raw `callMutation` from
 * `lib/api-client.ts`, not the `useRenderContext()` version, since this hook
 * needs to run before `RenderContextProvider` exists in that tree (same
 * reason `loadBootstrap`/`prefetchPage` there call the raw `api-client`
 * functions directly rather than going through render-context).
 *
 * Gated on the Page Visibility API so a backgrounded tab stops ticking —
 * heartbeat cadence has no fallback/retry: a missed tick just means
 * `lastSeenAt` ages a little further before the next one, which is exactly
 * what "away" is for, not an error condition.
 */
export function usePresenceHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    function tick() {
      if (document.visibilityState !== "visible") return;
      callMutation("presence.heartbeat", {}).catch(() => {
        // Best-effort, same as NotificationBell's own poll-failure handling —
        // a transient network blip just skips this tick.
      });
    }

    tick();
    const interval = setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled]);
}
