import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// Root .env is the single source of truth for the whole monorepo (see
// .env.example). Next.js only reads its own app-local .env files by
// default, so load the root one explicitly, same pattern as
// apps/api/prisma.config.ts and apps/api/src/main.ts.
loadEnv({ path: path.resolve(__dirname, "../../.env") });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@purnit/manifest-schema"],
};

export default nextConfig;
