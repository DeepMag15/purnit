# Antigravity — System Architecture

> **Status:** v2 — updated to reflect the actual as-built system through Company Administration, Submodule A (Workspace Profile & Settings) (2026-07-18)
> **Last updated:** 2026-07-18
> **Owner:** Solo founder-engineer
> **Product:** AI-powered, multi-tenant, configuration-driven Enterprise Workspace Platform
>
> **v1 (2026-07-14) was the pre-implementation design, approved before any code existed.** Phase 1 (the vertical slice) and the first several Phase 2 stages are now built and live against a real Supabase project — this revision folds the real, as-built shape back into the design doc wherever implementation diverged from or extended the original plan (marked **"As built"** inline). Sections not marked are implemented as originally designed. `CONTEXT.md` remains the authoritative, most-current state snapshot and the place to look for implementation-level detail (file paths, gotchas, verification history); this document stays at the design/rationale level. `CHANGELOG.md` has the full chronological account of every decision and bug fix referenced below.

---

## Table of Contents

1. [Product Vision & Principles](#1-product-vision--principles)
2. [System Context (C4 L1)](#2-system-context-c4-l1)
3. [Tech Stack & Rationale](#3-tech-stack--rationale)
4. [Multi-Tenancy & RLS Model](#4-multi-tenancy--rls-model)
5. [Identity, Auth & RBAC/Permission Engine](#5-identity-auth--rbacpermission-engine)
6. [Configuration Engine & Workspace Manifest](#6-configuration-engine--workspace-manifest)
7. [SDUI Primitive Vocabulary & Renderer Contract](#7-sdui-primitive-vocabulary--renderer-contract)
8. [Data Model](#8-data-model)
9. [Module Architecture (Plugin Pattern)](#9-module-architecture-plugin-pattern)
10. [Entitlements & Feature Flags](#10-entitlements--feature-flags)
11. [AI / RAG Architecture](#11-ai--rag-architecture)
12. [Notifications](#12-notifications)
13. [Audit Logging & Compliance](#13-audit-logging--compliance)
14. [Deployment & Infrastructure](#14-deployment--infrastructure)
15. [Security Threat Model](#15-security-threat-model)
16. [Phased Roadmap](#16-phased-roadmap)

---

## 1. Product Vision & Principles

**Antigravity** is a multi-tenant SaaS platform where an organization's entire workspace — navigation, dashboards, pages, widgets, roles, and permissions — is **generated from backend configuration** rather than hardcoded in the frontend. Each org picks an industry blueprint (IT, Healthcare, Education, Finance, Manufacturing), customizes it, and receives an isolated workspace tailored to its hierarchy, roles, and enabled features.

### Architectural principles

1. **The frontend is a pure function of the manifest.** No page, role, dashboard, or permission is hardcoded in the client. The browser is a rendering engine over a server-produced document.
2. **The server owns truth.** What a user can see and do is compiled server-side into their manifest. The client is never trusted to enforce access.
3. **Configuration over code.** Behavior varies by data (blueprints, tenant overrides, entitlements, permissions), not by branching code paths per customer.
4. **Modular & pluggable.** Every business module registers into the platform through the same contracts (data sources, mutations, composite widgets, permissions).
5. **Tenant isolation is non-negotiable.** Defense in depth: Postgres RLS + explicit application-layer scoping on every query.
6. **Compliance-ready from day one.** Audit logging, encryption, and strict isolation are designed in; certification deferred.
7. **Ship a thin vertical slice first.** Prove the engine end-to-end on one industry before breadth.

---

## 2. System Context (C4 L1)

```
                         ┌──────────────────────────────┐
                         │          End Users            │
                         │ (Org admins, employees, etc.) │
                         └───────────────┬──────────────┘
                                         │ HTTPS
                         ┌───────────────▼──────────────┐
                         │   Next.js Frontend (Renderer) │
                         │  SDUI engine · primitive reg. │
                         └───────────────┬──────────────┘
                                         │ REST/JSON (JWT)
                         ┌───────────────▼──────────────┐
                         │      NestJS API (Node/TS)     │
                         │  Config Engine · RBAC · Data  │
                         │  Sources · Mutations · AI svc │
                         └───┬───────────────┬───────────┘
                             │               │
              ┌──────────────▼───┐   ┌───────▼──────────────┐
              │  Supabase        │   │  Claude API           │
              │  Postgres (RLS)  │   │  (RAG Q&A + reports)  │
              │  Auth · Storage  │   └───────────────────────┘
              │  pgvector        │
              └──────────────────┘
```

**External systems:** Supabase (Postgres + Auth + Storage + pgvector), Anthropic Claude API, transactional email provider. Stripe is a *future* integration (entitlement seam already present).

---

## 3. Tech Stack & Rationale

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js (React, TypeScript)** | Mature React SSR/CSR, strong DX; renders the SDUI manifest. |
| API | **NestJS (Node, TypeScript)** | Structured, modular DI framework — fits the plugin/module architecture; shares TS types + Zod schemas with the frontend. |
| Database | **Supabase Postgres** | Relational integrity for tenancy; **native Row-Level Security**; managed ops. |
| ORM | **Prisma** | Type-safe data access; migrations. RLS enforced at DB; Prisma sets tenant context per request. |
| Auth | **Supabase Auth** | JWT integrates directly with RLS; email + social now, SSO seam later. |
| Vector store | **pgvector (in Supabase)** | RAG embeddings colocated with data — no separate vector DB, tenant-scopable via RLS. |
| AI | **Claude API (latest models)** | RAG Q&A + report/content generation. |
| Shared contracts | **TypeScript types + Zod** | One source of truth for the manifest schema, validated on both FE and BE. |
| Hosting | Vercel (FE) · Railway/Render/Fly (API) · Supabase Cloud (data) | Managed-first; solo-operable. |

**Rejected:** MERN (document DB weakens relational tenancy + RLS); separate vector DB (unnecessary given pgvector); custom auth (Supabase Auth removes months of security-sensitive work).

---

## 4. Multi-Tenancy & RLS Model

**Model:** Shared database, shared schema, **row-level isolation via `tenant_id`** on every tenant-owned table, enforced by **Postgres Row-Level Security** *and* application-layer scoping (defense in depth).

### Mechanics

- Every tenant-owned table has `tenant_id uuid not null` + an index leading with `tenant_id`.
- The JWT issued by Supabase Auth carries `tenant_id` (and `user_id`) as a claim.
- RLS policies use the JWT claim to filter rows:

```sql
alter table projects enable row level security;

create policy tenant_isolation on projects
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
```

- The NestJS API **also** injects `tenant_id` into every query via a request-scoped context — it never relies on RLS alone. RLS is the safety net; the app layer is the primary control.
- **No raw SQL from the client, ever.** All data access goes through named data sources / mutations (§6–7).

**As built:** the API's own RLS policies are keyed on `current_setting('app.tenant_id')` — a session GUC `TenantPrismaService` sets per-request — not the `auth.jwt()` claim shown above. Prisma's direct Postgres connection bypasses Supabase's Data API, so `auth.jwt()` is empty on that connection (CONTEXT.md §9). This was fine as long as only the backend ever talked to Postgres directly.

**As built (Core Workspace Modules, Phase 1, Submodule 2: Channels & DMs, CONTEXT.md §50): Supabase Realtime changes that.** The browser holds its own JWT-authenticated connection for `postgres_changes`, which never sets `app.tenant_id` — so a **second, additive `realtime_membership` policy** exists on `conversations`/`conversation_members`/`messages`, genuinely JWT-based (`(auth.jwt() ->> 'tenant_id')::uuid = tenant_id`, using the `tenant_id` claim `custom_access_token_hook` already stamps on every JWT), plus membership via a `SECURITY DEFINER` helper function (`is_conversation_member` — required because a table's RLS policy querying itself from inside `EXISTS` is self-recursive and Postgres rejects it, `42P17`). **Realtime also requires `GRANT SELECT` to Supabase's built-in `authenticated` role** — no table in this project had ever granted anything beyond the custom `app_runtime` role before, since nothing used Realtime until this submodule; without it, subscribing fails with a misleading `P0001 invalid column for filter` error that reads like a schema problem, not a privilege one. **⚠️ Even with all of the above correct, this Supabase project's Realtime service was confirmed, via exhaustive elimination, to never deliver `INSERT` `postgres_changes` events (only `DELETE`)** — an external, disclosed limitation, not something fixable from RLS/grants/schema. `messages.list` polls as the actual delivery guarantee; the Realtime subscription is a non-load-bearing best-effort accelerator. See CONTEXT.md §50 for the full elimination chain before adding Realtime to any other table.

### Why not schema/DB-per-tenant

Chosen for cost, operational simplicity, and scale to hundreds of tenants / thousands of users. DB-per-tenant remains a *future* option for a specific enterprise customer with strict isolation requirements; the data-source abstraction keeps that door open.

---

## 5. Identity, Auth & RBAC/Permission Engine

> **As of Org Hierarchy Phase 1 (2026-07-17):** the flat 8-role ladder this section originally described has been replaced by the 7-tier universal authority model designed in `ORG_HIERARCHY.md`. §5.4–5.9 below reflect the as-built system. Phases beyond Phase 1 (full department taxonomies actually populated by real Admins, a second real bonus-permission consumer beyond HR, Leave/Performance-Review/CRM/etc.) remain future work — see `CONTEXT.md` §36 for the implementation record.

### 5.1 Authentication

- **Supabase Auth** handles signup, login, sessions, password reset, MFA, and (later) social/SSO.
- On signup the user creates a company → a `tenant` row is provisioned, the user becomes the org's first **Company Admin** (the top of the role hierarchy — see §5.4), and their industry blueprint is instantiated.
- JWT custom claims: `tenant_id`, `user_id`, and a short `permissions_hash` (for cache invalidation), populated via a Supabase Auth **Custom Access Token Hook** (a Postgres function, `public.custom_access_token_hook`) — a strict 1:1 `auth_user_id → users` lookup at every token mint.

**As built — Workspace ID as a required, server-verified login field.** Every tenant carries a globally unique `workspaceId` (a URL-safe slug generated from the company name at signup, `slugify()` + a numeric-suffix collision loop — `apps/api/src/auth/workspace-id.ts`). Login now requires three fields (workspace ID, email, password), and the frontend calls a public pre-flight endpoint, **`POST /auth/verify-workspace`**, *before* ever attempting a Supabase sign-in: it confirms the given email genuinely belongs to the tenant identified by the given workspace ID, and returns one **generic** rejection on every failure mode (wrong workspace, wrong email, nonexistent workspace) — deliberately not distinguishing them, to close an enumeration channel. This is a pre-flight confirmation layer only, not a new identity model — `tenant_id` still lands in the JWT exactly the way it always did (the Custom Access Token Hook, unchanged), and **the design deliberately keeps "one email = one company"** rather than the alternative (one identity spanning multiple tenant memberships, Slack/Notion-style), a considered choice, not a limitation to casually revisit.

### 5.2 Authorization — permission model

Permissions are triples: **`resource:action:scope`**

- **resource** — `project`, `task`, `department`, `user`, `role`, `settings`, … (grows per module; see §9)
- **action** — `read`, `create`, `update`, `delete`, `manage`, `invite`, `assign`, …
- **scope** — `own | team | department | department-subtree | tenant` (broadest granted wins, per resource:action pair — see the collapse rule in §5.3). `department-subtree` (Org Hierarchy Phase 1) sits between `department` and `tenant`: an Executive's authority reaches their own department **and every descendant of it**, walking `Department.parentId` down — the one scope value whose resolution requires a query (`getDepartmentSubtreeIds`, a recursive CTE) rather than a plain equality check; see §5.8.

**Roles** bundle permissions. A **user** holds one or more roles (union of grants across all held roles). Roles may `extend` another role and add/remove grants (`"+schedule:manage:team"`, `"-patient:delete:tenant"`) — see §5.4 for how this is actually implemented and used.

**As built — `scope` isn't always a row-ownership check.** The original model implicitly assumed `"own"` always means "a row this user created/is assigned to" (still true for `project`/`task`). Once Department Head-level scoping was built, `"own"` also came to mean *"the group I belong to"* for a couple of specific resources (`department:manage:own`, `user:manage:own` — "my own department," not "a department I created"). These are deliberately **not** routed through the generic row-scope check described in §5.3 (which only ever means row-ownership) — they're enforced by small, explicit, resource-local checks instead, to avoid silently redefining what `"own"` means for every other resource. Treat `"own"` as *contextual to the resource*, not a single universal row-ownership rule, when adding a new permission.

### 5.3 The Permission Resolver

Server-side service that, given a user, produces their **effective permission set**:

```
resolveEffectivePermissions(user):
  roleAssignments = user.roleAssignments       // one or more; a role's own grants are already
                                                // fully resolved (see §5.4) by the time this runs
  grants          = union(role.permissions for role in roleAssignments)
  effective       = collapse(grants)           // broadest scope per resource:action pair
  return { has(resource, action): scope | null, permissionsHash, toArray() }
```

**As built — `extends`-chain resolution happens once, at role *materialization* time, not here.** By the time a `Role` row exists in the database, its `permissions` are already a fully flattened, self-contained list — this resolver does a plain union-and-collapse over already-resolved roles; it does **not** walk any `extends` chain itself (that's §5.4, a strictly earlier, one-time step). This is a deliberate performance choice made explicit during implementation: a permission check is a flat JSON union + collapse, never a live chain-walk. If a user holds multiple roles at once (a separate, orthogonal mechanism — e.g. a future delegation feature could add a second `RoleAssignment`), their effective permissions are simply the union of each role's own already-flat grants; this has nothing to do with any single role's own `extends` ancestry.

The resolver feeds **two** consumers:
1. The **Configuration Engine** — to prune the manifest (§6.5).
2. Every **DataSource / Mutation resolver** — to authorize and scope actual data access at call time.

Scope drives row filtering: `task:read:department` → the data source injects a department-matching condition. Enforced in the resolver **and** mirrored by RLS where feasible. **As built:** for resources where a row can be "in scope" through more than one independent path — e.g. a `Task` a Member is directly assigned, OR that belongs to their department, OR (for a `Project`) that they're an explicit member of via `ProjectMember` (§9.1) — these paths are **ORed together, never ANDed**. Ownership/assignment is always an inclusive *floor* under a broader scope, never something a department/team mismatch can silently override. (This was a real, user-reported bug early in Phase 2 — the original implementation ANDed these conditions, making an assigned task invisible to its own assignee whenever the department didn't also match. Fixed permanently; the OR-based rule is now the standing invariant for any new multi-path scope check.)

### 5.4 Role hierarchy — `extends`-chain inheritance *(as built, Org Hierarchy Phase 1)*

The IT blueprint's roles form a **7-tier universal authority ladder**, from least to most senior, plus one lateral branch and the flat top:

```
role.intern  (base — no extends)
  └─ role.member              (label "Practitioner")
       └─ role.senior-employee    (label "Senior Practitioner")
            └─ role.team-lead         (label "Lead")
                 └─ role.project-manager   (label "Manager")
                      ├─ role.department-head
                      │    └─ role.executive       (new tier — department-subtree scope, §5.8)
                      └─ role.hr-manager           (a separate branch — extends Manager directly,
                                                      the one real bonus-permission tier today, §5.7)
role.admin  (label "Company Admin"; flat, no extends — already a superset of everything below it)
```

**All blueprint role `id`s are unchanged from the original flat model — only `label`s (and `role.hr-manager`'s `extends` target) changed.** This was a deliberate, zero-migration relabeling: every tenant's existing `RoleAssignment` rows kept pointing at the exact same `Role` rows, confirmed live across all real tenants before/after reseeding. `role.hr-manager` moved from extending `role.member` (Practitioner tier) to extending `role.project-manager` (Manager tier) — a real, deliberate semantic broadening, safe only because it was verified live that no tenant had anyone actually assigned to it at the time.

Each role's blueprint definition either stands alone (a complete `permissions` list, like `role.intern` and `role.admin`) or declares `extends: "<parent role id>"` plus its own **delta** list (`"+resource:action:scope"` to add, `"-resource:action:scope"` to remove an inherited grant, an unprefixed entry to add as-is). A role's final, flat permission set is resolved by walking its `extends` chain and applying each step's deltas on top of its parent's already-resolved set (`applyGrantDeltas`) — **once, at role materialization time** (tenant provisioning at signup, and an idempotent re-sync on every blueprint deploy that also creates any role a tenant doesn't have yet), never at permission-check time (§5.3).

**Why this shape, not the naive "child inherits everything the parent has":** the direction that matters is *seniority extends and adds*, not *organizational-chart child extends parent*. A more senior/specialized role `extends` a more general one and layers additional grants on top. An org chart's reporting lines (who manages whom day-to-day) is a **separate concern**, handled by `Department`/`Team` placement (§8) and, since Org Hierarchy Phase 1, the explicit `User.managerId` field (§5.9) — not by the permission-inheritance graph. The two can and do diverge: HR Manager's permission chain runs through the generic Manager tier (its actual authority — people-management + two HR-specific bonus grants), while its *reporting line* is whatever `managerId`/department placement says, independently.

**`role.executive` adds `department-subtree`-scoped grants via `+` deltas on top of Department Head's inherited `:department`-scoped ones, without removing them** — safe by construction: `collapsePermissions` always keeps the *broadest* scope per `resource:action` key (§5.2/§5.3's collapse rule), so a flattened permission list containing both `project:create:department` (inherited) and `project:create:department-subtree` (added) simply resolves to the broader grant. No conflict, confirmed during implementation.

### 5.5 Hierarchy-aware role assignment *(as built, Phase 2)*

A role can only be **assigned** (at invite time, or via promote/demote) to a role that is *itself, or an ancestor in its own `extends` chain* — walking **up** from the assigning actor's own role, not down from the target. Concretely: HR Manager's chain is `hr-manager → employee → intern`, so an HR Manager (if ever granted assignment authority — see §5.6) can assign Employee or Intern, but **not** Senior Employee, Team Lead, or anything on the primary track, even though those might sound "lower" in casual seniority terms — they're a different branch entirely, not an ancestor of HR Manager's own role. **Company Admin bypasses this check entirely** ("can assign any role") — the one hardcoded role-identity check in the RBAC layer, deliberate and narrowly scoped.

This closes a real privilege-escalation surface: without a hierarchy-aware check, any role capable of assigning roles at all could in principle assign a role more senior than its own. A user can never change their own role (a one-line safeguard against trivial self-escalation).

### 5.6 Precision permissions — distinct authority per resource, not coarse buckets *(as built, Phase 2)*

Early Phase 2 gave every tier only coarse `project`/`task` CRUD at increasing scope. This was refined into resource-specific, tier-appropriate authority:

- **`user:invite` is a separate permission from `user:manage`.** Creating a brand-new person (`user:invite`) is a distinct capability from managing an existing person's org placement or seeing the roster (`user:manage`) — this split exists specifically so a future capability (an Admin delegating *just* invite authority to HR Manager, without handing over full user management) has a single, narrow permission to grant rather than a bundle. Only Company Admin has `user:invite` today; that delegation mechanism itself is a deliberately deferred follow-up, not yet built (§16).
- **`role:assign`** gates the hierarchy-aware assignment described in §5.5 — a genuinely distinct capability from `user:manage`, since "can change what someone is allowed to do" is a materially different authority than "can edit their department."
- **`department:manage:own`** — Department Head manages *only the one department they themselves belong to* (creating teams within it, placing employees into it), never any other department, never the department's own core identity (renaming/reparenting a department, or creating a brand-new one, both require the broader `:tenant` scope — Department Head structurally cannot do either). Enforced by a small, resource-local check rather than the generic row-scope mechanism (§5.2's note).
- **A task's assignee must actually be part of the project** (the project's owner, or an explicit `ProjectMember` — §9.1) — enforced server-side on both task creation and reassignment, closing what was originally only a UI-level convention.

### 5.7 Department Types — job titles and bonus permissions layered on the tier ladder *(as built, Org Hierarchy Phase 1)*

A `Department` carries a tenant-editable `type` (e.g. `"engineering"`, `"hr"`, `"sales"` — free-text, not a DB enum, same "app invariant, not DB constraint" treatment as `Task.status`). The type drives two things, both materialized once at signup/reseed time (`materializeDepartmentTypeLabels`) into a new `DepartmentTypeRoleLabel` table (`tenantId, departmentType, sourceBlueprintRoleId, label, overrideRoleId?`) — never live-derived from blueprint JSON at request time, the same discipline `Role.permissions`/`label` already follow:

1. **Display labels** — e.g. the generic "Manager" tier reads as "Engineering Manager" for a user whose department type is `"engineering"`. Purely cosmetic; does not change scope width or permissions.
2. **Bonus permissions, for the rare tier that genuinely needs different authority per department type** — authored as an ordinary extends-chain blueprint role, not a new runtime mechanism. Today's one real case: `role.hr-manager` (extends the generic Manager tier, `role.project-manager`, adding `user:manage:tenant`/`department:manage:tenant`) is what HR's Manager-tier `tierLabels` entry points at via `roleOverrides`.

**A real correctness property, found and fixed during implementation:** the label overlay only applies a bonus-permission-carrying label (like "HR Manager") when the user's *actual* `Role` row matches `overrideRoleId` — not to anyone at the generic tier merely sitting in a matching-typed department. Otherwise a generic Manager placed in an HR department would *display* as "HR Manager" without actually holding its bonus grants. Tiers with no override (the common case — most tiers in most department types) get the cosmetic label unconditionally, since there's no permission-mismatch risk there.

**Why this avoids role-count explosion:** scope width is still resolved from the *acting user's own department/team at request time* (`ctx.userDepartmentId`), exactly as before — a single generic tier role already scopes correctly regardless of which department type its holder sits in. Department type only changes what that role is *called*, and, in the one case it matters, which distinct role a person should actually be assigned.

### 5.8 `department-subtree` scope resolution *(as built, Org Hierarchy Phase 1)*

`getDepartmentSubtreeIds(tx, tenantId, departmentId)` (`apps/api/src/rbac/department-subtree.ts`) resolves every department id reachable by walking `Department.parentId` **down** from a given department (itself plus every descendant), via a single recursive CTE — not a materialized closure table, per this project's standing "don't optimize before it's needed" pattern; department trees are small per tenant.

**Deliberately kept as a separate, explicit, on-demand async step — not folded into `isRowInScope` itself.** `isRowInScope` remains a pure, synchronous, easily-unit-tested function; `ScopeCheckActor` gained an optional `departmentSubtreeIds?: string[]`, populated by the caller only when the resolved scope is actually `"department-subtree"` (no extra query for the common case). Every call site that needs subtree support (`tasksWhere`/`projectsWhere`, now both `async`; the three `isRowInScope` sites in `projects.mutations.ts`/`tasks.mutations.ts`; `hr.mutations.ts`'s bespoke `department.create`/`team.create` checks, which route around `isRowInScope` entirely — see §5.2's note on resource-local scope checks) resolves the subtree set itself, once, before checking.

### 5.9 The manager/reports-to relationship *(as built, Org Hierarchy Phase 1)*

`User.managerId` (nullable, self-referential) is the reports-to relationship — independent of role tier and department/team placement, and never silently derived from either. Set explicitly via a dedicated `user.setManager` mutation (same `"own"`-scope-constrains-the-target-user pattern as `user.assignDepartment`). This is **the** mechanism every future approval-shaped workflow (leave, performance review, anything else) is designed to route through (`ORG_HIERARCHY.md` §9–§10): default approver = the requester's `managerId`; escalation walks the manager chain, not the role-tier ladder. No approval workflow exists yet to consume this — the field and its routing *principle* are built ahead of the first real consumer, deliberately, so that consumer doesn't have to invent its own reporting-line concept.

The general principle established here for any future module: **default to the narrowest permission that actually matches the capability being described**, not a shared grab-bag "manage" permission — splitting later is far more disruptive than starting narrow.

---

## 6. Configuration Engine & Workspace Manifest

> The Configuration Engine **produces** the Workspace Manifest; the SDUI Rendering Engine (§7) **consumes** it. They are one contract seen from two ends.

### 6.1 Mental model

**The frontend is a pure function of the manifest. The manifest is a pure function of `(tenant config, user identity)`, compiled on the server.** Nothing about what a user can see or do is decided in the browser.

### 6.2 The layered config model

A workspace is compiled from four independent layers:

```
Layer 1: INDUSTRY BLUEPRINT   (owned by platform)  → default roles, nav, pages, dashboards, modules
Layer 2: TENANT CONFIG        (owned by org admin) → structured overrides on the blueprint
Layer 3: ENTITLEMENTS         (owned by plan)      → which modules/features are unlocked
Layer 4: IDENTITY/PERMISSIONS (owned by RBAC)      → THIS user's effective permissions + data scope
                                 ↓ compile()
                    WORKSPACE MANIFEST (per-user, per-request, cacheable)
```

Layers are independent: updating a blueprint doesn't disturb tenant customizations; a role change re-shapes a user's manifest with zero config edits.

### 6.3 Override semantics — stable-id structured overrides *(approved)*

Every configurable element carries a stable `id`. Tenant overrides are a **keyed patch set** (`add` / `remove` / `patch`), never a deep-merged blob. This yields non-destructive customization and safe blueprint upgrades.

```jsonc
{
  "blueprintRef": "healthcare@3",
  "overrides": {
    "navigation": {
      "remove": ["nav.crm"],
      "add": [{ "after": "nav.patients",
                "item": { "id": "nav.telehealth", "label": "Telehealth", "pageId": "page.telehealth", "icon": "video" } }],
      "patch": { "nav.patients": { "label": "Residents" } }
    },
    "pages": {
      "patch": { "page.dashboard": { "widgets": { "remove": ["widget.revenue"] } } }
    },
    "roles": {
      "add": [{ "id": "role.charge-nurse", "extends": "role.nurse", "permissions": ["+schedule:manage:team"] }]
    }
  }
}
```

**As built — Settings & Workspace Customization (Phase 2) is the first real, in-app admin surface over this layer**, proving the mechanism end-to-end for the first time outside a seed script: an Admin-only Settings page lets them rename navigation labels (`overrides.navigation.patch`) and set a tenant accent color (`Tenant.branding`, a straight passthrough, not part of the override JSON). **A hard invariant this surface has to honor, and any future override-writing feature must too: a "change" always inserts a new, versioned `TenantConfig` row and deactivates the old one — it never mutates an existing row's `overrides` JSON in place.** The bootstrap/page etag (§6.7) is keyed in part on `TenantConfig.version`, not on override *content* — an in-place mutation would leave the etag unchanged across a real content change, silently serving stale cached pages via `304`. `overrides.roles.add` remains what it always was in this layer — a **fully-formed** role definition (a complete `permissions` array), not an `extends`+delta role; extending the *blueprint's own* roles with deltas (§5.4) is a different, separate mechanism that operates on the blueprint itself, one layer below tenant overrides, and happens at role-materialization time, not here. Tenant-specific custom roles authored through this layer (with their own `extends`+delta shape) remain a real, not-yet-built future capability.

The workspace **shell** itself (nav labels, branding) can now change post-load without a full page reload — the frontend's render context exposes a `refetchBootstrap()` capability specifically for this, distinct from a single composite refreshing its own bound data.

### 6.3a File uploads — direct-to-Storage, signed-URL pattern *(as built, Company Administration Submodule A)*

The logo upload (`BrandingCard`, Settings) is this codebase's **first** file-upload capability, and establishes the pattern any future upload feature (e.g. a Documents module) should reuse rather than reinventing:

1. The browser asks our API for permission via a mutation (`tenant.createLogoUploadUrl`, `settings:manage`-gated) — the request carries only a file extension, never the file's bytes.
2. The API validates the extension against an allowlist, builds a per-tenant, per-upload path (`{tenantId}/{randomUUID()}.{ext}` — a fresh path every time, never overwritten, so the browser never needs a cache-busting query param), and asks Supabase Storage for a short-lived signed upload URL via the existing service-role client (`SupabaseAdminService`, which now wraps Storage admin operations alongside Auth Admin ones — one client, not a second one).
3. The browser uploads the raw file **directly to Supabase Storage** using the signed URL, via the existing anon-key client (`apps/web/src/lib/supabase-client.ts`) — the file's bytes never touch our own NestJS process, so no request body-size limit anywhere in `main.ts` needed to change for this feature.
4. The browser then calls the ordinary persistence mutation (`tenant.updateBranding`, extended to accept `logoUrl`) with the signed-URL response's `publicUrl` — the same mechanism `accentColor` already used, no third mutation.

**Accepted trade-off, stated explicitly rather than left implicit:** a replaced logo's old Storage object is never deleted — acceptable for a small, rarely-changed, tenant-scoped asset; revisit only if this pattern is reused for something with materially different volume/churn (e.g. Documents).

### 6.4 Compilation pipeline

```ts
async function compileWorkspace(user: User, tenant: Tenant): Promise<WorkspaceManifest> {
  const blueprint    = await getBlueprint(tenant.industry, tenant.blueprintVersion); // L1
  const tenantConfig = await getTenantConfig(tenant.id);                             // L2
  const resolved     = applyOverrides(blueprint, tenantConfig);   // stable-id patch merge
  const entitlements = await getEntitlements(tenant.planId);                         // L3
  const entitled     = filterByEntitlements(resolved, entitlements);
  const perms        = await resolveEffectivePermissions(user);                     // L4
  const pruned       = pruneByPermissions(entitled, perms);       // REMOVE, don't hide
  const bound        = attachDataSourceRefs(pruned);
  const branded      = applyBranding(bound, tenant.branding);
  return finalize(branded, { schemaVersion: CURRENT, etag: hash(...) });
}
```

**Invariants:**
- **Prune, don't hide.** Elements a user lacks permission for are *absent from the manifest bytes*, not CSS-hidden. *(approved)*
- **Bindings are references, never queries.** The manifest says `"source": "patients.list"`; the server owns what that means and re-checks permission + tenant scope at fetch time.

### 6.5 Permission-driven pruning

The resolver (§5.3) supplies effective permissions; `pruneByPermissions` walks the resolved tree and removes any nav item, page, widget, action, or field gated by a permission the user lacks. Visibility that depends on *live data* (not static permission) is handled as a server-evaluated data-source concern, not a client toggle.

**As built (performance pass 2, CONTEXT.md §48): `pruneByPermissions` takes an optional `onlyPageId`, restricting which page(s) actually get walked/pruned.** Both real callers — `compilePage` (one page, by definition) and `compileWorkspace` (only ever reads `pages[dashboards.default]`) — never needed more than one page's tree pruned, but every call used to prune *every* page in the blueprint regardless. `ConfigEngineService` correspondingly split into `resolveEntitledBlueprint` (Blueprint→Overrides→Entitlements, unpruned — `dashboards` passes through pruning untouched, so it's safe to read `dashboards.default` from this unpruned form before pruning even runs) and an explicit `pruneByPermissions(entitled, effective, pageId)` call at each of `compileWorkspace`/`compilePage`, rather than one shared "prune everything" helper.

### 6.6 Versioning & migration

- The compiler **always emits `schemaVersion = CURRENT`** → the renderer never sees old schemas.
- **Blueprints (L1) and tenant configs (L2)** are versioned and forward-migrated server-side.
- **Primitives are individually versioned** (`Table@2`) to evolve props without breaking configs mid-rollout.

### 6.7 Delivery & caching

- `GET /api/workspace/bootstrap` → shell (`tenant`, `user`, `navigation`, `branding`, `featureFlags`, default dashboard). Eager.
- `GET /api/workspace/pages/:pageId` → that page's tree. Lazy, on navigation.
- Both carry an **`etag` = hash(tenantConfigVersion, blueprintVersion, permissionsHash)** → role change busts cache automatically; `stale-while-revalidate` friendly.

**As built (performance audit, CONTEXT.md §47): the client now actually sends `If-None-Match`.** From Stage 6 through the Company Administration submodules, this 304 mechanism existed only server-side — `apps/web/src/lib/api-client.ts` never sent the header at all, confirmed by reading the file rather than assumed, so every bootstrap/page fetch paid the full compile cost on every navigation regardless. Fixed with a tiny per-path `(etag, last body)` in-memory cache in `api-client.ts`; a `304` response returns the cached body. No explicit invalidation was needed — the etag already changes whenever anything it depends on does, so a real content change naturally produces a fresh `200` and updates the cache rather than a false-positive `304`. `clearManifestCache()` runs alongside the existing `clearAccessToken()` on logout/401, for hygiene, not correctness.

**As built — a version *number* alone is not proof of freshness unless something guarantees it's bumped on every real edit; this bit twice before the rule was made explicit.** `Blueprint.version`/`Tenant.blueprintVersion` are numbers that ordinary content edits (re-seeding a blueprint fixture in place) do **not** bump — an unchanged number produces an unchanged etag even though the actual manifest content changed, and `304`-driven caching then serves stale content indefinitely. The fix, now the standing rule for the etag hash: every mutable *content* input to the compiled manifest must contribute its own real change-timestamp (or an equivalent monotonic counter), not just its owning row's version number — the etag now also folds in `Blueprint.updatedAt` and `Tenant.updatedAt` (the latter added specifically once `Tenant.branding` became editable). **Any future mutable field that feeds the compiled manifest must get the same treatment when it's added**, not assumed to be covered by an existing version field.

**⚠️ As built — `@Res({ passthrough: true })` and a manual `res.end()` on only one branch don't mix (found live, Company Administration Submodule C).** Both `bootstrap()` and `page()` originally used passthrough mode, then called `res.status(304).end(); return;` on a cache-hit — but passthrough mode tells Nest it still owns sending the response, so Nest's own pipeline then *also* tried to send the (undefined) handler return value after the 304 branch had already ended it, throwing `ERR_HTTP_HEADERS_SENT` on any repeat request matching the same etag. React StrictMode's double-effect-invocation in dev makes the repeat-request case common, not rare — this was live-blocking, not a theoretical edge case (a second, unrelated pre-existing page confirmed it wasn't specific to new code). **Fixed by taking full manual `@Res()` control for the whole handler** (no `passthrough`), with an explicit `res.json(...)` call on the success path instead of an implicit return. **Rule: if any branch of a handler needs to end the response manually, take manual control of the entire handler — never mix `passthrough: true` with a manual `.end()` on just one path.**

### 6.8 Workspace Manifest schema (bootstrap)

```ts
interface WorkspaceManifest {
  schemaVersion: number;
  tenant:  { id: string; name: string; industry: string; branding: BrandTokens };
  user:    { id: string; displayName: string; roles: string[]; permissionsHash: string };
  navigation: NavItem[];                       // already permission-pruned
  page:    UINode;                             // default dashboard tree
  featureFlags: Record<string, boolean>;
  meta:    { compiledAt: string; etag: string };
}

interface NavItem { id: string; label: string; icon?: string; pageId?: string; children?: NavItem[]; requiredPermission?: string; moduleKey?: string; }
```

### 6.9 Nested navigation & the page/nav sync invariant *(as built, Sidebar Navigation Phase 1)*

`NavItem.pageId` is optional: a nav item with `children` and no `pageId` is a pure disclosure group (expand/collapse only, not itself a link); one with `pageId` is a real link, whether or not it also has `children`. `pruneNavItems` (`apps/api/src/config-engine/permission-pruner.ts`) already recursed into `children` before this phase — the schema field simply went unused by any frontend consumer until now (§7.8).

**Two pruning refinements, both in `permission-pruner.ts`:**

1. **Empty-group pruning.** After recursing into a group's `children`, `pruneNavItems` now drops the group entirely if `pageId` is absent and no child survived — the "prune, not hide" invariant (§6.5) applied to groups, not just leaves. Without this, a tier with no visible children in, say, an "HR" group would see a dangling, empty disclosure header instead of the group's total absence.
2. **Page/nav sync.** `pruneByPermissions` now filters `resolved.pages` by each page's own root `requiredPermission` *before* running the existing `pruneNode` pass (which only ever handled a page's nested `actions`/`children`, never the page node's own permission). Closes a real gap: previously, a page absent from a user's pruned nav could still be fetched whole via a direct `GET /api/workspace/pages/:pageId`, because nothing checked the page's own root gate — an information-exposure gap (mutations/data-sources independently re-check permissions at dispatch time, so this was never a write-authorization bypass), but one that contradicted this section's own stated invariant. `compilePage`'s existing `if (!result) throw NotFoundException` needed no change — a permission-gated page is now simply absent from `pruned.pages`, so the existing "never distinguish doesn't-exist from can't-see" 404 already covers it.

Every page's own `requiredPermission` should mirror its nav item's exactly (enforced by convention in the blueprint fixture, not by a runtime check) — a page with a stricter gate than its nav item would be unreachable even when linked; a looser one reopens the sync gap this section closes. The one seed-time exception that must never happen: the default dashboard (`dashboards.default`) must never carry a `requiredPermission` — `apps/api/prisma/seed.ts` asserts this right after its `BlueprintDefinitionSchema.parse` call, since `compileWorkspace`'s `pruned.pages[defaultPageId]` lookup has no graceful fallback if it's ever violated.

**Known Phase-1 limitation**: `applyOverrides`/`applyKeyedListPatch` (§6.3) only patches `navigation` at its top level — a tenant-config override cannot yet reach into a nested group's `children` to rename/remove/reorder an item living inside one. Not fixed here; flagged as a real, newly-relevant limitation this phase's nesting introduces, same spirit as `entitlement-filter.ts`'s own "sufficient for Phase 1" caveat on page/module filtering.

---

## 7. SDUI Primitive Vocabulary & Renderer Contract

### 7.1 The primitive vocabulary (closed, versioned registry)

| Category | Primitives |
|---|---|
| **Layout** | `Page`, `Section`, `Stack`, `Grid`, `Tabs`, `Card`, `Split`, `Accordion` |
| **Display** | `Heading`, `Text`, `KpiCard`, `Badge`, `Avatar`, `Divider`, `EmptyState`, `Image` |
| **Data** | `Table`, `List`, `Chart` (line/bar/area/pie), `Kanban`, `Calendar`, `Timeline`, `DetailView` |
| **Input** | `Form`, `Field` (text/number/date/select/relation/file/richtext/…), `SearchBar`, `FilterBar` |
| **Action** | `Button`, `ActionMenu`, `Link` |
| **Composite (module-provided)** | `ProjectBoard`, `TaskList`, `LeaveRequestForm`, `CrmPipeline`, `AiPanel`, … |

**Composite widgets are the escape hatch** *(approved)*: rich module screens ship as a single registered composite rather than being decomposed into primitives. Modules extend the vocabulary by registering into the same registry on both FE and BE. This is what keeps "full SDUI" maintainable.

**As built (performance pass 2, CONTEXT.md §48): `List` virtualizes (`react-window` v2) above a 50-row threshold** — inert at every real tenant's current data volume (confirmed directly), pure future-proofing. Verified with synthetic data (a `{const}` binding, not real tenant rows) rather than generating 50+ throwaway rows in a real tenant just to test it. **`Table` was deliberately left unvirtualized** — a real semantic `<table>`'s `<tr>`/`<td>` markup doesn't compose with react-window's absolutely-positioned-row model without a structural div/grid rewrite, and there was no safe way to verify that rewrite against real row counts. A genuine, disclosed gap if a `Table`-bound data source ever needs it.

### 7.2 Anatomy of a manifest node

```ts
interface UINode {
  id: string;                        // stable id (overrides + React keys)
  type: string;                      // registry key, e.g. "Table"
  version: number;                   // primitive version
  props?: Record<string, unknown>;   // Zod-validated per type@version
  bind?: DataBinding;                // data primitives
  children?: UINode[];               // containers only
  actions?: ActionSpec[];            // interactions
  // No runtime `visibility` — pruning already happened server-side.
}
```

### 7.3 Data-binding DSL

```ts
type DataBinding =
  | { source: string; params?: Record<string, BindExpr>; paginate?: boolean }  // named server data source
  | { const: unknown }
  | { ref: string };                 // page-state / current-row / current-user reference
```

Client resolves `params` and calls `POST /api/data/:source`. The server-side resolver applies tenant scope, permission + data scope, param allow-list, and pagination caps. **The client cannot widen what a source returns.**

**As built (performance pass 2, CONTEXT.md §48): `useDataBinding` resolves `{source}` bindings through TanStack Query, not a hand-rolled `useEffect`/`fetch`.** Query key is `[source, resolved-params, tenantId, userId]` (`dataSourceQueryKey` in `use-data-binding.ts`) — request dedup (two components asking for the same source+params share one network call), stale-while-revalidate, and a real prefetch API all come from this, not re-implemented by hand. The hook's external contract (`{data, loading, error, refetch}`) is unchanged for every existing primitive; `queryKey` was added as an additive field so a caller can optimistically patch its own cached data (`TaskList`/`ProjectBoard` do this for one mutation each) without duplicating key-construction logic. A sibling `useDataSourceQuery(source, params)` gives composites (`OrgStructure`, and the secondary reference-data fetches inside `ProjectBoard`/`TaskList`/`TeamMembers`) the same cache without needing a `bind` at all — before this, composites bypassed the cache entirely, so two of them needing `users.list` fired two separate calls. **`POST /api/data/batch`** (`[{source, params}]` in, results array out, one transaction) exists for a composite needing several sources at once — `useDataSourceBatchQuery` calls it and seeds each result into the same per-source cache key, so it interoperates with the two hooks above rather than being a separate caching mechanism.

### 7.4 Action DSL

```ts
type ActionSpec =
  | { kind: "navigate"; to: string }
  | { kind: "mutation"; mutation: string; input: BindExpr }   // named, server-authorized
  | { kind: "openModal" | "openDrawer"; page: string }
  | { kind: "aiPrompt"; preset: string; context?: BindExpr }
  | { kind: "download"; export: string };
```

Mutations are **named, server-registered, permission-checked** operations — never raw writes in the manifest.

**As built (performance audit, CONTEXT.md §47): `Renderer` is wrapped in `React.memo`, keyed on `node` reference identity, and `renderChild` is a stable module-level function, not recreated inline every render.** Before this, any unrelated re-render higher in the tree (e.g. a sibling `FilterBar`'s local state) cascaded into re-validating (Zod `.parse()`) and re-rendering every visible node in the whole subtree below it — `node`'s identity is stable across such re-renders since the fetched page tree is held in state as-is, making this a safe, effective memo key.

### 7.5 The renderer

```tsx
function Renderer({ node }: { node: UINode }) {
  const entry = registry.get(`${node.type}@${node.version}`);
  if (!entry) return <UnknownNodeFallback node={node} />;      // graceful degrade during rollouts
  const props = entry.schema.parse(node.props ?? {});           // Zod at the boundary
  return (
    <NodeErrorBoundary id={node.id}>                            // one bad widget ≠ blank workspace
      <entry.Component {...props} bind={node.bind} actions={node.actions}
        renderChild={(c) => <Renderer key={c.id} node={c} />} />
    </NodeErrorBoundary>
  );
}
```

Baked-in guarantees: **Zod-validated at the boundary**, **per-node error boundary**, **graceful unknown-node fallback**.

### 7.6 Security invariants

1. Permission pruning is **server-side at compile time** — never trust the client to hide.
2. Bindings & actions are **named references** to server-authorized operations.
3. Every data source enforces **tenant + data-scope** independently of RLS.
4. Manifests are **read-only to the client**; authoring goes through separate, permission-gated admin endpoints.

### 7.7 Worked example — Nurse dashboard

(Revenue widget is *pruned* — the Nurse lacks `finance:read`.)

```jsonc
{ "id": "page.dashboard", "type": "Page", "version": 1, "children": [
  { "id": "hdr", "type": "Heading", "version": 1, "props": { "text": "Good morning, {{user.firstName}}" } },
  { "id": "kpis", "type": "Grid", "version": 1, "props": { "cols": 3 }, "children": [
    { "id": "k1", "type": "KpiCard", "version": 1, "props": { "label": "My Patients" },
      "bind": { "source": "patients.count", "params": { "assignedTo": { "ref": "user.id" } } } },
    { "id": "k2", "type": "KpiCard", "version": 1, "props": { "label": "Open Tasks" },
      "bind": { "source": "tasks.count", "params": { "status": { "const": "open" } } } }
  ]},
  { "id": "tbl", "type": "Table", "version": 2, "props": { "columns": ["name","room","status"] },
    "bind": { "source": "patients.list", "paginate": true },
    "actions": [ { "kind": "navigate", "to": "page.patient-detail" } ] }
]}
```

### 7.8 WorkspaceSidebar — recursive nav rendering *(as built, Sidebar Navigation Phase 1)*

`apps/web/src/ui/WorkspaceSidebar.tsx` replaces what was, through Stage 12, a flat, non-recursive inline `<nav>` block in `apps/web/src/app/workspace/layout.tsx` — `NavItem.children` existed in the schema and was already pruned server-side (§6.9) but was a dead field on the client. The new component renders the manifest's `navigation` tree at arbitrary depth with **zero role/permission conditionals** — per §7.6's invariant #1, it only ever receives an already-pruned tree and has no way to know or check what a user is allowed to see.

- **Leaf vs. group is a pure function of the node's own shape**: `pageId` present → a real link, active-highlighted by exact `pathname` match; `pageId` absent + `children` present → an expand/collapse toggle button, never a link.
- **⚠️ As built (performance pass 2, CONTEXT.md §48): the leaf link is `next/link`'s `<Link>`, not a plain `<a href>` — this was a real, load-bearing bug, not a style choice.** A leaf originally rendered a plain `<a href>` with no `preventDefault`/`router.push`, so every click was a full browser navigation: the entire React tree (including `WorkspaceLayout`, which owns the `bootstrap` fetch) tore down and remounted from scratch, on top of whatever the target page's own data cost. Confirmed directly (a `window` global set after landing on a page vanished after clicking a sidebar link — only a hard navigation does that) and measured at several seconds per click, on every click, including revisits to a page seen seconds earlier — against a production build, not a dev-mode artifact. `<Link>` renders an `<a>` under the hood (same classNames/props, zero visual change) but is intercepted for a real client-side transition, and prefetches the target route's JS bundle for free. **If a future nav-adjacent surface ever needs a link to another in-app route, use `<Link>` — a plain `<a href>` to an internal route is exactly this bug's shape.** Also gained an `onMouseEnter` hover-intent prefetch (`onHoverIntent` prop, wired to `layout.tsx`'s `prefetchPage`): fetches the target page's tree ahead of a click and walks it (`collectSourceBindings` in `use-data-binding.ts`) to prefetch every blueprint-bound primitive's data too — not a composite's own internal reference-data fetches, which aren't expressed as a `bind` on any node and so aren't statically discoverable.
- **A group containing the currently-active page stays visually expanded regardless of manual toggle state** — you cannot collapse the group whose page you're viewing. Implemented as `expanded.has(id) || containsActiveHref(item)`, not as a one-time effect, so it recomputes correctly on every navigation without stale state.
- **Collapsed (icon-only) rail mode degrades the same way the old flat list did**: no new JS branch — labels, chevrons, and expanded children containers all carry the same `collapsed && "md:hidden"` pattern every leaf already used, so the desktop rail and the mobile drawer (which ignores `collapsed` entirely, being `md:`-scoped) render correctly from one code path.
- **`apps/web/src/ui/nav-tree.ts`'s `flattenNavItems`** (depth-first, every node) is shared by three consumers that each used to assume a flat top-level array and would have silently broken once real pages moved into nested groups: `WorkspaceSidebar`'s own active-state check, `layout.tsx`'s Cmd/Ctrl+K `commandItems` (now filtered to items with a defined `pageId` — pure groups aren't navigable), and `QuickActions.tsx`'s client-side visibility cross-check (§7.6 note: this check exists because `QuickActions` items are static blueprint data with no server-side pruning of their own, unlike `manifest.navigation`).

---

## 8. Data Model

### 8.1 Platform core (tenant-scoped unless noted)

| Table | Notes |
|---|---|
| `tenants` | org record; `industry`, `blueprint_version`, `plan_id`, `branding`, `status`. **As built:** also a globally unique `workspace_id` (app-enforced, not `NOT NULL` — see §5.1), `updated_at` (folds into the manifest etag once `branding` became editable, §6.7), and **`profile`** (Company Administration, Submodule A — company description/website/contactEmail/address/timezone/structured per-weekday businessHours; same untyped-JSON-bag treatment as `branding`, exposed on the manifest's `tenant.profile`). `branding` also gained an optional `logoUrl` alongside `accentColor` (see §6.3a below for the upload mechanism). *(root, not tenant-scoped)* |
| `users` | linked to Supabase Auth user (`auth_user_id`); `tenant_id`, `email`, `display_name`, `department_id`/`team_id` (org placement — which department/team this person belongs to). **As built:** also `job_title`, `employment_status`, `start_date` (all nullable) — every `User` row *is* an employee 1:1 by construction; no separate `Employee` table. **As built (performance audit, CONTEXT.md §47):** `@@index([tenantId, departmentId])` added — confirmed genuinely missing by reading the actual schema, not assumed; won't move any number at today's real-tenant row counts, added anyway since department-scoped queries already filter on it. |
| `departments` | hierarchy; self-referencing `parent_id`. **As built:** cosmetic hierarchy only — scope checks (§5.3) do exact `department_id` equality, not ancestor-aware matching; a parent department's manager does not automatically see a child department's data. **As built (Company Administration, Submodule C):** also nullable `archived_at` — reversible exclusion from default listings/pickers, distinct from a hard delete (§9.1's HR row). `parent_id` is `ON DELETE SET NULL` (confirmed from the actual migration SQL, not assumed) — deletion is therefore hard-blocked at the application layer, not left to the DB. |
| `teams` | belong to departments. **As built:** also nullable `archived_at` (same reversible-archive treatment as `departments`, above). `department_id` is `ON DELETE RESTRICT` (DB-protected); `users.department_id`/`users.team_id` carry **no FK constraint at all** — both deletion paths are therefore app-layer-blocked, not DB-enforced, for a real reason (not an oversight). |
| `roles` | `id`, `label`, `permissions` (a fully **resolved, flat** grant list — see below), `source_blueprint_role_id` (lineage back to the blueprint role this was materialized from), `extends_role_id`. Blueprint-seeded (tenant-custom role authoring is a real, not-yet-built future capability). **As built:** `extends_role_id` records lineage for auditability but is **not** read at permission-check time — a role's `permissions` is always the already-flattened result of resolving its blueprint definition's `extends` chain once, at materialization time (§5.4). Re-synced (missing roles created, existing ones' permissions refreshed) on every blueprint deploy, tenant by tenant. |
| `role_assignments` | user ↔ role, optional `department_id`/`team_id` scope column (reserved — not yet factored into permission resolution; every assignment today is effectively tenant-wide). |
| `blueprints` | platform-level (not tenant-scoped); versioned industry configs. **As built:** `updated_at` folds into the manifest etag (§6.7) — a version *number* bump is not required for a content edit to be reflected. |
| `tenant_configs` | Layer-2 overrides per tenant; versioned, `is_active` flag. **As built, hard invariant:** a change always inserts a new row and deactivates the old one — never an in-place `UPDATE` of `overrides` (§6.3). |
| `plans` / `entitlements` | plan → unlocked modules/features. |
| `feature_flags` | per-tenant overrides. |
| `notifications` | in-app notification store — `type`, `title`, `body`, `data` (JSON, e.g. `{taskId, projectId}`), `read_at`. **As built:** no permission gate of any kind — every query filters by `user_id = ctx.userId` directly; ownership *is* the authorization, there's no role-based question to answer for "can I read my own notification." |
| `audit_logs` | append-only; every sensitive action. *(Schema exists; full write-path coverage is still partial — see §13.)* |
| `documents` | metadata; files in Supabase Storage. **As built (Core Workspace Modules, Phase 2, Submodule 1) — see §8.2 for the full record.** |
| `embeddings` | pgvector; tenant-scoped RAG chunks. **As built (AI Assistant, Phase B: Embeddings/RAG, CONTEXT.md §59) — see §8.2 for the full record.** |

### 8.2 Module tables (as built so far)

| Table | Notes |
|---|---|
| `projects` | `name`, `description`, `status` (free-text UI vocabulary, not a DB enum), `owner_id` (creator — nullable), `department_id`, soft-delete. **As built (performance audit, CONTEXT.md §47):** `@@index([tenantId, ownerId])`/`@@index([tenantId, departmentId])` added, same reasoning as `users`' index above. |
| `project_members` | **As built** — many-to-many `project_id` ↔ `user_id`, the explicit "Admin assigns one or more Members to a project" mechanism (§9.1), independent of both `owner_id` and `department_id`. Unique on the pair. |
| `tasks` | `project_id` (FK), `title`, `description`, `status` (free-text UI vocabulary: `todo`/`in_progress`/`done`, not a DB enum), `assignee_id` (nullable — Task's stand-in for "own" scope, since it has no `owner_id` column), `priority`, `due_date`, soft-delete. **As built (performance audit, CONTEXT.md §47):** `@@index([tenantId, assigneeId])` added, same reasoning as `users`'/`projects`' indexes above. |
| `comments` | **As built (Core Workspace Modules, Phase 1, Comments & Mentions, CONTEXT.md §49):** `entity_type` (`"project"` \| `"task"`, free-text vocabulary, not a DB enum) + `entity_id` with **no FK** — a genuinely polymorphic target, same no-FK treatment already accepted for `users.department_id`/`team_id`/`manager_id`; scope is enforced at the application layer via `assertCommentTargetInScope`, reusing `projectsWhere`/`tasksWhere` directly rather than duplicating scope logic. `author_id`, `body`, soft-delete (`deleted_at`, matching `projects`/`tasks`). |
| `comment_mentions` | **As built (same submodule):** `comment_id` (FK) ↔ `user_id`, unique on the pair. Populated from client-resolved `mentionedUserIds`, validated server-side against the commented-on project's membership (owner + `project_members`); invalid ids and self-mentions are silently dropped, not hard-errored. Each valid mention fires one `notifications` row (`type: "comment.mention"`) in the same transaction as the comment — the first extension of the `Notification` model beyond Tasks. |
| `conversations` | **As built (Core Workspace Modules, Phase 1, Submodule 2: Channels & DMs, CONTEXT.md §50):** `type` (`"channel"` \| `"dm"`, free-text vocabulary) — one model for both rather than two parallel schemas, since a DM is just a private, unnamed, 2-member conversation. `is_private` (channels only), `created_by_id`, reversible `archived_at` (same precedent as `departments`/`teams`). Carries both the standard GUC-based `tenant_isolation` policy **and** a second, JWT-based `realtime_membership` policy — see §4's "As built" note for why Realtime needs its own policy shape. |
| `conversation_members` | **As built (same submodule):** membership + `last_read_at` (unread-count basis, same shape as `notifications.read_at`). Unique on `(conversation_id, user_id)`. Its own `realtime_membership` policy queries this same table from inside `EXISTS`, which is self-recursive (`42P17`) unless routed through a `SECURITY DEFINER` helper function (`is_conversation_member`) that bypasses RLS internally — `conversations`/`messages`' policies never had this problem, since they reference `conversation_members` from a *different* table. |
| `messages` | **As built (same submodule):** `conversation_id` (FK), `author_id`, `body`, soft-delete. First real cursor pagination in this codebase (`messages.list`'s `before` param) — the manifest schema's `paginate: boolean` field had never been implemented anywhere before this. **⚠️ `INSERT` `postgres_changes` events on this table are not delivered by this Supabase project's Realtime service** (confirmed via exhaustive elimination — fresh JWT, fully-open RLS, `REPLICA IDENTITY FULL`, 100+ second wait, all ruled out; `DELETE` events deliver correctly, proving the pipeline otherwise works) — `messages.list` polls (`refetchInterval`) as the actual delivery mechanism. |
| `meetings` | **As built (Core Workspace Modules, Phase 1, Submodule 3: Meetings, CONTEXT.md §51; video vendor swapped Daily.co → self-hosted Jitsi, CONTEXT.md §52):** `title`, `description`, `organizer_id`, `department_id` (nullable, visibility-widening only — see §5.3-style scope note below), `scheduled_start`/`scheduled_end`, `video_room_name` (deliberately vendor-neutral — no stored URL; a join URL is `{domain}/{roomName}`, computed client-side from one shared env var, anticipating a further vendor swap later), reversible `cancelled_at` (binary, same precedent as `conversations.archived_at`, not a free-text status). Only the standard GUC-based `tenant_isolation` policy — no Realtime policy needed, since the video vendor owns live in-call state, not this DB. |
| `meeting_participants` | **As built (same submodule):** many-to-many `meeting_id` ↔ `user_id`, mirrors `project_members` exactly. This is the entire visibility floor for `meetings.list` (`meetingsWhere`): every participant always sees a meeting they organize or were added to regardless of RBAC tier — a deliberate divergence from `projectsWhere`'s stricter "zero grant → zero visibility" shape, confirmed with the user during planning, since meeting participation reads closer to a calendar invite than to project authority. `meeting:read:<scope>` only widens visibility further. |
| `announcements` | **As built (Core Workspace Modules, Phase 1, Submodule 4: Announcements, CONTEXT.md §54):** `author_id`, `department_id` (nullable — `null` means tenant-wide, only postable with a `:tenant`-scoped grant; non-null targets that department's full descendant subtree), `title`, `body` (plain text, `whitespace-pre-wrap` — no markdown anywhere in this codebase), soft-delete (`deleted_at`, author-only). Standard GUC-based `tenant_isolation` policy only, shipped in the same migration as the table. Read visibility is **not** RBAC-widened (no `announcement:read:<scope>`) — it's structural: a reader sees a post iff its `department_id` is `null` or appears in the reader's own ancestor chain (`getDepartmentAncestorIds`, the read-side inverse of `getDepartmentSubtreeIds`, walking `parent_id` up instead of down). Posting audience resolution walks the opposite direction (`getDepartmentSubtreeIds` on the *target*, down) to fire one batched `notifications.createMany` per post — never a sequential loop, given the audience can be a whole subtree or the entire tenant. |
| `documents` | **As built (Core Workspace Modules, Phase 2, Submodule 1: Project Documents, CONTEXT.md §56):** `project_id` (FK, required — a Document always belongs to exactly one Project, no standalone/tenant-wide documents), `name`, `storage_path` (a bucket-relative key in the private `documents` Storage bucket — no FK, no public URL; every read goes through `document.getFileUrl`'s authorization check), `mime_type`, `size_bytes`, `version` (current version number, live), `approval_status` (nullable free-text: `null`/`"pending"`/`"approved"`/`"rejected"`, same treatment as `Task.status`), `uploaded_by_id`, soft-delete. **Visibility is entirely derived from the parent Project's own visibility** (`projectsWhere`, reused directly) — no `document:read` permission triple exists at all, per `ORG_HIERARCHY.md` §12. Standard GUC-based `tenant_isolation` policy only. |
| `document_versions` | **As built (same submodule):** one row per version that's no longer current, snapshotted by `document.finalizeReplace` from the `documents` row's own live fields *before* they're overwritten with the new version's data — the current version is never duplicated here, only found on `documents` itself. Its own `storage_path` always points at a distinct Storage object from the current version's (replace mints a fresh upload path, never upserts in place), so no past version's file is ever orphaned. |
| `document_activities` | **As built (same submodule):** a lightweight lifecycle log (`type`: `uploaded`/`replaced`/`renamed`/`approval_status_changed`/`deleted`), one row per event, written inside the same transaction as the triggering mutation. Deliberately excludes comments — those already have their own list/UI via the polymorphic `comments`/`comment_mentions` tables (`entity_type = "document"`, added this submodule), not duplicated into this feed. |
| `ai_conversations` | **As built (AI Assistant, Phase A: Provider Abstraction + Basic Chat, CONTEXT.md §58):** `user_id` (the one owner — no membership table, unlike `conversations`/`conversation_members`, since an AI conversation is always personal), `title` (nullable, auto-generated from the first ~50 characters of the first message), `preset`/`context_ref` (both always `null` in Phase A — plumbed through for a future `aiPrompt`-launched, module-aware conversation, not yet populated by anything), reversible `archived_at`. Ownership-gated (`user_id = ctx.userId`) exactly like `notifications` — no RBAC triple. Standard GUC-based `tenant_isolation` policy only; deliberately no JWT-based Realtime policy (see §4's Realtime note) — AI message delivery is request/response, not a live subscription. |
| `ai_messages` | **As built (same submodule):** `role` (`"user"` \| `"assistant"` — no `"tool"` role until real tool-calling ships in a later phase), `content`, `usage` (JSON: `{inputTokens, outputTokens}`, raw per-turn token counts — the seam a future cost-tracking rollup table would aggregate, not built yet). The completion call itself runs entirely inside the triggering mutation's `preResolve` (never inside the transaction `resolve()` runs in — see §8.3's `preResolve` note, extended this submodule to receive `authUserId` specifically so it can authorize a conversation-ownership check before including private history in a request sent to a third-party model). **As built (AI Assistant, Phase B, CONTEXT.md §59): `ai_conversations.preset`/`context_ref`, dormant since Phase A, are now genuinely populated** — set from `aiConversation.create`'s new optional input, read back by `aiMessage.send`'s retrieval step to narrow which document's chunks Stage 1 searches. |
| `embeddings` | **As built (AI Assistant, Phase B: Embeddings/RAG, CONTEXT.md §59):** `source_type`/`source_id` (polymorphic target — `"document"` only so far, same no-FK treatment as `comments.entity_type`/`entity_id`), `chunk_index`, `content` (the chunk's raw extracted text), `content_hash` (sha256 — the re-embed-on-change gate, skips unchanged chunks on a re-run), `embedding` — **`Unsupported("vector(3072)")`**, since Prisma has no native pgvector type; excluded from the generated client entirely, all reads/writes go through raw SQL. 3072 = `gemini-embedding-001`'s full, untruncated output (Matryoshka truncation to 768/1536 requires manual re-normalization to stay correct — avoided entirely by using the full dimension). Unique on `(tenant_id, source_type, source_id, chunk_index)`. No ANN index (`hnsw`/`ivfflat`) yet — a sequential scan is fine at today's row counts, flagged as future work once volume justifies it. Standard GUC-based `tenant_isolation` policy only. |
| `embedding_jobs` | **As built (same submodule):** this codebase's first outbox-pattern table — `document.create`/`document.finalizeReplace` enqueue a row here (mirroring `logActivity`'s existing plain-function shape) instead of embedding inline, since embedding calls are external I/O that must never run inside a mutation's own transaction. `status` (`pending`/`processing`/`done`/`failed`), `attempts`, `last_error`, `available_at` (exponential-backoff retry scheduling, capped at 5 attempts). Polled every 15s by `EmbeddingJobProcessorService` — this codebase's first `@nestjs/schedule` consumer — via a per-tenant round-robin (`tenantPrisma.root.tenant.findMany` then one `tenantPrisma.run()` per tenant), since RLS requires `app.tenant_id` set per call and no single query can see every tenant's due jobs at once. |

Each module owns its own tables (this pattern extends to `crm_contacts`, `crm_deals`, `calendar_events`, `leave_requests`, … as those modules are built), all carrying `tenant_id` + RLS. HR/org-placement lives on the platform-core `users`/`departments`/`teams` tables above rather than a separate module table, since every tenant needs it regardless of industry.

### 8.3 Conventions

- `tenant_id uuid not null` + composite indexes leading with `tenant_id` on all tenant tables.
- `id uuid default gen_random_uuid()`, `created_at`, `updated_at`, soft-delete `deleted_at` where relevant.
- RLS enabled on **every** tenant-scoped table, keyed on a Postgres session GUC (`current_setting('app.tenant_id')`) set per-request by the API — **not** `auth.jwt()` (the API connects via a direct Postgres connection through Prisma, not Supabase's Data API, so a JWT-claim-based policy would be silently inert). Two DB roles: an elevated migration role (`BYPASSRLS`, used only by `prisma migrate`/seed scripts) and a restricted runtime role (`NOBYPASSRLS`) the running application always connects as — RLS is decorative if the app itself can bypass it, so this separation is load-bearing, not incidental.
- **As built:** a single mutation/data-source resolver call runs inside one Prisma interactive transaction (one reserved connection) — any two or more queries within it must be sequential `await`s, never issued concurrently (e.g. via `Promise.all`). This is a real Prisma constraint, not a style preference; violating it corrupts the transaction's connection state unpredictably rather than failing immediately at the call site.
- **As built (performance audit, CONTEXT.md §47): this same "sequential awaits, one transaction" pattern is now applied *across* call boundaries, not just within a single resolver.** `data-sources.controller.ts`/`mutations.controller.ts` used to call `CurrentUserService.get()` and `PermissionResolverService.resolveEffectivePermissions()` as two more separate transactions *before* the actual resolver's own — three transactions total for one HTTP call. Both services gained a `*WithTx(tx, ...)` variant that shares an already-open transaction instead of opening its own; the controllers now open exactly one transaction and run all three steps as sequential awaits inside it. Same reasoning applies to `ConfigEngineService.resolveIdentity()` (2 of its own transactions merged to 1) and the elimination of a real duplicate: `WorkspaceController` used to call `getEtag()` then, on a cache-miss, `compileWorkspace`/`compilePage` — each independently re-resolving identity from scratch. `ConfigEngineService.getIdentity()` is now the one call per request; its `WorkspaceIdentity` result is threaded into `compileWorkspace(identity)`/`compilePage(identity, pageId)` directly. **Measured impact against the real remote DB (~150ms/round-trip, ~600ms per transaction wrapper): bootstrap cold load ~6.0s → ~4.2s, a single data-source call ~2.2-3.0s → ~1.4-2.6s** — see CONTEXT.md §47 for the full before/after table and what this pass deliberately left unfixed (a concurrent-load finding on composites' multi-data-source fan-out, `compilePage`'s full-blueprint pruning cost). **This is not a move to one long-lived transaction per HTTP request** — each of the above is still a short, single-request-scoped transaction opened via `TenantPrismaService.run()`; only the *count* of separate transactions per request dropped, never the "short transaction per pooled connection" model itself.
- **As built (performance pass 2, CONTEXT.md §48): `POST /api/data/batch`** (`data-sources.controller.ts`) extends this same pattern across *sources*, not just across the current-user/permission-resolution steps. `[{source, params}]` in, executed as sequential awaits inside the one transaction, `{data?, error?}[]` out in the same order — a per-item failure (unknown source, missing permission) doesn't reject the whole batch. **Must be registered before the single-source `:source` route** in the controller, or Nest's router matches `POST /api/data/batch` as `:source = "batch"` — verified live (a genuine risk with this route shape, not a hypothetical one). Measured: 4 sources bounded to ~2.6s combined, down from ~7-8s summed as 4 separate calls, each paying its own transaction-wrapper tax.
- **As built (Meetings, CONTEXT.md §51): `MutationDefinition` gained optional `preResolve`/`rollbackPreResolve` hooks, closing a gap this section previously left open** — every mutation's `resolve()` ran entirely inside one `tenantPrisma.run()` transaction, with no way to do "external I/O, *then* open the transaction, roll back the I/O if the transaction fails." (`user.invite`'s Resend call previously had to sit *inside* the transaction, once blowing its 5s default timeout under a slow rejection.) `mutations.controller.ts` calls `def.preResolve?.(input, {tenantId, authUserId})` *before* opening the transaction, threads its result into `resolve(input, ctx, tx, pre)` as an optional 4th argument, and — if the transaction subsequently throws — calls `def.rollbackPreResolve?.(pre)` (best-effort, logged, never rethrown) before rethrowing the original error. **As built (AI Assistant Phase A, CONTEXT.md §58): `preResolve`'s context gained `authUserId`** (the controller already resolved it before this call, it just wasn't threaded through) — closing a real gap where a `preResolve` needing an *authorized* read before its external call (e.g. confirming a resource is owned by the caller before sending its content to a third-party LLM) had no way to do that read at all, since `{tenantId}` alone can't express "and scoped to this specific user." Additive, backward-compatible — no existing `preResolve` implementation needed to change. A mutation needing this is a factory function taking the external service as a constructor-injected dependency, same as `createUserInviteMutation`'s existing `SupabaseAdminService`/`EmailService` pattern — new external-service wrappers live under `apps/api/src/integrations/`. `pre` is optional at the *type* level specifically so it's backward compatible with every mutation that doesn't use it. **As built (video vendor swap, CONTEXT.md §52): `meeting.create`'s original motivating use case (Daily.co's room-creation REST call) is gone** — self-hosted Jitsi has no equivalent step, so `meeting.create`/`meeting.cancel` reverted to plain constants. The hooks themselves are left in place, unused today, as general-purpose infrastructure for whatever mutation needs "external I/O before the transaction" next.

---

## 9. Module Architecture (Plugin Pattern)

A **module** is a self-contained unit that plugs into the platform through fixed contracts. Adding a module never requires editing the core renderer or engine.

A module registers:

1. **Data model** — its Prisma models/migrations (tenant-scoped).
2. **Data sources** — named, authorized read queries (`patients.list`, `tasks.count`).
3. **Mutations** — named, authorized writes (`task.create`).
4. **Permissions** — the `resource:action:scope` triples it defines.
5. **Composite widgets** — registered into both FE and BE registries (e.g. `ProjectBoard`).
6. **Blueprint contributions** — default nav/pages/dashboards/roles it adds to industry blueprints.
7. **Entitlement key** — the feature flag that gates it.

```ts
interface ModuleDefinition {
  key: string;                       // "projects"
  permissions: PermissionDef[];
  dataSources: DataSourceDef[];
  mutations: MutationDef[];
  composites: CompositeWidgetDef[];  // server descriptors; FE registers matching components
  blueprintFragments: BlueprintFragment[];
  entitlementKey: string;
}
```

The NestJS app assembles the active module set at boot; the frontend ships the matching composite components in its registry.

**As built — a deliberately lighter-weight realization of this pattern, not the full `ModuleDefinition` shape above.** Each module is a plain NestJS module with a small `*Registrar` (`OnModuleInit`) that calls `.register()` on two `@Global()` singletons — `DataSourceRegistry` and `MutationRegistry` — for each named source/mutation it owns; blueprint contributions (nav/pages/roles/permissions) live directly in the seeded blueprint fixture rather than a separate per-module manifest object; entitlement keys exist (§10) but aren't yet wired to every module. The full `ModuleDefinition` interface remains the target shape once enough modules exist that a heavier plugin system earns its complexity — not needed yet with the module count built so far.

### 9.1 Modules built so far

| Module | Data sources | Mutations | Composite(s) | Notes |
|---|---|---|---|---|
| **Projects** | `projects.list`, `projects.count`, `projects.statusBreakdown` | `project.create`, `project.update`, `project.delete`, `project.addMember`, `project.removeMember` | `ProjectBoard` | **As built:** `project.addMember`/`removeMember` are the explicit Admin-assigns-Members-to-a-project workflow, via the `project_members` join table (§8.2) — independent of both project ownership and department match, one of three ORed ways a project can be in a Member's scope (§5.3). |
| **Tasks** | `tasks.list`, `tasks.count` | `task.create`, `task.updateStatus`, `task.reassign` | `TaskList` | **As built:** `task.reassign` (changing `assigneeId` after creation) was added later — `task.updateStatus` only ever changes `status`. Both creation and reassignment require the assignee to actually be a project member (§5.6). |
| **HR (org placement)** | `departments.list`, `teams.list` (both `includeArchived?` param, Submodule C), extends `users.list` | `department.create`, `department.update`, `department.setArchived`, `department.delete`, `department.assignHead`, `team.create`, `team.update`, `team.moveToDepartment`, `team.setArchived`, `team.delete`, `team.assignManager`, `user.assignDepartment` | `OrgStructure` | Makes `departments`/`teams`/org-placement — schema present since Phase 1, unused until this module — actually usable. `department.create`/`team.create` are scope-aware (§5.6): Department Head can create teams only within their own department, and cannot create departments at all. **As built (Company Administration, Submodule C):** full lifecycle added — edit, reversible archive (`archived_at`), app-layer-blocked delete (rejects with a specific "still has N teams/M users" message rather than a generic conflict), move-team-between-departments, and department-head/team-manager assignment. Head/manager assignment resolves the correct role via `DepartmentTypeRoleLabel` overrides first (so an HR-typed department's manager gets `role.hr-manager`'s real bonus grants, not the generic tier role) and never delegates to `user.assignDepartment`'s own resolver (that mutation's `"own"`-scope check would wrongly reject an Executive assigning outside their exact department but within their subtree). Reparenting (`department.update`'s `parentId`) is cycle-checked via `getDepartmentSubtreeIds` before the write. |
| **Users / Team management** | `users.list`, `roles.list` | `user.invite`, `user.changeRole`, `user.assignDepartment` | `TeamMembers` | **As built:** `user.invite` creates the person (no email delivery yet — a generated one-time password is shown once in the UI and never persisted in our own database); `user.changeRole` (promote/demote an existing user) is hierarchy-aware (§5.5). |
| **Settings** | *(reads via `useBootstrap()`, no dedicated data source)* | `tenant.updateBranding` (+`logoUrl`), `tenant.updateWorkspaceId`, `workspaceConfig.updateNavigationLabel`, `tenant.updateProfile`, `tenant.createLogoUploadUrl` | `WorkspaceSettings` | The first real UI over Layer-2 `TenantConfig` overrides (§6.3). Visible to every tenant member (read-only sections for non-Admins); edit controls presence-gated per mutation. **As built (Company Administration, Submodule A):** company profile/timezone/business-hours cards + logo upload, all following the same universal-read/gated-edit split as the original cards — see §6.3a for the upload mechanism. |
| **Notifications** | `notifications.list`, `notifications.unreadCount` | `notification.markRead`, `notification.markAllRead` | `NotificationBell` (fixed shell chrome, not a blueprint-bound composite) | Poll-based (§12), no permission gate (ownership is the authorization). Emitted inline, inside the same transaction as the triggering mutation (task assignment, task reassignment to a non-actor) — not a separate event bus. |
| **Comments** | `comments.list` (`{entityType, entityId}`) | `comment.create`, `comment.delete` | `CommentThread` (plain shared component, not blueprint-registered — mounted per-row by `TaskList`/`ProjectBoard` behind an expand toggle, since a per-row thread can't be expressed as a static blueprint node) | **As built (Core Workspace Modules, Phase 1, Comments & Mentions, CONTEXT.md §49):** no static `requiredPermission` on either data source or `comment.create` — `assertCommentTargetInScope` reuses Projects'/Tasks' own `*Where` scope helpers directly, so anyone who can already see a Project/Task can comment on it. `comment.delete` is ownership-only (mirrors `notification.markRead`'s precedent), zero permission gate. Mentions are client-resolved (`mentionedUserIds: string[]`, validated server-side against project membership), not parsed from free text. |
| **Chat** | `conversations.list`, `channels.list`, `messages.list` (`{conversationId, before?}` — first cursor pagination in this codebase) | `conversation.createChannel`, `conversation.createDm`, `conversation.addMember`, `conversation.archive`, `message.send`, `message.delete`, `conversation.markRead` | `ChatWorkspace` (blueprint-registered, unlike `CommentThread` — a whole two-pane chat UI is a real top-level page, not a per-row expansion) | **As built (Core Workspace Modules, Phase 1, Submodule 2: Channels & DMs, CONTEXT.md §50):** membership is the scope, no permission triples. `conversation.addMember` handles both "invite someone else" (requires existing membership) and "self-join a public channel" (no static permission either way) in one mutation. `conversation.createDm` is idempotent. First use of Supabase Realtime in this codebase — see §4's "As built" note for the RLS/GRANT mechanics this required, and the confirmed, disclosed limitation (Realtime never delivers `INSERT` events in this project) that makes `messages.list`'s poll the actual delivery guarantee, not the Realtime subscription. |
| **Meetings** | `meetings.list`, `meetings.inviteCandidates` (gated on `meeting:create`, not `user:manage` — see notes) | `meeting.create`, `meeting.cancel`, `meeting.addParticipant`, `meeting.removeParticipant`, `meeting.getJoinInfo` | `MeetingsWorkspace` (blueprint-registered) + `JitsiCallFrame` (plain shared component, not registered — mounted conditionally as a full-viewport overlay when a call is active) | **As built (Core Workspace Modules, Phase 1, Submodule 3: Meetings, CONTEXT.md §51; video vendor swapped Daily.co → self-hosted Jitsi, CONTEXT.md §52):** only `meeting.getJoinInfo` is still a factory, taking an injected `JitsiService` (§9's external-service pattern, `apps/api/src/integrations/`) — `meeting.create`/`meeting.cancel` are plain constants again, since self-hosted Jitsi has no REST "create a room" step the way Daily.co did, so the `preResolve`/`rollbackPreResolve` hooks (§8.3) they originally used are no longer needed there (left in place as general infrastructure, not ripped out). Scheduling authority is RBAC-shaped (`meeting:create:<scope>`); join/manage is membership-only (`assertMeetingParticipant`, mirrors `assertConversationMember`); own-list visibility is participant-floor-always-on (§8.2's `meetings`/`meeting_participants` note) — three distinct authorization shapes for three distinct questions, not one blended mechanism. `meetings.inviteCandidates` exists because `users.list` is gated on `user:manage`, which Lead/Manager tiers (who hold `meeting:create`) never get. |
| **Announcements** | `announcements.list` (no `requiredPermission` — same "visible to every tenant member" treatment as `nav.chat`/`nav.meetings`) | `announcement.create` (gated `announcement:create:<scope>`), `announcement.delete` (no `requiredPermission` — author-only ownership gate, mirrors `comment.delete`/`message.delete`) | `AnnouncementsWorkspace` (blueprint-registered) | **As built (Core Workspace Modules, Phase 1, Submodule 4: Announcements, CONTEXT.md §54):** both plain constants, no factory/injected service. Posting authority starts at Department Head (`:department`), not Lead — an announcement is an official broadcast, not team chat — then Executive (`:department-subtree`), then Company Admin/HR Manager (`:tenant`). Read visibility is structural, not a second RBAC triple: `announcementsWhere` matches `department_id IS NULL OR department_id IN (reader's own ancestor chain)` via the new `getDepartmentAncestorIds` helper (§8.2's `announcements` note). On post, the target's full descendant subtree (or the whole tenant) is resolved and notified via one batched `notifications.createMany` — never a sequential loop, the one place in this codebase so far where that choice was load-bearing rather than precautionary. |
| **Documents** | `documents.list` (`{projectId, search?}`, no `requiredPermission` — visibility is "can the actor see the parent project," reusing `projectsWhere` directly), `document.detail` (`{id}` → `{document, versions, activities}` in one consolidated call) | `document.createUploadUrl`/`document.create` (upload, gated `document:create:<scope>`), `document.update` (rename, gated `document:update`), `document.createReplaceUploadUrl`/`document.finalizeReplace` (new version, gated `document:update`), `document.setApprovalStatus` (gated `document:update` — no dedicated `document:approve` triple, a deliberate lightweight choice), `document.delete` (gated `document:delete`), `document.getFileUrl` (no `requiredPermission` — visibility-only, mirrors `meeting.getJoinInfo`) | `DocumentsPanel` (plain shared component, not blueprint-registered — same "mounted per-row behind an expand toggle" precedent as `CommentThread`, mounted inside `ProjectBoard`) | **As built (Core Workspace Modules, Phase 2, Submodule 1: Project Documents, CONTEXT.md §56):** every scope check is against the document's own parent Project's `{owner_id, department_id}` via `isRowInScope` — the exact same shape `tasks.mutations.ts`'s `requireTaskInScope` already uses, extended here to also validate root-level creation (a stricter check than `task.create`'s own existing precedent, which has no such validation). Tier ladder mirrors `project:create`/`update`/`delete` exactly (Lead → Manager → Department Head → Executive → Admin), not Announcements' restricted ladder. **Comments' `ENTITY_TYPES` gained `"document"`** (`comments.mutations.ts`) — `CommentThread` is reused completely unchanged for document comments. Storage: a new private `documents` bucket (25MB limit, fixed MIME allowlist), created via the same one-off-script pattern as the `logos` bucket (§6.3a) — `SupabaseAdminService` extended with `createDocumentSignedUploadUrl`/`createDocumentSignedUrl` alongside its existing logo methods. |
| **AI Assistant** | `aiConversations.list` (no `requiredPermission` — ownership-scoped), `aiConversation.messages` (`{conversationId, before?}`, cursor-paginated, mirrors `messages.list`'s precedent — returns `createdAt` DESC, reversed client-side for display) | `aiConversation.create` (`{preset?, contextRef?}` — Phase B), `aiConversation.archive`, `aiMessage.send` (`{conversationId, content}` — factory needing `AiProviderService` + Phase B's `EmbeddingProviderService`/`RetrievalService`/`PermissionResolverService`; the completion call, query embedding, and retrieval all run entirely in `preResolve`, never inside `resolve()`'s transaction) | `AiPanel` (plain shared component, not blueprint-registered — same "not in the SDUI primitive registry" precedent as `NotificationBell`/`CommandPalette`; shell-mounted in `WorkspaceLayout`, opened via a header trigger, `DocumentsPanel`'s two per-document buttons, or any `aiPrompt` action) | **As built (AI Assistant, Phase A: Provider Abstraction + Basic Chat, CONTEXT.md §58):** `AiProviderService` (`apps/api/src/ai/provider/`, `@Global()` via `AiModule`) is the one seam every AI-facing module talks to a completion model through — two `CompletionProvider` adapters exist (`AnthropicCompletionProvider`, `GeminiCompletionProvider`), selected via `AI_COMPLETION_PROVIDER` (Gemini active today, Anthropic the eventual target — a one-line env change, no code change). **As built (AI Assistant, Phase B: Embeddings/RAG, CONTEXT.md §59):** a parallel `EmbeddingProviderService` seam (`apps/api/src/ai/embeddings/`, `AI_EMBEDDING_PROVIDER`, Gemini's `gemini-embedding-001` only provider today) plus `RetrievalService` (`apps/api/src/ai/retrieval/`) implement the two-stage tenant+scope-safe retrieval §11 always specified — Stage 1 tenant-filtered pgvector query, Stage 2 mandatory re-check via `assertProjectVisible` (Documents' own visibility function, reused unchanged). Scoped only to Documents so far; Projects/Tasks/Meetings RAG remain later-phase work, each their own future submodule. |

---

## 10. Entitlements & Feature Flags

*(Entitlements now, Stripe deferred — approved.)*

- **Plans** map to a set of **entitlement keys** (unlocked modules/features).
- The Configuration Engine's Layer 3 filters the resolved config by entitlements *before* permission pruning — a locked module never reaches any user's manifest.
- **Feature flags** allow per-tenant overrides (early access, gradual rollout) layered over plan entitlements.
- **Seam for billing:** plan assignment is a single field on `tenants`; adding Stripe later means syncing subscription state → `plan_id`, with no changes to the engine.

---

## 11. AI / RAG Architecture

**As of 2026-07-31: this section's MVP scope was superseded by a full technical architecture** (design approved 2026-07-31 — full content in `CHANGELOG.md`'s "AI Assistant: full technical architecture approved" entry). That design extends, not replaces, everything below — pgvector, Claude as the default LLM, and the tenant-safe retrieval pattern in this section are all carried forward. What's new: a completion/embedding provider *split* (Anthropic has no embeddings endpoint, so embedding uses a separate provider, OpenAI by default), the "post-retrieval permission re-check" mandate below made concrete as a two-stage process reusing each module's own existing visibility functions, per-module AI adapters for Projects/Tasks/Meetings/Documents/Chat with an explicit seam for CRM/Analytics once those modules exist, confirm-before-execute natural-language commands (a genuine scope expansion beyond this section's original "no autonomous actions" line — the AI can now propose actions, never execute them unconfirmed), and a phased A-F implementation roadmap.

**As of 2026-08-01: Phase A (Provider Abstraction + Basic Chat) of that roadmap is built** — see CONTEXT.md §58 for the full as-built record and §9.1 below for the module row. As built, differs from the design in two disclosed ways: (1) tenant AI gating is a single global `aiAvailable` manifest flag (whether the platform operator configured a provider key at all), not `FeatureFlag`/`Plan.entitlements` — both confirmed non-functional in this codebase during Phase A's own research (`FeatureFlag` rows are fetched but consumed by no pruning logic anywhere; `Plan.entitlements` filtering is real and wired but `Tenant.planId` is never populated by anything, making it a permanent no-op) — per-tenant gating remains real future scope. (2) Two completion adapters shipped from Phase A itself (Anthropic and Gemini), not Anthropic alone as originally sequenced — a live scope change once a working Gemini key became available before an Anthropic one did.

**As of 2026-08-01: Phase B (Embeddings/RAG, scoped to Documents) of that same roadmap is also built** — see CONTEXT.md §59 for the full as-built record. The two-stage tenant-safe retrieval this section always specified (below, "Tenant-safe retrieval (critical)") is now real, not aspirational: Stage 1 is the tenant-filtered pgvector query described here; Stage 2 — the "post-retrieval permission re-check against the source record" this section already called for — is implemented as a mandatory per-candidate call to `assertProjectVisible`, Documents' own existing visibility function, reused completely unchanged (no new authorization path). Differs from the original design in the same disclosed-judgment-call spirit as Phase A: the embedding provider defaults to **Gemini** (`gemini-embedding-001`, full untruncated 3072-dim output), not OpenAI as originally sketched — no `OPENAI_API_KEY` exists in this project, and Gemini's own embeddings API covers the need without a third vendor relationship. Scoped to Documents only, per the roadmap's own "Deliverable: RAG Q&A over one real module" framing for this phase — Projects/Tasks/Meetings RAG, workspace-wide semantic search, and meeting-notes summarization remain Phase C, not yet started.

**Scope (original MVP, 2026-07-14):** RAG-grounded Q&A over workspace data + report/content generation. No autonomous actions.

### Pipeline

1. **Ingestion:** workspace records (tasks, projects, docs, CRM notes…) are chunked and embedded into the `embeddings` table (pgvector), **tagged with `tenant_id`** and source metadata. Runs on write (event-driven) and via backfill.
2. **Retrieval:** a query embeds the user's question and does a **tenant-scoped** vector search (`where tenant_id = :tenant` — enforced by RLS *and* explicit filter). Retrieval additionally respects the user's **data scope** (only chunks from records they may read).
3. **Generation:** retrieved context + question → **Claude API (latest models)** → grounded answer or generated report.
4. **Delivery:** surfaced via the `AiPanel` composite widget and `aiPrompt` actions in the manifest.

### Tenant-safe retrieval (critical)

Cross-tenant leakage via RAG is the classic failure. Mitigations: `tenant_id` on every embedding, RLS on the embeddings table, explicit tenant filter in the query, **and** post-retrieval permission re-check against the source record before context is sent to the model.

---

## 12. Notifications

*(In-app + email, poll-based — approved.)*

- Notifications persisted in the `notifications` table (tenant-scoped), surfaced via an in-app notification center (a composite widget).
- Important notifications also sent via a transactional **email provider**.
- **No websockets in MVP**; client polls / refetches. **Supabase Realtime** is the designated upgrade path for live notifications and presence later.

**As built:** in-app only so far (no email provider integrated yet — a real, documented scope cut, not an oversight). `NotificationBell` polls every 15s, hardcoded — fine at current scale, revisit if this needs to be tenant-configurable or push-based before Realtime lands. Two events emit a notification today: a task assigned to someone other than the actor (on both creation and reassignment), and a task's status changed by someone other than its assignee — a deliberately small starting set, not an exhaustive "every module notifies" mechanism; each new notification-worthy event is added as a plain call inside its triggering mutation's own transaction (atomic with the write for free), not a generic pub/sub layer, until enough call sites exist to justify one.

---

## 13. Audit Logging & Compliance

*(SOC 2 / GDPR-ready now, certify later — approved.)*

- **Append-only `audit_logs`**: actor, tenant, action, resource, before/after (where relevant), timestamp, IP/UA. Written for every sensitive mutation and access-control change.
- **Encryption:** at rest (Supabase) and in transit (TLS everywhere).
- **Data-subject controls (GDPR):** export and delete flows designed into the data model (soft-delete + hard-delete pathways).
- **Least privilege:** RBAC + RLS + data-source scoping.
- **HIPAA:** not targeted for MVP, but the tenancy/audit design does not preclude it; revisit when a healthcare customer requires a BAA.

**As built:** the `audit_logs` table/migration exists; write-path coverage (actually logging sensitive mutations) is not yet built out across the modules implemented so far — a real gap to close before this section's claims are fully true in practice, not just schema-ready. Soft-delete (`deleted_at`) is in active use (`Project`, `Task`, `User`); hard-delete/export flows for GDPR are not yet built.

---

## 14. Deployment & Infrastructure

| Concern | Approach |
|---|---|
| Frontend hosting | Vercel |
| API hosting | Railway / Render / Fly |
| Data | Supabase Cloud (Postgres + Auth + Storage + pgvector), single region to start |
| CI/CD | GitHub Actions → typecheck, lint, test, migrate, deploy |
| Secrets | Host-managed env vars; no secrets in repo |
| Observability | Structured logging, error tracking (e.g. Sentry), audit logs |
| Migrations | Prisma migrate, run in CI before deploy |

---

## 15. Security Threat Model

| Threat | Mitigation |
|---|---|
| Cross-tenant data access | `tenant_id` + Postgres RLS + app-layer scoping (defense in depth) |
| Privilege escalation | Server-side permission resolver; manifest pruning; per-call authorization |
| Client tampering with visibility | Prune-not-hide; unauthorized elements never sent |
| Injection via bindings | Named data sources/mutations only; param allow-lists; no raw SQL from client |
| RAG cross-tenant leakage | Tenant-tagged embeddings + RLS + explicit filter + post-retrieval permission re-check |
| Manifest tampering | Manifests read-only to client; authoring via separate gated endpoints |
| Broken widget → workspace outage | Per-node error boundaries; graceful unknown-node fallback |
| Auth attacks | Delegated to Supabase Auth (MFA, secure sessions, rate limiting) |
| **As built —** Role self-escalation via role-assignment | Hierarchy-aware assignment (§5.5): a role can only assign a role that's itself or an ancestor of its own `extends` chain; a user can never change their own role; only Company Admin can assign unrestricted |
| **As built —** Workspace/tenant enumeration at login | `POST /auth/verify-workspace` returns one generic rejection for every failure mode (wrong workspace, wrong email, nonexistent workspace) — never distinguishes them (§5.1) |
| **As built —** Stale cached manifest serving outdated permissions/content | Every mutable field that feeds the compiled manifest contributes a real change-timestamp to the etag, not just an owning row's version number (§6.7) — a lesson learned from a real recurring bug, not a preventive design that was never tested |
| **As built —** Orphaned third-party (Supabase Auth) accounts on a failed multi-step provisioning operation | Signup and invite both wrap the Postgres write in a transaction and explicitly roll back the just-created Supabase Auth user if the transaction fails — an external side effect the database's own rollback can't undo automatically |

---

## 16. Phased Roadmap

### Phase 1 — Vertical slice (prove the engine) — ✅ **complete**
One industry (**IT**), end to end:
- Supabase project, base schema, RLS, tenancy context. ✅
- Supabase Auth + signup → tenant provisioning → first Admin. ✅
- Permission resolver + RBAC tables. ✅
- Configuration Engine: blueprint loader, override applier, compiler, permission pruning. ✅
- Workspace Manifest schema (shared Zod) + bootstrap/page endpoints. ✅
- SDUI renderer + core primitive registry (layout/display/data subset). ✅
- **Two modules end to end: Projects + Tasks** (data model, data sources, mutations, composites, blueprint fragments). ✅
- In-app notifications (basic). ✅

Exit criterion met against a genuinely fresh, reset database: signup → blueprint-derived workspace with zero hardcoded pages → project created → task created and assigned → notification fired → role-based pruning confirmed both structurally and via a direct `403`.

### Phase 2 — Platform hardening & breadth — **in progress**

**Complete:**
- Team invite (in-app account creation with a one-time generated password; no email delivery yet). ✅
- HR module — Departments, Teams, employee org placement (the first thing to make department/team-scoped permissions actually exercisable). ✅
- Prototype Polish — real design system (Tailwind v4 tokens, dark/light, Geist), restyled primitives/composites, dynamic `FilterBar`, command palette. ✅ *(superseded — see below)*
- **Obsidian Design System migration, Phase 1** — the token/font/icon foundation replaced (Geist → Inter/JetBrains Mono, lucide-react → self-hosted Material Symbols Outlined, new obsidian dark palette + a matching redesigned light palette), a sidebar collapse mechanism, a shared glass-panel utility, and the Dashboard page restyled against `UI_DESIGN.html` (the primary design reference going forward). Every other module still runs on the *mechanism* from Prototype Polish (same token architecture, same primitive registry) — only Dashboard has the new *values* applied so far; the rest migrate gradually, module by module. ✅ *(Phase 1 only — see `CONTEXT.md` for the module-by-module status)*
- Settings & Workspace Customization — the first real UI over Layer-2 `TenantConfig` overrides (branding, nav-label patches, workspace ID). ✅
- Identity & Member-Experience Foundation — required, server-verified Workspace ID at login; Settings visible to every tenant member (read-only where not editable). ✅
- Project ↔ Member assignment workflow — `ProjectMember` many-to-many, task assignment/reassignment, project-membership enforcement on assignees. ✅
- **8-tier role hierarchy** (`extends`-chain inheritance) replacing the flat Admin/Member model — §5.4. ✅
- **RBAC precision upgrade** — distinct, resource-specific, tier-appropriate permissions (`user:invite`/`role:assign`/`department:manage:own`/`user:manage:own`) replacing coarse shared grants — §5.6. ✅

**Not yet started:**
- Delegation — Company Admin granting specific extra permissions (starting with `user:invite`) to HR Manager at runtime, revocable. Deliberately scoped out of the RBAC precision upgrade as its own follow-up; needs a real data model (who delegated what to whom, revocation).
- Entitlements/feature-flag enforcement across modules (the Layer-3 mechanism exists structurally — §10 — but isn't yet wired to gate any of the modules built so far beyond the seam itself).
- More primitives + composites; more industry blueprints (Healthcare, Finance…) — everything built so far is IT-only.
- CRM + Meetings + Calendar + Documents modules.
- Audit logging write-path coverage (schema exists, not yet populated); email notifications.

### Phase 3 — Intelligence & polish — not started
- AI/RAG (ingestion, retrieval, Q&A, report generation).
- Analytics + Reports modules.
- Admin **visual workspace builder** (authoring UI over the config schema) — tenant-custom role authoring (roles with their own `extends`+delta shape, §5.4) belongs here too.

### Phase 4 — Enterprise & monetization — not started
- Stripe billing on the entitlement seam.
- SSO/SAML; Supabase Realtime; advanced compliance (SOC 2 audit, optional HIPAA).

---

*Architecture v2, last updated 2026-07-18 — added §6.9/§7.8 (Sidebar Navigation Phase 1: nested nav, page/nav permission sync) and §6.3a (Company Administration, Submodule A: `Tenant.profile`, the direct-to-Storage signed-URL upload pattern). See the header for what changed since v1's original approval (2026-07-14). `CONTEXT.md` is the canonical, most-current state snapshot; `CHANGELOG.md` has the full chronological account.*
