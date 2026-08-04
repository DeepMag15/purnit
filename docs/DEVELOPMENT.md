# Local Development Environment

This is the full guide. For the fast path, see the [root README](../README.md#quick-start).

## Prerequisites

- **Node 22.11.0** — pinned via `.nvmrc` and the `volta` field in the root `package.json`, and enforced by `.npmrc` (`engine-strict=true` fails `pnpm install` outright on the wrong major version instead of breaking later). With [Volta](https://volta.sh) installed, `cd`-ing into the repo switches your active Node automatically — nothing to run, nothing global changes, and it switches back the moment you `cd` out. With [nvm](https://github.com/nvm-sh/nvm) instead, run `nvm use` in the repo root. Either way, you never need a global Node install matching this project specifically.
- **pnpm 11.13.0** — never installed globally. Pinned via `packageManager` in the root `package.json`; resolved automatically by [Corepack](https://nodejs.org/api/corepack.html) (ships with Node 22) — Volta's own `pnpm` shim defers to that same mechanism. No `npm install -g pnpm` anywhere in this project's own tooling.
- **Docker Desktop** — the local Supabase stack (Postgres, Auth, Storage, Studio) and self-hosted Jitsi run entirely in containers. Make sure it's running before `pnpm run setup`. Nothing project-specific gets installed on the host directly.
- **Python**: none. This is a 100% TypeScript/Node stack — no venv, no `requirements.txt`, nothing to set up here.

## Environment isolation

Cloning this repo and working in it shouldn't touch anything outside its own directory, beyond the handful of general-purpose tools above that any Node/Docker project needs installed somewhere on the machine once:

- **Node & pnpm** are exact-pinned (previous section) and never installed globally — both live in this repo's own `node_modules/` or are resolved per-directory by Volta/Corepack.
- **Every dependency** lives in this repo's `node_modules/` (gitignored, recreated by `pnpm install`). pnpm's default layout is strict (symlinked, non-hoisted): a package can't silently import something it didn't declare as its own dependency.
- **Database/Auth/Storage/Meetings** run in Docker containers, never installed on the host directly — see "Local Supabase" and "Meetings / Jitsi" below.
- **Secrets/config** live only in `.env` (gitignored, machine-local, created by `pnpm run setup` from `.env.example`). Nothing is baked into source or committed config.
- **Python** — not applicable (see above); nothing to isolate.

Deleting the cloned folder afterward leaves nothing behind beyond what Volta/Docker/git persist as general-purpose tools — no project-specific global packages, PATH entries, or config.

## Docker storage location (Windows)

Docker Desktop's WSL2 backend and this project's own package-manager caches default to the Windows system drive (`C:`) and grow unboundedly as images/containers/build cache/dependencies accumulate — on a machine with a small or shared `C:`, this is a real, recurring way to run out of system-drive space (this project hit it for real: a disk-full `overlayfs` write during container creation silently truncated several cached Jitsi image binaries to 0 bytes — see `infra/jitsi/README.md`'s "Known friction areas"). If you have a roomier secondary drive, it's worth relocating this project's Docker/tooling storage there once, up front:

- **Docker Desktop's data (images, containers, volumes, build cache)** all live inside one file, `%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx` (plus a small VM-OS disk at `wsl\main\ext4.vhdx`) — there is no in-app "Disk image location" setting exposed in this Docker Desktop version's containerd-snapshotter backend (checked `settings-store.json`, the `docker desktop` CLI, and the registry — none exposed it). The reliable, Docker-Desktop-agnostic fix is an **NTFS junction**: physically move the `wsl` folder to the target drive, then leave a junction at the original path so Docker Desktop keeps reading/writing the same logical location, unaware anything moved.

  ```powershell
  # 1. Fully stop Docker Desktop and WSL first — do not copy a live vhdx.
  docker desktop stop
  wsl --shutdown

  # 2. Copy (not move yet — verify first), e.g. to D:\DockerData\wsl
  robocopy "$env:LOCALAPPDATA\Docker\wsl" "D:\DockerData\wsl" /E /COPY:DAT /MT:4

  # 3. Verify byte-for-byte size match on both vhdx files before deleting anything, e.g.:
  #    (Get-Item "$env:LOCALAPPDATA\Docker\wsl\disk\docker_data.vhdx").Length
  #    (Get-Item "D:\DockerData\wsl\disk\docker_data.vhdx").Length

  # 4. Only once verified: remove the original, then junction the old path to the new one
  Remove-Item "$env:LOCALAPPDATA\Docker\wsl" -Recurse -Force
  New-Item -ItemType Junction -Path "$env:LOCALAPPDATA\Docker\wsl" -Target "D:\DockerData\wsl"

  # 5. Start Docker Desktop again and confirm `docker images`/`docker ps -a` still show everything
  ```

  This project's own dev machine has this applied: Docker's data lives at `D:\DockerData\wsl`, junctioned from the default path. Nothing about `docker compose`/`docker` commands changes — this is transparent at the filesystem level.

- **npm's cache** (`%LOCALAPPDATA%\npm-cache`, unrelated to pnpm's own cache below — some tooling shells out to npm/npx directly) is relocated the supported way: `npm config set cache "D:\npm-cache" --global`.
- **pnpm's cache-dir** (a small metadata/registry-response cache, separate from its main content-addressable store) is set via a `cache-dir=D:\.pnpm-cache` line in the user-level `~/.npmrc` rather than `pnpm config set --global` — the latter currently fails in this environment (`configured global bin directory ... is not in PATH`), an unrelated pre-existing quirk of pnpm being resolved through Volta rather than pnpm's own installer, not something this migration caused. `.npmrc` is read the same way regardless.
- **pnpm's main store** (the actual large content-addressable package store) needs no manual config — pnpm computes its default **per-drive** on Windows (hardlinks can't cross drives), so it already lives at `D:\.pnpm-store` simply because this repo lives on `D:`. Confirm with `pnpm store path`.

None of the above is repo state — it's machine-local configuration, nothing to commit. A fresh clone / new machine starts back at the C: defaults until this section is followed again.

## One-command setup

```bash
pnpm install
pnpm run setup
```

`pnpm run setup` (`scripts/setup.mjs`) does everything a fresh clone needs, in order:

1. Confirms Docker is running.
2. `supabase start` — brings up local Postgres/Auth/Storage/Studio via Docker Compose (idempotent; a no-op if already running). **The first run downloads several GB of Docker images and can take a while** depending on your connection — this is a one-time cost.
3. Writes/updates a local `.env` from `.env.example`, filling in the real local Supabase URLs/keys (read from `supabase status`, never hand-typed) and a freshly-generated `DATABASE_URL` for the `app_runtime` role (see below).
4. `prisma migrate deploy` + `prisma generate` against the local database — see "Migrations" below for why this is the *only* migration command you should run locally. This is also what creates the `app_runtime` role (the restricted, RLS-respecting role the API connects as at runtime, as opposed to `DIRECT_URL`'s elevated, BYPASSRLS role used only for migrations).
5. Generates a random local-only password for `app_runtime` and sets it on the database — only possible now that step 4 has created the role.
6. Creates the `logos` and `documents` Storage buckets with the right size/MIME-type limits (`scripts/create-storage-buckets.mjs`).
7. `prisma db seed` — materializes the IT industry blueprint (roles, department types) every tenant is provisioned against.
8. Prints next steps.

Then, in two separate terminals:

```bash
pnpm dev:api   # http://localhost:4000
pnpm dev:web   # http://localhost:3000
```

Sign up a new workspace at `http://localhost:3000/signup` — this creates a real tenant + admin user against your local stack.

## Project structure

```
apps/api/                    NestJS backend
  src/{auth,tenancy,rbac}/     Core platform: JWT verification, RLS session context, permission engine
  src/config-engine/           Compiles a per-user Workspace Manifest from a tenant's blueprint + role
  src/data-sources/            Named, authorized read endpoints (POST /api/data/:source)
  src/mutations/               Named, authorized write endpoints (POST /api/mutations/:mutation)
  src/modules/                 One directory per business module (projects, tasks, hr, chat, meetings, documents, ...)
  src/ai/                      AI provider abstraction (completion + embeddings) and retrieval
  prisma/schema/                One .prisma file per module — the schema authority (see "Migrations" below)
  prisma/migrations/            Hand-written SQL migrations — never generated by `prisma migrate dev`

apps/web/                    Next.js frontend
  src/sdui/                     The generic server-driven-UI renderer + primitive component registry
  src/modules/                  One directory per module's bespoke frontend (mirrors apps/api/src/modules/)
  src/app/                      Next.js App Router routes (login/signup, the dynamic /workspace/[pageId] shell)

packages/manifest-schema/    Shared Zod contracts for the manifest/blueprint/UI-node shapes — imported by both apps
infra/jitsi/                 Self-hosted Jitsi for Meetings video calls — optional, see below
supabase/                    Local Supabase CLI config (config.toml) — see "Local Supabase" below
scripts/                     setup.mjs (orchestrator) + create-storage-buckets.mjs (reusable, local or cloud)
```

## Local Supabase

The local stack is the real Supabase platform (Postgres + GoTrue Auth + Storage API + Studio), running in Docker via the Supabase CLI (`pnpm exec supabase ...`, pinned as a root devDependency — never installed globally).

- `pnpm run supabase:start` / `pnpm run supabase:stop` — start/stop the containers.
- `pnpm exec supabase status` — see the running stack's local URLs and keys.
- **Studio** (a local admin UI for the database/auth/storage) is at `http://127.0.0.1:54323` once running.
- **Reset the local database** (drop everything, reapply migrations from scratch): `pnpm exec supabase db reset --local`, then rerun `pnpm run setup` to reseed and recreate buckets.

`supabase/config.toml` is checked in and declarative — including the one piece that needs a manual Dashboard click on the real cloud project (the [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks) that stamps `tenant_id`/`permissions_hash` onto every JWT): locally it's wired via `[auth.hook.custom_access_token]` in that file, pointing at the `custom_access_token_hook` Postgres function defined in this project's own migrations. Local dev needs *less* manual setup than the cloud project, not more.

**`supabase/migrations/` is intentionally unused** — this project's schema authority is 100% in `apps/api/prisma/migrations/`. Don't run `supabase migration new` or `supabase db push`; those would create a second, competing migration system.

### Switching to a real cloud Supabase project

`.env.example`'s defaults point at the local stack. To point at a real cloud project instead (staging, or if you'd rather not run Docker locally), replace `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`/`DATABASE_URL`/`DIRECT_URL`/`JWT_ISSUER` in your `.env` with the real project's values, and register the Custom Access Token Hook manually via the Dashboard (Authentication → Hooks) — the one step that has no local-CLI equivalent for a cloud project. `scripts/create-storage-buckets.mjs` works unchanged against either target.

## Migrations — `migrate deploy` only, never `migrate dev`

**Never run `prisma migrate dev`** (aliased as `apps/api`'s own `prisma:migrate` script, kept only for rare local schema-design iteration against a fully disposable database) against either the local or cloud stack as part of normal work. Prisma's shadow-database diffing (`migrate dev`'s own mechanism) creates a bare Postgres database that has no idea about Supabase's `auth`/`storage` schemas or the custom `app_runtime` role — it doesn't reflect the real schema this project depends on, and has caused real, confirmed breakage in the past (see `CONTEXT.md`).

The only supported flow, used everywhere (including `scripts/setup.mjs`): hand-write the migration SQL yourself under `apps/api/prisma/migrations/`, then `pnpm --filter @antigravity/api run prisma:deploy` (`prisma migrate deploy && prisma generate`).

## Tests, typecheck, lint, build

```bash
pnpm run typecheck   # tsc --noEmit across every package
pnpm run lint        # real ESLint (apps/api, apps/web, packages/manifest-schema)
pnpm run test        # Jest (apps/api) + Vitest (apps/web) — all mocked, no live database needed
pnpm run build        # production builds
```

Backend tests never touch a real database (every mutation/data-source test mocks its Prisma transaction) — you don't need the local Supabase stack running just to run the test suite.

## Meetings / Jitsi (optional)

Video calls need a self-hosted Jitsi instance, also Docker-based but set up separately — see [`infra/jitsi/README.md`](../infra/jitsi/README.md). Everything else in the app works without it; only starting/joining a video call requires it. **Windows-only today** (`infra/jitsi/setup.ps1` is PowerShell — no bash equivalent exists yet, a known, disclosed gap).

## Troubleshooting

- **`supabase start` fails with a port conflict**: another Supabase-CLI project on this machine is already using ports `54321`-`54324`. Either stop it (`cd` into that project, `pnpm exec supabase stop` or equivalent) or change this project's ports in `supabase/config.toml`.
- **Docker daemon unresponsive / very slow first `supabase start`**: the local stack pulls ~9 Docker images on first run. On a memory-constrained machine, pulling many images concurrently can saturate the Docker/WSL2 VM — if `docker ps`/`docker info` itself hangs, close other memory-heavy applications and retry, or pull the images one at a time (`docker pull <image>` per line from `supabase/config.toml`'s image references) before rerunning `supabase start`.
- **`prisma:deploy` fails with a role/permission error**: `app_runtime`'s password is generated fresh by `scripts/setup.mjs` — if you ran migrations manually outside that script, make sure your `.env`'s `DATABASE_URL` actually matches whatever password is currently set on that role (`supabase db reset` + rerunning `pnpm run setup` is the simplest fix).
- **A new dependency needs `pnpm approve-builds`**: pnpm blocks unrecognized install/postinstall scripts as a supply-chain safeguard. Run `pnpm approve-builds <package>` after verifying what that specific script actually does — never blanket-approve everything.
