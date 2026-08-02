import path from "node:path";
import { config as loadEnv } from "dotenv";

// Root .env is the single source of truth for the whole monorepo (see .env.example).
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = process.env.PORT ?? 4000;
  await app.listen(port);
}

bootstrap();
