"use client";

import { useEffect, useState } from "react";
import { JitsiMeeting } from "@jitsi/react-sdk";

interface Props {
  roomName: string;
  token: string;
  onLeave: () => void;
}

const JITSI_DOMAIN = process.env.NEXT_PUBLIC_JITSI_DOMAIN!;
// @jitsi/react-sdk's own default is "https" — only overridden here because
// this project's local dev Jitsi deliberately runs plain HTTP (see
// infra/jitsi/README.md's networking note). A real hosted vendor later sets
// this to "https" via env, no code change.
const JITSI_PROTOCOL = process.env.NEXT_PUBLIC_JITSI_PROTOCOL || "https";

function getLoadedExternalApi(): unknown {
  return (window as unknown as { JitsiMeetExternalAPI?: unknown }).JitsiMeetExternalAPI;
}

/**
 * @jitsi/react-sdk's own external_api.js loader (lib/init.js) hardcodes
 * `https://${domain}/external_api.js` with no way to override the scheme —
 * confirmed by reading its source, not assumed. This project's local dev
 * Jitsi runs plain HTTP (infra/jitsi/README.md), so that hardcoded `https://`
 * request fails outright (nothing listens for TLS on :8000) — this is what
 * broke the Meetings module: `JitsiMeeting` never got a chance to load at
 * all. Its loader checks `window.JitsiMeetExternalAPI` FIRST and skips its
 * own fetch entirely if already present, so preloading the script ourselves
 * with the correct protocol, before `JitsiMeeting` ever mounts, is a clean,
 * minimal workaround rather than dropping `@jitsi/react-sdk` altogether.
 */
function preloadExternalApi(): Promise<void> {
  if (getLoadedExternalApi()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${JITSI_PROTOCOL}://${JITSI_DOMAIN}/external_api.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Couldn't load the Jitsi client from ${script.src}`));
    document.head.appendChild(script);
  });
}

/**
 * A plain shared component, not a registered SDUI primitive — mirrors
 * `CommentThread.tsx`'s "internal component, mounted directly" precedent: a
 * video call frame has no meaningful config-driven shape a blueprint node
 * could express. `@jitsi/react-sdk`'s `JitsiMeeting` wraps Jitsi's
 * prebuilt-UI iframe — no custom call UI is built here, deliberately (out
 * of scope for v1, unchanged from the Daily.co-era decision). Renders a
 * brief loading/error state until `preloadExternalApi` resolves — `JitsiMeeting`
 * is never mounted before then, avoiding a race between its own load check
 * and our preload.
 */
export function JitsiCallFrame({ roomName, token, onLeave }: Props) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    preloadExternalApi()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load the video call");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <div className="flex h-full w-full items-center justify-center text-sm text-danger">{error}</div>;
  }
  if (!ready) {
    return <div className="flex h-full w-full items-center justify-center text-sm text-text-muted">Loading call…</div>;
  }

  return (
    <JitsiMeeting
      domain={JITSI_DOMAIN}
      roomName={roomName}
      jwt={token}
      onReadyToClose={onLeave}
      getIFrameRef={(parentNode) => {
        parentNode.style.height = "100%";
        parentNode.style.width = "100%";
      }}
    />
  );
}
