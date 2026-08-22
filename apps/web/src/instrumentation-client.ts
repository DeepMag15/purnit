import * as Sentry from "@sentry/nextjs";

/**
 * Go-Live, Phase 04 — browser-side error tracking.
 *
 * Next.js loads this before any client code runs. Catches render errors and
 * unhandled promise rejections that never reach the server, which is most of
 * what actually breaks for a user in a heavily client-rendered app like this
 * one.
 *
 * **Inert without `NEXT_PUBLIC_SENTRY_DSN`.** Deliberately no session replay
 * and no `sendDefaultPii`: replay records the DOM, and this app's DOM is
 * full of tenant data — patient names, salaries, invoices. That is not
 * something to ship into a third-party service by default.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
    tracesSampleRate: process.env.NEXT_PUBLIC_APP_ENV === "production" ? 0.1 : 1.0,
    sendDefaultPii: false,

    beforeSend(event) {
      // The auth token lives in browser storage; make sure no breadcrumb or
      // request snapshot carries it out. Cheap, and the failure it prevents
      // is silent and long-lived.
      if (event.request?.headers) delete event.request.headers.Authorization;
      delete event.request?.cookies;
      return event;
    },
  });
}

/** Required by Next.js to report client-side navigation spans. Harmless when
 * Sentry was never initialised. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
