import * as Sentry from "@sentry/nextjs";

/**
 * Go-Live, Phase 04 — server-side error tracking for the Next.js app.
 *
 * Next.js calls `register()` once per runtime before any application code
 * runs. Split by runtime because the Node and Edge SDKs are not
 * interchangeable.
 *
 * **Inert without `NEXT_PUBLIC_SENTRY_DSN`** — `Sentry.init` is never called,
 * so local development and CI behave exactly as before and no network calls
 * are made. Same discipline as the API's own observability/sentry.ts.
 */
export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  const common = {
    dsn,
    environment: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
    tracesSampleRate: process.env.NEXT_PUBLIC_APP_ENV === "production" ? 0.1 : 1.0,
    // Off deliberately: this would attach request headers and cookies, which
    // on this app means bearer tokens landing in a third-party service.
    sendDefaultPii: false,
  };

  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init(common);
  } else if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init(common);
  }
}

/** Next.js routes server-side render errors here so they reach Sentry with
 * their request context attached. */
export const onRequestError = Sentry.captureRequestError;
