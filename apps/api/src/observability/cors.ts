import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";

/**
 * Go-Live, Phase 04 — CORS, from wide-open to an explicit allowlist.
 *
 * `app.enableCors()` with no arguments reflects *any* origin. That was fine
 * while the only client was localhost, and is not fine once a real deployment
 * exists: any website a logged-in user visits could call the API from their
 * browser. Bearer-token auth means an attacker's page still cannot read the
 * user's token, so this is not the sole line of defence — but there is no
 * reason to leave it open.
 *
 * `CORS_ALLOWED_ORIGINS` is a comma-separated list of exact origins.
 *
 * **Local development is deliberately left permissive** when the variable is
 * unset: requiring every contributor to configure an allowlist before the app
 * works would be friction with no security benefit on a machine only they can
 * reach. Staging and production must set it explicitly — and, because that is
 * exactly the kind of thing that gets forgotten, a non-development
 * environment with no allowlist configured refuses to fall back to
 * permissive and denies cross-origin requests instead.
 */
export function resolveCorsOptions(): { options: CorsOptions; description: string } {
  const raw = process.env.CORS_ALLOWED_ORIGINS?.trim();
  const appEnv = process.env.APP_ENV ?? "development";
  const isProduction = appEnv === "production" || appEnv === "staging";

  const origins = raw
    ? raw
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : [];

  const base: CorsOptions = {
    credentials: true,
    // The app authenticates with a bearer token, never a cookie, so this is
    // the complete set of headers a browser client actually sends.
    allowedHeaders: ["Content-Type", "Authorization", "If-None-Match"],
    // `ETag` must be exposed or the browser cannot read it back, which would
    // silently disable the manifest's 304 caching (ARCHITECTURE.md §6.7).
    exposedHeaders: ["ETag", "x-request-id"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  };

  if (origins.length > 0) {
    return { options: { ...base, origin: origins }, description: `allowlist (${origins.join(", ")})` };
  }

  if (isProduction) {
    // Fail closed. An unset allowlist in staging or production is a
    // misconfiguration, and reflecting every origin there would be a silent
    // downgrade of exactly the control this function exists to add.
    return {
      options: { ...base, origin: false },
      description: `DENIED — APP_ENV=${appEnv} but CORS_ALLOWED_ORIGINS is unset. Set it to the frontend origin(s).`,
    };
  }

  return { options: { ...base, origin: true }, description: "permissive (development default)" };
}
