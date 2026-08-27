"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Go-Live, Phase 04 — the last-resort error boundary.
 *
 * Next.js renders this when an error escapes every other boundary, replacing
 * the entire document — which is why it has to supply its own `<html>` and
 * `<body>`, and why it cannot use the root layout's providers.
 *
 * Two jobs. First, report: a crash this severe is exactly what error tracking
 * exists for, and without this hook a total client-side failure would leave no
 * trace anywhere. Second, degrade honestly — the app already has per-node
 * error boundaries so one bad widget never blanks the workspace
 * (ARCHITECTURE.md §7.5); this only fires when something has gone wrong well
 * above that level.
 *
 * The colours are inlined rather than taken from tokens because globals.css
 * may not have applied at this point, and an error screen that renders black
 * text on a black background is worse than an unstyled one.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          background: "#17181a",
          color: "#ececeb",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ maxWidth: "26rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ marginTop: "0.75rem", fontSize: "0.875rem", lineHeight: 1.6, color: "#93959a" }}>
            The page failed to load. Trying again usually fixes it — if it doesn&rsquo;t, the problem is on our side and we&rsquo;ve been
            notified.
          </p>
          {/* The digest is Next.js's own correlation id for the server-side
           * error. Showing it lets a user quote something that maps to a real
           * log entry, instead of describing the symptom. */}
          {error.digest && (
            <p style={{ marginTop: "0.75rem", fontFamily: "ui-monospace, monospace", fontSize: "0.75rem", color: "#93959a" }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              height: "2.5rem",
              padding: "0 1.25rem",
              borderRadius: "0.375rem",
              border: "none",
              background: "#4f9eef",
              color: "#ffffff",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
