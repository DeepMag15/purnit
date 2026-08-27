# Credential Rotation Runbook

**Status: NOT YET DONE — this is yours to execute.**

Three credentials were exposed (displayed in a session transcript) and have never
been rotated: the **Supabase service-role key**, the **database password**, and the
**Resend API key**.

## What is and isn't at risk

`.env` is gitignored and **was never committed** — verified with
`git log --all -- .env`, which returns nothing. So there is no git history to
rewrite and no published artifact to purge. The exposure was display-only.

That still warrants rotation: the service-role key bypasses Row-Level Security
entirely, and the DB password belongs to a role that can read every tenant's data.
But it means rotation is a clean dashboard operation with no repo surgery attached.

## Order matters

Do these **in this order**. The last one breaks the running app until `.env` is
updated, so it goes last deliberately.

### 1. Resend API key (lowest blast radius)

1. Resend dashboard → **API Keys**
2. Create a new key; copy it
3. Update `RESEND_API_KEY` in `.env`
4. Delete the old key
5. Verify: trigger any invite email (Team Members → Invite) and confirm delivery

Nothing else reads this key, so a mistake here only affects email.

### 2. Supabase service-role key

1. Supabase dashboard → **Project Settings → API → Project API keys**
2. Roll the `service_role` key
3. Update `SUPABASE_SERVICE_ROLE_KEY` in `.env`
4. Restart the API

> The `anon` key does **not** need rotating — it is designed to be public and is
> already exposed to every browser via `NEXT_PUBLIC_SUPABASE_ANON_KEY`. It is
> protected by RLS, not by secrecy.

Verify: sign up a throwaway tenant. Signup calls `SupabaseAdminService.createUser`,
which is the only path that uses the service-role key — if it succeeds, the new key
is live.

### 3. Database password (do this last — it breaks the app until step 5)

1. Supabase dashboard → **Project Settings → Database → Reset database password**
2. Copy the new password
3. Update **both** `DATABASE_URL` and `DIRECT_URL` in `.env` — they use different
   roles (`app_runtime` and the elevated migration role) but the same password reset
   applies to the project
4. Keep the Supavisor username suffix intact — it must stay
   `app_runtime.<project-ref>`, not bare `app_runtime`. Omitting the suffix fails
   with `ENOIDENTIFIER` (see `CONTEXT.md` §9)
5. Restart the API

Verify: load any workspace page. If the manifest compiles, both connections are good.

## After rotation

Tell me when this is done. It gates one thing only — provisioning the staging and
production secret stores in Phase 06 — so it does not block the billing, public
site, signup, hardening, or data-protection work.

A fresh production Supabase project is provisioned in Phase 06 anyway, with its own
new credentials from birth. So this rotation is really about closing out the **dev**
project cleanly.

## Standing rule

Never paste a real secret value into a chat, a commit, a log line, or a document.
`.env.example` carries variable **names** and non-secret placeholders only — that
rule holds for staging and production values too, not just production.
