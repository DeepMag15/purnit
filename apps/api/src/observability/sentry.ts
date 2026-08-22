import * as Sentry from "@sentry/nestjs";

/**
 * Go-Live, Phase 04 — error tracking.
 *
 * Imported for its side effect at the very top of `main.ts`, before any
 * application module, because Sentry's auto-instrumentation has to wrap
 * modules as they are first required.
 *
 * **Completely inert without `SENTRY_DSN`** — `Sentry.init` is never called,
 * so local development and CI behave exactly as before and no network calls
 * are made. That matters more than it sounds: an observability tool that
 * changes behaviour when unconfigured is a liability, and this project has
 * already been bitten once by an eagerly-constructed client (Stripe's SDK
 * threw on an empty key and took down the whole API at boot).
 */
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Tagging by environment is what lets one free-tier Sentry project serve
    // staging and production without their events being confused for each
    // other — the approved plan's cost decision depends on this.
    environment: process.env.APP_ENV ?? "development",

    // A sample of traces, not all of them. Performance data is useful for
    // finding slow endpoints, but at 100% it exhausts the free tier's event
    // budget within days of real traffic and buries the actual errors.
    tracesSampleRate: process.env.APP_ENV === "production" ? 0.1 : 1.0,

    // ⚠️ Off deliberately, and it should stay off. `sendDefaultPii` attaches
    // request headers, cookies and bodies to every event — which for this app
    // means bearer tokens and tenant data landing in a third-party service.
    // The `beforeSend` scrub below is a second line of defence, not the
    // primary one.
    sendDefaultPii: false,

    beforeSend(event) {
      // Belt and braces: strip anything that could carry a credential even if
      // a future SDK default, integration, or manual capture would otherwise
      // include it. Cheap to run, and the failure mode it prevents (a
      // long-lived token sitting in an error report) is expensive and silent.
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          for (const header of ["authorization", "cookie", "stripe-signature", "x-api-key"]) {
            delete event.request.headers[header];
          }
        }
        // Query strings are a common accidental home for tokens.
        delete event.request.query_string;
      }
      return event;
    },
  });
}

/** Whether error reporting is actually active. Mirrors the
 * `StripeService.isConfigured()` / `AiProviderService` precedent — a
 * capability the rest of the app can check rather than assume. */
export function isSentryConfigured(): boolean {
  return !!dsn;
}
