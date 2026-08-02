import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Root .env is the single source of truth for the whole monorepo (see .env.example).
loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env") });

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Used by the CLI only (migrate, db push, studio): elevated, non-pooled, BYPASSRLS.
    // The running app never uses this — TenantPrismaService instantiates its own
    // PrismaClient via the @prisma/adapter-pg driver adapter with DATABASE_URL
    // (pooled, non-BYPASSRLS) at runtime. Prisma 7 removed the `datasourceUrl`
    // client-constructor shorthand entirely (see CONTEXT.md §9).
    url: process.env["DIRECT_URL"],
  },
});
