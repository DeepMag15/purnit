#!/usr/bin/env node
// Recreates this project's two Supabase Storage buckets against whichever
// project SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY currently point at — local
// or cloud, same script. Both buckets were originally created via one-off
// scripts (run once, then deleted, per this project's own throwaway-script
// convention — see CONTEXT.md) with no reusable version checked in; this is
// that reusable version, safe to rerun (idempotent).
//
// Mirrors apps/api/src/auth/supabase-admin.service.ts's own documented
// finding: createBucket()'s fileSizeLimit/allowedMimeTypes options have been
// observed to silently fail to persist against the Storage API — always
// followed by updateBucket(), regardless of whether the bucket already
// existed, matching that established pattern exactly.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../.env") });

const BUCKETS = [
  {
    id: "logos",
    public: true,
    fileSizeLimit: "2MB",
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
  },
  {
    id: "documents",
    public: false,
    fileSizeLimit: "25MB",
    allowedMimeTypes: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
      "text/csv",
      "application/zip",
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ],
  },
];

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (check .env) before creating Storage buckets.");
  }

  const client = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  for (const bucket of BUCKETS) {
    const { public: isPublic, fileSizeLimit, allowedMimeTypes, id } = bucket;
    const { error: createError } = await client.storage.createBucket(id, { public: isPublic, fileSizeLimit, allowedMimeTypes });
    if (createError && !/already exists/i.test(createError.message)) {
      throw new Error(`Failed to create bucket "${id}": ${createError.message}`);
    }

    // Always run, new or existing — see the doc comment above.
    const { error: updateError } = await client.storage.updateBucket(id, { public: isPublic, fileSizeLimit, allowedMimeTypes });
    if (updateError) {
      throw new Error(`Failed to configure bucket "${id}": ${updateError.message}`);
    }

    const { data: verify, error: verifyError } = await client.storage.getBucket(id);
    if (verifyError || !verify) {
      throw new Error(`Failed to verify bucket "${id}": ${verifyError?.message}`);
    }
    console.log(`✔ Bucket "${id}" ready (public=${verify.public}, fileSizeLimit=${verify.file_size_limit}, mimeTypes=${verify.allowed_mime_types?.length ?? 0})`);
  }
}

main().catch((err) => {
  console.error("✖ Storage bucket setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
