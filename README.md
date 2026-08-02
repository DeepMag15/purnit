# Antigravity

A config-driven, multi-tenant workspace platform: a NestJS API compiles a per-user "Workspace Manifest" from a tenant's blueprint + role, and a Next.js frontend renders it through a generic SDUI (server-driven UI) renderer. Modules — Projects, Tasks, HR, Chat, Meetings, Documents, an AI Assistant, and more — plug into the same manifest/permission/data-source contracts rather than each shipping bespoke frontend code.

## Tech stack

- **API**: NestJS + Prisma (`apps/api`)
- **Web**: Next.js (App Router) (`apps/web`)
- **Shared contracts**: Zod schemas for the manifest/blueprint shape (`packages/manifest-schema`)
- **Database/Auth/Storage**: Supabase (Postgres + RLS, Auth, Storage) — runs fully locally via Docker for development, see below
- **Meetings**: self-hosted Jitsi via Docker Compose (optional — see `infra/jitsi/`)
- **AI Assistant**: pluggable completion/embedding providers (Anthropic, Gemini), pgvector-backed retrieval

## Quick start

Prerequisites: [Volta](https://volta.sh) (recommended — auto-switches to this repo's pinned Node/pnpm the moment you `cd` in; [nvm](https://github.com/nvm-sh/nvm) also works, via `nvm use`) and [Docker Desktop](https://www.docker.com/products/docker-desktop/). Nothing else gets installed globally — see [Environment isolation](docs/DEVELOPMENT.md#environment-isolation) for exactly what stays inside this repo.

```bash
git clone https://github.com/DeepMag15/purnit.git
cd purnit
pnpm install
pnpm run setup      # brings up local Supabase (Postgres/Auth/Storage) via Docker, applies migrations, seeds, creates Storage buckets
pnpm dev:api         # http://localhost:4000
pnpm dev:web         # http://localhost:3000
```

That's the whole setup — no cloud account, no manually-copied secrets, nothing installed globally beyond Docker and Node/pnpm themselves. See **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** for the full guide (what each setup step does, project structure, running tests, troubleshooting, and optional Meetings/Jitsi setup).

## Documentation

| File | What it is |
|---|---|
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Full local development environment guide |
| [CONTEXT.md](CONTEXT.md) | Always-current project state — read this first for "what's built and why" |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Full technical design |
| [ORG_HIERARCHY.md](ORG_HIERARCHY.md) | The 7-tier authority model + department taxonomy |
| [CHANGELOG.md](CHANGELOG.md) | Chronological record of changes and decisions |

## Project layout

```
apps/api/                NestJS backend — modules, Prisma schema/migrations, RBAC/tenancy engine
apps/web/                Next.js frontend — SDUI renderer, per-module UI components
packages/manifest-schema/ Shared Zod contracts (manifest, blueprint, UI node shapes)
infra/jitsi/              Self-hosted Jitsi (Meetings video calls) — optional, Docker Compose
supabase/                 Local Supabase CLI config (config.toml) — see docs/DEVELOPMENT.md
scripts/                  Setup automation (local Supabase + Storage bucket provisioning)
```
