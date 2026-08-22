import path from "node:path";
import { config as loadEnv } from "dotenv";

// Root .env is the single source of truth for the whole monorepo (see .env.example).
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  // `rawBody: true` — Stripe Billing's webhook handler needs the exact raw
  // request bytes to verify the Stripe signature (`stripe.webhooks.
  // constructEvent`); Nest's default body parser would otherwise consume and
  // JSON-parse the body before any controller runs. This makes `req.rawBody`
  // (a Buffer) available on every request while leaving every other route's
  // parsed `req.body` completely unaffected.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors();
  const port = process.env.PORT ?? 4000;
  await app.listen(port);
}

bootstrap();
