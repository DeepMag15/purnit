import path from "node:path";
import { config as loadEnv } from "dotenv";

// Root .env is the single source of truth for the whole monorepo (see .env.example).
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

// Go-Live, Phase 04 — Sentry must be initialised before anything else is
// imported, so its instrumentation can wrap the modules it needs to. Inert
// when SENTRY_DSN is unset, so local dev and CI are unaffected.
import "./observability/sentry";

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { resolveCorsOptions } from "./observability/cors";

async function bootstrap() {
  const logger = new Logger("Bootstrap");

  // `rawBody: true` — Stripe Billing's webhook handler needs the exact raw
  // request bytes to verify the Stripe signature (`stripe.webhooks.
  // constructEvent`); Nest's default body parser would otherwise consume and
  // JSON-parse the body before any controller runs. This makes `req.rawBody`
  // (a Buffer) available on every request while leaving every other route's
  // parsed `req.body` completely unaffected.
  // Typed as the Express application specifically so `set("trust proxy", …)`
  // below is reachable — it is an Express setting, not part of the
  // platform-agnostic Nest interface.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // ⚠️ Go-Live, Phase 04 — load-bearing for rate limiting, not a nicety.
  // Vercel, Render and Railway all sit behind a proxy, so without this every
  // request arrives with the proxy's address and `req.ip` is identical for
  // the entire internet. A per-IP limit would then throttle all anonymous
  // traffic to a shared 10/min budget — effectively a self-inflicted denial
  // of service. `1` trusts exactly one hop (the platform's own load
  // balancer); trusting more would let a client spoof `X-Forwarded-For` and
  // bypass the limit entirely.
  app.set("trust proxy", 1);

  // Was `app.enableCors()` — wide open to every origin. Now an explicit
  // per-environment allowlist; see resolveCorsOptions for why local dev is
  // deliberately still permissive.
  const cors = resolveCorsOptions();
  app.enableCors(cors.options);
  logger.log(`CORS: ${cors.description}`);

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  logger.log(`API listening on ${port} (env: ${process.env.APP_ENV ?? "development"})`);
}

bootstrap();
