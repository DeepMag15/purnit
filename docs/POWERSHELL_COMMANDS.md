# Running Purnit — PowerShell Command Reference

Quick reference for running this project from PowerShell on Windows. For the full setup guide (fresh clone, local Supabase via Docker, migrations, etc.) see [DEVELOPMENT.md](DEVELOPMENT.md) — this file is just the commands you'll actually type day to day.

All commands assume your current directory is the repo root (`d:\Purnit`).

## One-time setup (already done on this machine)

These only need to run once per machine, or after a `git pull` that changes dependencies. Skip straight to [Running the app](#running-the-app) if you've already done this before.

```powershell
pnpm install
```
Installs every package's dependencies (`apps/api`, `apps/web`, `packages/manifest-schema`) in one pass, using the pinned versions in `pnpm-lock.yaml`. Volta auto-switches to the pinned Node/pnpm versions the moment you `cd` into this folder — nothing to run for that.

```powershell
pnpm run setup
```
Only needed on a **fresh clone** with no `.env` yet, or after a `prisma migrate reset`. Brings up the local Supabase stack via Docker, applies every migration, seeds the IT blueprint, and creates Storage buckets. This machine already has a real `.env` pointing at a live Supabase project, so you don't normally need this — see `DEVELOPMENT.md` if you ever do.

## Running the app

The API and the web frontend are two separate long-running processes — run each in **its own PowerShell window/tab**, since both need to stay running at the same time.

**Window 1 — backend:**
```powershell
pnpm dev:api
```
Starts the NestJS API in watch mode (auto-restarts on file changes) at `http://localhost:4000`. Leave this running.

**Window 2 — frontend:**
```powershell
pnpm dev:web
```
Starts the Next.js dev server at `http://localhost:3000`. Leave this running too.

Once both are up, open **http://localhost:3000** in a browser to use the app. Press `Ctrl+C` in either window to stop that process.

## Verification commands

Run these from the repo root — each checks the *whole* monorepo (all three packages) in one pass.

```powershell
pnpm run typecheck
```
Runs `tsc --noEmit` in every package — catches type errors without producing build output. Fast, safe to run often.

```powershell
pnpm run lint
```
Runs ESLint across `apps/api`, `apps/web`, and `packages/manifest-schema`.

```powershell
pnpm run test
```
Runs the test suites for every package that has one (Jest for `apps/api`, Vitest for `apps/web`). If it's slow or flaky, run one package at a time instead:
```powershell
pnpm --filter @antigravity/api run test
pnpm --filter @antigravity/web run test
```

```powershell
pnpm run build
```
Production build for every package (`nest build` for the API, `next build` for the web app). This is what CI runs — good final check before committing.

## Database (Prisma) commands

These operate on whichever database `DATABASE_URL`/`DIRECT_URL` in your `.env` currently point at.

```powershell
pnpm --filter @antigravity/api exec prisma studio
```
Opens Prisma Studio — a browser-based GUI for browsing/editing the database directly. Handy for inspecting data without writing SQL.

```powershell
pnpm --filter @antigravity/api run prisma:seed
```
Re-runs `prisma/seed.ts` — re-materializes the IT blueprint and re-syncs every existing tenant's role permissions to match it. **Run this after any change to `seed.ts`** (new nav items, new permission triples, etc.) so real tenants actually pick up the change — otherwise the change only exists in the blueprint definition, not in any tenant's already-materialized `Role.permissions`.

```powershell
pnpm --filter @antigravity/api run prisma:deploy
```
Applies any migrations under `apps/api/prisma/migrations/` that haven't been applied yet, then regenerates the Prisma client. This is the **only** migration command that should ever run against a real database — see the warning below.

> **⚠️ Never run `pnpm --filter @antigravity/api run prisma:migrate`** (aliased to `prisma migrate dev`) against the real database. This project's migrations are hand-written, not auto-diffed — `migrate dev`'s shadow-database diffing doesn't understand Supabase's `auth`/`storage` schemas or the custom `app_runtime` role and has caused real breakage before. See `DEVELOPMENT.md`'s "Migrations" section for the full explanation.

## Supabase (local Docker stack only)

Only relevant if you're running the **local** Supabase stack instead of the live cloud project — not the normal path on this machine today.

```powershell
pnpm run supabase:start
```
Starts the local Supabase containers (Postgres, Auth, Storage, Studio) via Docker.

```powershell
pnpm run supabase:stop
```
Stops them.

## Quick troubleshooting

- **Port already in use / stale process**: if `pnpm dev:api` or `pnpm dev:web` won't start because the port's already bound, an old instance is probably still running from a previous session. Find and stop it:
  ```powershell
  Get-Process node | Select-Object Id, @{N='CommandLine';E={(Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine}}
  Stop-Process -Id <the-id> -Force
  ```
- **`Cannot find module` after switching branches or pulling**: someone else's change likely touched dependencies — rerun `pnpm install`.
- **Next.js `Cannot find module` after mixing `next build` and `next dev`**: delete the stale build cache and restart:
  ```powershell
  Remove-Item -Recurse -Force apps\web\.next
  pnpm dev:web
  ```
