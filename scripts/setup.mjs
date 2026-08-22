#!/usr/bin/env node
// One-command fresh-clone setup — see docs/DEVELOPMENT.md "One-command setup"
// for the full step-by-step explanation of what each stage below does and why.
//
// NOTE: authored against the documented spec in docs/DEVELOPMENT.md but not
// yet run end-to-end against a live Docker/Supabase stack (see CHANGELOG.md
// "Standing rules" — verify infra scripts empirically before trusting them).
// If a step here turns out to not match reality, fix this file, not the
// workaround.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");
const envExamplePath = path.join(root, ".env.example");

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    shell: true,
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: capture ? "utf8" : undefined,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command} ${args.join(" ")}`);
  }
  return result.stdout;
}

function checkDocker() {
  console.log("→ Checking Docker is running...");
  const result = spawnSync("docker", ["info"], { shell: true, stdio: "ignore" });
  if (result.status !== 0) {
    throw new Error("Docker doesn't seem to be running. Start Docker Desktop, then rerun `pnpm run setup`.");
  }
}

function supabaseStart() {
  console.log("→ Starting local Supabase (Postgres/Auth/Storage/Studio)... first run downloads several GB of images, this can take a while.");
  run("pnpm", ["exec", "supabase", "start"]);
}

function pick(obj, ...candidates) {
  for (const key of candidates) {
    if (obj[key] !== undefined && obj[key] !== "") return obj[key];
  }
  throw new Error(`\`supabase status -o json\` output is missing all of: ${candidates.join(", ")}. Its field names may have changed — check \`pnpm exec supabase status -o json\` by hand and update this script.`);
}

function getSupabaseStatus() {
  console.log("→ Reading local Supabase connection info...");
  const stdout = run("pnpm", ["exec", "supabase", "status", "-o", "json"], { capture: true });
  const status = JSON.parse(stdout);
  return {
    apiUrl: pick(status, "API_URL", "api_url"),
    anonKey: pick(status, "ANON_KEY", "anon_key"),
    serviceRoleKey: pick(status, "SERVICE_ROLE_KEY", "service_role_key"),
    dbUrl: pick(status, "DB_URL", "db_url"),
  };
}

function generatePassword() {
  // base64url alphabet only (A-Za-z0-9-_) — safe to inline into both a
  // Postgres string literal and a connection-string URL with no escaping.
  return crypto.randomBytes(24).toString("base64url");
}

function buildAppRuntimeUrl(directUrl, password) {
  const url = new URL(directUrl);
  url.username = "app_runtime";
  url.password = password;
  return url.toString();
}

function loadExistingEnv() {
  if (!existsSync(envPath)) return {};
  const values = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function writeEnv(autoValues) {
  console.log("→ Writing .env (preserving any manually-set keys like API keys)...");
  const existing = loadExistingEnv();
  const template = readFileSync(envExamplePath, "utf8");
  const merged = { ...existing, ...autoValues };
  const output = template
    .split("\n")
    .map((line) => {
      const match = line.match(/^([A-Z0-9_]+)=/);
      if (!match) return line;
      const key = match[1];
      if (merged[key] === undefined) return line;
      return `${key}=${merged[key]}`;
    })
    .join("\n");
  writeFileSync(envPath, output);
}

function setAppRuntimePassword(directUrl, password) {
  console.log("→ Setting a fresh local password for the app_runtime Postgres role...");
  if (!/^[A-Za-z0-9_-]+$/.test(password)) {
    throw new Error("Generated password contains unexpected characters — refusing to inline into SQL.");
  }
  return (async () => {
    const client = new pg.Client({ connectionString: directUrl });
    await client.connect();
    try {
      await client.query(`ALTER ROLE app_runtime WITH PASSWORD '${password}'`);
    } finally {
      await client.end();
    }
  })();
}

function prismaDeploy() {
  console.log("→ Applying database migrations (prisma migrate deploy + generate)...");
  run("pnpm", ["--filter", "@purnit/api", "run", "prisma:deploy"]);
}

function createStorageBuckets() {
  console.log("→ Creating Storage buckets...");
  run("node", ["scripts/create-storage-buckets.mjs"]);
}

function seed() {
  console.log("→ Seeding the IT industry blueprint...");
  run("pnpm", ["--filter", "@purnit/api", "run", "prisma:seed"]);
}

async function main() {
  checkDocker();
  supabaseStart();
  const status = getSupabaseStatus();
  const password = generatePassword();
  const databaseUrl = buildAppRuntimeUrl(status.dbUrl, password);

  writeEnv({
    SUPABASE_URL: status.apiUrl,
    SUPABASE_ANON_KEY: status.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: status.serviceRoleKey,
    DATABASE_URL: databaseUrl,
    DIRECT_URL: status.dbUrl,
    JWT_ISSUER: `${status.apiUrl}/auth/v1`,
    NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.anonKey,
  });

  // Must run after prismaDeploy(): the app_runtime role is created by that
  // migration, so it doesn't exist yet the first time this script ever runs.
  prismaDeploy();
  await setAppRuntimePassword(status.dbUrl, password);
  createStorageBuckets();
  seed();

  console.log(`
✔ Setup complete. In two separate terminals:

  pnpm dev:api   # http://localhost:4000
  pnpm dev:web   # http://localhost:3000

Then sign up a new workspace at http://localhost:3000/signup.
`);
}

main().catch((err) => {
  console.error("✖ Setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
