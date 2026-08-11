import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { BlueprintDefinitionSchema } from "@antigravity/manifest-schema";
import { materializeBlueprintRoles, materializeDepartmentTypeLabels } from "../src/auth/materialize-roles";

// First IT blueprint fixture — see the Phase 1 plan §4, filled in for Stage 4
// (`pages` was deliberately left empty in Stage 2, ahead of the Configuration
// Engine existing to compile it). `requiredPermission`/`moduleKey` are Stage
// 4's gap-resolution fields (see packages/manifest-schema/src/ui-node.ts and
// nav-item.ts) — not part of the plan's original fixture text, added here to
// make pruning and entitlement-filtering actually demonstrable.
const IT_BLUEPRINT_V1 = {
  id: "it",
  version: 1,
  industry: "IT",
  // 7-tier universal authority ladder via `extends`-chain inheritance
  // (resolved by `resolveBlueprintRoles`, apps/api/src/rbac/grant-resolution.ts)
  // crossed with tenant-configurable Department Types (`departmentTypes`
  // below) — see ORG_HIERARCHY.md for the full design rationale, superseding
  // the flat/abstract 8-role ladder this replaces.
  // All existing blueprint role `id`s are unchanged (only `label`, and for
  // `role.hr-manager` its `extends` target, changed) — existing tenants'
  // `RoleAssignment`s keep pointing at the same rows, no data migration
  // needed for any of them (see CHANGELOG for the live verification this
  // session ran across all 3 real tenants before/after reseeding).
  roles: [
    {
      id: "role.intern",
      label: "Intern",
      // calendarEvent:create:own — Calendar & Scheduling (Core Workspace
      // Phase 3): a universal floor, deliberately granted at the ladder's
      // root so every tier inherits it via `extends` — personal calendar
      // entries (own scope) are available to literally everyone, matching
      // "remind me about my own stuff" being core to what makes a calendar
      // module valuable. Broadcast-visibility tiers escalate below, same
      // shape as announcement:create.
      // attendance:create:own/attendance:read:own — Attendance (Core
      // Workspace Phase 3): universal floor, same "granted at the ladder's
      // root" mechanism as calendarEvent:create:own — self-marking your own
      // daily attendance is available to literally everyone.
      permissions: ["task:read:own", "task:update:own", "calendarEvent:create:own", "attendance:create:own", "attendance:read:own"],
    },
    {
      // Was "Employee" — relabeled to match ORG_HIERARCHY.md's universal
      // tier name. Permissions unchanged.
      id: "role.member",
      label: "Practitioner",
      extends: "role.intern",
      // meeting:read:team — Meetings (Core Workspace Phase 1, Submodule 3):
      // this only *widens* visibility beyond the always-on participant floor
      // (meetingsWhere's OR-condition, see meetings.data-sources.ts); an
      // Intern with no meeting:read grant still always sees meetings they
      // organize or were personally invited to.
      permissions: ["+project:read:team", "+project:update:own", "+task:create:team", "+task:read:team", "+task:delete:own", "+meeting:read:team"],
    },
    {
      // Was "Senior Employee".
      id: "role.senior-employee",
      label: "Senior Practitioner",
      extends: "role.member",
      permissions: ["+task:update:team", "+project:read:department", "+meeting:read:department"],
    },
    {
      // Was "Team Lead". "Distribute and reassign tasks within their team"
      // — task:update stays at :team here (already inherited from Senior
      // Practitioner), not :department; that grant belongs at Manager.
      // meeting:create:team mirrors project:create's exact tier progression
      // (Meetings, Core Workspace Phase 1 Submodule 3) — first appears here,
      // not at Manager, same reading ORG_HIERARCHY.md's own project:create
      // note already establishes ("Lead tier and above"). document:create/
      // update:team mirror the same progression again (Documents, Core
      // Workspace Phase 2 Submodule 1) — a shared project file is everyday
      // collaboration content, not an official broadcast, so it follows
      // project:create's tier ladder rather than announcement:create's.
      id: "role.team-lead",
      label: "Lead",
      extends: "role.senior-employee",
      permissions: [
        "+project:create:team",
        "+project:update:team",
        "+task:delete:team",
        "+meeting:create:team",
        "+document:create:team",
        "+document:update:team",
      ],
    },
    {
      // Was "Project Manager" — the universal people-manager tier.
      id: "role.project-manager",
      label: "Manager",
      extends: "role.team-lead",
      permissions: [
        "+project:create:department",
        "+project:update:department",
        "+project:delete:team",
        "+task:create:department",
        "+task:read:department",
        "+task:update:department",
        "+meeting:create:department",
        "+document:create:department",
        "+document:update:department",
        "+document:delete:team",
      ],
    },
    {
      // "Can manage only their own department" / "assign employees to
      // teams... within their department" -> department:manage:own and
      // user:manage:own, both enforced by explicit, mutation-local scope
      // checks (department.create/team.create/user.assignDepartment) rather
      // than the generic isRowInScope, since Department has no
      // ownerId-shaped field for "own" to mean anything through that path.
      id: "role.department-head",
      label: "Department Head",
      extends: "role.project-manager",
      // announcement:create:department — Announcements (Core Workspace
      // Phase 1, Submodule 4): first appears here, not at Manager/Lead — an
      // announcement is an official department-wide broadcast, a higher bar
      // than project/task authority. document:delete:department (Documents,
      // Phase 2 Submodule 1) — create/update:department are already
      // inherited from Manager tier above, only delete needs to widen here,
      // same "delete lags one tier behind create/update" shape project:*
      // already has (Manager gets project:delete:team, Department Head gets
      // project:delete:department).
      permissions: [
        "+project:create:department",
        "+project:delete:department",
        "+task:delete:department",
        "+department:manage:own",
        "+user:manage:own",
        "+announcement:create:department",
        "+document:delete:department",
        "+calendarEvent:create:department",
        // attendance:update — Attendance (Core Workspace Phase 3):
        // deliberately starts at "department", never "own" — an
        // attendance:update:own grant would be a silent no-op, since the
        // correction path's subject is another User row (ownerId always
        // null for a User-shaped subject, see attendance.mutations.ts's
        // own comment) — isRowInScope's "own" branch can never match that.
        // Self-correction is special-cased before this check ever runs.
        "+attendance:read:department",
        "+attendance:update:department",
      ],
    },
    {
      // New tier — cross-department oversight (e.g. CTO over Engineering +
      // QA + DevOps). Adds department-subtree-scoped versions of Department
      // Head's project/task grants via `+` deltas *without* removing the
      // inherited :department-scoped ones — collapsePermissions always
      // keeps the broadest scope per resource:action key, so both being
      // present is harmless, not a conflict (see ORG_HIERARCHY.md §3's note
      // on this). department:manage:department-subtree lets an Executive
      // create departments/teams anywhere within their own subtree
      // (hr.mutations.ts's new branch).
      id: "role.executive",
      label: "Executive",
      extends: "role.department-head",
      permissions: [
        "+project:create:department-subtree",
        "+project:read:department-subtree",
        "+project:update:department-subtree",
        "+project:delete:department-subtree",
        "+task:create:department-subtree",
        "+task:read:department-subtree",
        "+task:update:department-subtree",
        "+task:delete:department-subtree",
        "+department:manage:department-subtree",
        "+meeting:create:department-subtree",
        "+meeting:read:department-subtree",
        "+announcement:create:department-subtree",
        "+document:create:department-subtree",
        "+document:update:department-subtree",
        "+document:delete:department-subtree",
        "+calendarEvent:create:department-subtree",
        "+attendance:read:department-subtree",
        "+attendance:update:department-subtree",
      ],
    },
    {
      // The one department-flavored role with real bonus permissions today
      // (ORG_HIERARCHY.md §3.2/§4.4) — re-pointed from `role.member`
      // (Practitioner tier) to `role.project-manager` (Manager tier): HR
      // Manager is a real people-manager, not an individual contributor.
      // Safe: nobody holds this role in any real tenant today (confirmed
      // live before this change). Does NOT get `user:invite` — "can invite
      // new employees if granted that privilege by the Company Admin" is
      // the not-yet-built delegation mechanism; not granted by default.
      id: "role.hr-manager",
      label: "HR Manager",
      extends: "role.project-manager",
      // announcement:create:tenant — HR Manager already holds tenant-wide
      // user:manage/department:manage for real HR authority; company-wide
      // HR broadcasts (policy updates, holidays) are exactly its use case,
      // even though the generic tier floor for Announcements otherwise
      // starts at Department Head.
      permissions: [
        "+user:manage:tenant",
        "+department:manage:tenant",
        "+announcement:create:tenant",
        "+calendarEvent:create:tenant",
        // attendance:read/update:tenant — Attendance (Core Workspace Phase
        // 3): HR Manager is the natural tenant-wide attendance authority,
        // same bonus-grant channel as its other HR-flavored tenant grants
        // above.
        "+attendance:read:tenant",
        "+attendance:update:tenant",
      ],
    },
    {
      id: "role.admin",
      label: "Company Admin",
      permissions: [
        "project:create:tenant",
        "project:read:tenant",
        "project:update:tenant",
        "project:delete:tenant",
        "task:create:tenant",
        "task:read:tenant",
        "task:update:tenant",
        "task:delete:tenant",
        "role:manage:tenant",
        "role:assign:tenant",
        "user:invite:tenant",
        "user:manage:tenant",
        "department:manage:tenant",
        "settings:manage:tenant",
        "meeting:create:tenant",
        "meeting:read:tenant",
        "announcement:create:tenant",
        "calendarEvent:create:tenant",
        "document:create:tenant",
        "document:update:tenant",
        "document:delete:tenant",
        "attendance:create:tenant",
        "attendance:read:tenant",
        "attendance:update:tenant",
        // Analytics Phase D — permission-controlled widgets. Only Company
        // Admin holds these by default; every other role starts with zero,
        // grantable via Roles & Permissions/Delegation like everything else.
        "analytics:departmentPerformance:tenant",
        "analytics:productivity:tenant",
        "analytics:aiUsage:tenant",
      ],
    },
  ],
  // Reference department taxonomy (ORG_HIERARCHY.md §3-4) — tenant-editable,
  // not a hard constraint (a tenant can add/rename/remove types via a future
  // Settings UI, the same philosophy as every other blueprint-seeded
  // reference data in this system). Grouping types (technology/people/
  // operations-group/revenue) exist purely to give the Executive tier a
  // real, distinctly-labeled parent department to sit in; `finance` has no
  // grouping type, a deliberate example of the Executive tier being
  // optional (its Department Head reports straight to Company Admin).
  departmentTypes: [
    { id: "technology", label: "Technology", tierLabels: { "role.executive": "CTO" } },
    {
      id: "engineering",
      label: "Engineering",
      tierLabels: {
        "role.department-head": "Engineering Head",
        "role.project-manager": "Engineering Manager",
        "role.team-lead": "Tech Lead",
        "role.senior-employee": "Senior Software Engineer",
        "role.member": "Software Engineer",
        "role.intern": "Intern",
      },
    },
    {
      id: "qa",
      label: "QA",
      tierLabels: {
        "role.department-head": "QA Head",
        "role.project-manager": "QA Manager",
        "role.team-lead": "QA Lead",
        "role.senior-employee": "Senior QA Engineer",
        "role.member": "QA Engineer",
        "role.intern": "Intern",
      },
    },
    {
      // No Lead-tier entry — DevOps teams are typically small/flat enough
      // that Manager -> Senior is sufficient (ORG_HIERARCHY.md §4.3).
      id: "devops",
      label: "DevOps",
      tierLabels: {
        "role.department-head": "DevOps Head",
        "role.project-manager": "DevOps Manager",
        "role.senior-employee": "Senior DevOps Engineer",
        "role.member": "DevOps Engineer",
        "role.intern": "Intern",
      },
    },
    { id: "people", label: "People", tierLabels: { "role.executive": "CHRO" } },
    {
      // HR's Manager tier is the one real bonus-permission case today — see
      // `role.hr-manager` above.
      id: "hr",
      label: "HR",
      tierLabels: {
        "role.department-head": "HR Head",
        "role.project-manager": "HR Manager",
        "role.member": "HR Executive",
        "role.intern": "Intern",
      },
      roleOverrides: { "role.project-manager": "role.hr-manager" },
    },
    {
      id: "recruitment",
      label: "Recruitment",
      tierLabels: {
        "role.department-head": "Recruitment Head",
        "role.project-manager": "Recruitment Manager",
        "role.member": "Recruiter",
      },
    },
    { id: "operations-group", label: "Operations Group", tierLabels: { "role.executive": "COO" } },
    {
      id: "operations",
      label: "Operations",
      tierLabels: {
        "role.department-head": "Operations Head",
        "role.project-manager": "Operations Manager",
        "role.member": "Operations Executive",
      },
    },
    {
      id: "support",
      label: "Support",
      tierLabels: {
        "role.department-head": "Support Head",
        "role.project-manager": "Support Manager",
        "role.senior-employee": "Senior Support Engineer",
        "role.member": "Support Engineer",
        "role.intern": "Intern",
      },
    },
    { id: "revenue", label: "Revenue", tierLabels: { "role.executive": "VP Sales" } },
    {
      id: "sales",
      label: "Sales",
      tierLabels: {
        "role.department-head": "Sales Head",
        "role.project-manager": "Sales Manager",
        "role.senior-employee": "Senior Sales Executive",
        "role.member": "Sales Executive",
        "role.intern": "Intern",
      },
    },
    {
      id: "marketing",
      label: "Marketing",
      tierLabels: {
        "role.department-head": "Marketing Head",
        "role.project-manager": "Marketing Manager",
        "role.member": "Marketing Executive",
      },
    },
    {
      // No grouping type — Finance's Department Head reports straight to
      // Company Admin (ORG_HIERARCHY.md §3's example of the Executive tier
      // being genuinely optional, not every department needing one).
      id: "finance",
      label: "Finance",
      tierLabels: {
        "role.department-head": "Finance Head",
        "role.project-manager": "Finance Manager",
        "role.member": "Finance Executive",
      },
    },
  ],
  // Restructured from a flat 6-item list into role-grouped nested sections
  // (Sidebar Navigation Phase 1 — see CONTEXT.md §41, ARCHITECTURE.md §6.9/
  // §7.8). Every `requiredPermission` below reuses a permission that already
  // exists on a role above — no new permission strings were introduced for
  // this reorg. Items marked "placeholder module" are new nav entries whose
  // page is a minimal `EmptyState` "coming soon" page — no real data source,
  // mutation, or functionality exists for them yet (see ORG_HIERARCHY.md §12
  // for which of these are their own future design sessions).
  navigation: [
    { id: "nav.dashboard", label: "Dashboard", icon: "home", pageId: "page.dashboard" },
    {
      id: "nav.projects",
      label: "Projects",
      icon: "folder",
      pageId: "page.projects",
      requiredPermission: "project:read",
      moduleKey: "projects",
    },
    {
      id: "nav.tasks",
      label: "Tasks",
      icon: "check-square",
      pageId: "page.tasks",
      requiredPermission: "task:read",
      moduleKey: "tasks",
    },
    {
      // Core Workspace Modules, Phase 1, Submodule 2: Channels & Direct
      // Messages. No requiredPermission — chat is core tooling, same
      // "visible to every tenant member" treatment as nav.dashboard/
      // nav.settings, not an entitlement-gated module like Projects/Tasks.
      id: "nav.chat",
      label: "Chat",
      icon: "chat",
      pageId: "page.chat",
    },
    {
      // Core Workspace Modules, Phase 1, Submodule 3: Meetings (complete) —
      // no requiredPermission, deliberately, same "visible to every tenant
      // member" treatment as nav.dashboard/nav.settings/nav.chat; scheduling
      // authority is enforced at the meeting.create mutation itself.
      id: "nav.meetings",
      label: "Meetings",
      icon: "meetings",
      pageId: "page.meetings",
    },
    {
      // Core Workspace Modules, Phase 1, Submodule 4: Announcements
      // (complete) — no requiredPermission, same "visible to every tenant
      // member" treatment as nav.dashboard/nav.chat/nav.meetings; posting
      // authority (announcement:create:<scope>) is enforced at the
      // announcement.create mutation itself. Brand-new — no prior
      // placeholder existed here (unlike Meetings' old EmptyState stub).
      id: "nav.announcements",
      label: "Announcements",
      icon: "announcements",
      pageId: "page.announcements",
    },
    {
      // Core Workspace Modules, Phase 3, Submodule 1: Calendar & Scheduling —
      // no requiredPermission, same "visible to every tenant member"
      // treatment as nav.meetings/nav.announcements; creation authority
      // (calendarEvent:create:<scope>) is enforced at calendarEvent.create.
      // Every tier holds at least :own (see role.intern below), so this is
      // never pruned for anyone.
      id: "nav.calendar",
      label: "Calendar",
      icon: "calendar",
      pageId: "page.calendar",
    },
    {
      // Placeholder module. Gated on project:create rather than a new
      // permission — that grant first appears at the Lead tier (see
      // ORG_HIERARCHY.md §2) and up, i.e. this reads the diagram's "Manager"
      // bucket as "Lead tier and above", not exactly role.project-manager alone.
      id: "nav.team-management",
      label: "Team Management",
      icon: "team-management",
      pageId: "page.team-management",
      requiredPermission: "project:create",
    },
    {
      // Pure disclosure group (no pageId) — every child is gated on
      // user:manage, so this whole group is absent, not empty, for any tier
      // that lacks it (permission-pruner.ts drops emptied-out groups).
      id: "nav.hr-group",
      label: "HR",
      icon: "hr-group",
      children: [
        {
          // Existing item, relabeled ("Team" -> "Employees") and moved under
          // this new group; id/pageId/permission unchanged for tenant
          // nav-override stability (see override-applier.ts).
          id: "nav.team",
          label: "Employees",
          icon: "users",
          pageId: "page.team",
          requiredPermission: "user:manage",
        },
        // Placeholder modules below — no data source/mutation exists yet for
        // any of them (ORG_HIERARCHY.md §4.4/§4.5). Reuse user:manage (the
        // existing HR-tier signal) rather than inventing dedicated
        // permissions ahead of real functionality.
        { id: "nav.recruitment", label: "Recruitment", icon: "recruitment", pageId: "page.recruitment", requiredPermission: "user:manage" },
        // Core Workspace Modules, Phase 3, Submodule 2: Attendance —
        // real module now, no longer a placeholder. requiredPermission
        // changed from the placeholder's generic user:manage to
        // attendance's own real triple — attendance:read:own is a
        // universal floor (see role.intern above), so this is never
        // pruned for anyone, same "always reachable" shape as
        // calendarEvent:create:own's nav entry.
        { id: "nav.attendance", label: "Attendance", icon: "attendance", pageId: "page.attendance", requiredPermission: "attendance:read" },
        { id: "nav.reviews", label: "Reviews", icon: "reviews", pageId: "page.reviews", requiredPermission: "user:manage" },
        // nav.insights retired — consolidated into nav.analytics (Core
        // Workspace Modules, Phase 4: Analytics & Insights).
      ],
    },
    {
      // Pure disclosure group, same empty-drop treatment as nav.hr-group.
      id: "nav.workspace-admin",
      label: "Workspace Administration",
      icon: "workspace-admin",
      children: [
        {
          // Existing item, relabeled ("Org Structure" -> "Teams") and moved
          // under this new group; id kept as "nav.hr" (its original id, even
          // though the label no longer says "HR") for override stability —
          // it predates and is unrelated to the new nav.hr-group above.
          id: "nav.hr",
          label: "Teams",
          icon: "sitemap",
          pageId: "page.hr",
          requiredPermission: "department:manage",
        },
        // Placeholder modules — Admin-only (settings:manage/role:manage are
        // held only by role.admin in this blueprint).
        { id: "nav.company", label: "Company", icon: "company", pageId: "page.company", requiredPermission: "settings:manage" },
        {
          id: "nav.roles-permissions",
          label: "Roles & Permissions",
          icon: "roles-permissions",
          pageId: "page.roles-permissions",
          requiredPermission: "role:manage",
        },
      ],
    },
    {
      id: "nav.settings",
      label: "Settings",
      icon: "settings",
      pageId: "page.settings",
      // No requiredPermission, deliberately — visible to every authenticated
      // tenant member (same treatment as nav.dashboard). Workspace details
      // and "my profile" are readable by anyone; the edit controls inside
      // page.settings are still individually gated on settings:manage.
      // No moduleKey — not an entitlement-gated module, core tooling.
      // Deliberately NOT nested under Workspace Administration despite the
      // label similarity — nesting it there would make Settings invisible
      // to non-admins, regressing its existing universal visibility.
    },
    {
      // Core Workspace Modules, Phase 4: Analytics & Insights — real module
      // now (was two separate dead placeholders, nav.insights/nav.analytics;
      // consolidated into this one). Broad visibility, no page-level gate —
      // every widget inside AnalyticsDashboard is independently gated by its
      // own metric's requiredPermission (analytics.dashboard's resolve
      // loop), same "prune per-widget, not the whole page" treatment
      // nav.dashboard/nav.chat already get.
      id: "nav.analytics",
      label: "Analytics",
      icon: "analytics",
      pageId: "page.analytics",
    },
    {
      // Placeholder module — a personal account page, visible to everyone,
      // same treatment as nav.dashboard/nav.settings/nav.meetings.
      id: "nav.account",
      label: "Account",
      icon: "account",
      pageId: "page.account",
    },
  ],
  dashboards: { default: "page.dashboard" },
  modules: ["projects", "tasks"],
  pages: {
    "page.dashboard": {
      id: "page.dashboard",
      type: "Page",
      version: 1,
      children: [
        {
          id: "hdr",
          type: "Heading",
          version: 1,
          props: {
            text: "Good morning, {{user.displayName}}",
            // Frontend Structural Redesign, Phase 0 — the new hero band's
            // one-line subtitle; a static, interpolated string (no live KPI
            // summary — see Heading.tsx's own doc comment for why).
            subtitle: "Here's what's happening across your workspace today.",
          },
        },
        // Platform UI/UX Redesign, Phase F — everything below is now a
        // DashboardGrid child (a customizable, drag/resize/save/reset grid,
        // reusing Analytics' own DashboardLayout persistence engine under a
        // dedicated "dashboard" key). A dedicated Dashboard-specific "Ask AI"
        // button was scoped for this phase but dropped on inspection: no
        // blueprint-level conditional-visibility mechanism exists to gate a
        // node on `manifest.aiAvailable` the way every other AI entry point
        // in this codebase does in real component code, and an ungated
        // button would open a broken panel for tenants without AI
        // configured. The header's own "Ask AI" button (workspace/layout.tsx,
        // already gated on `aiAvailable`, already visible on every page
        // including this one) already covers this ask without new surface
        // area.
        {
          id: "grid",
          type: "DashboardGrid",
          version: 1,
          props: { dashboardKey: "dashboard" },
          children: [
            {
              id: "k1",
              type: "KpiCard",
              version: 1,
              props: { label: "Active Projects" },
              bind: { source: "projects.count", params: { status: { const: "active" } } },
            },
            {
              id: "k2",
              type: "KpiCard",
              version: 1,
              props: { label: "My Open Tasks" },
              bind: {
                source: "tasks.count",
                params: { assigneeId: { ref: "user.id" }, status: { const: "todo" } },
              },
            },
            {
              id: "k3",
              type: "KpiCard",
              version: 1,
              props: { label: "Overdue Tasks" },
              bind: { source: "tasks.count", params: { overdue: { const: true } } },
            },
            {
              id: "status-chart",
              type: "Chart",
              version: 1,
              props: { title: "Projects by status", nameKey: "status", valueKey: "count" },
              bind: { source: "projects.statusBreakdown" },
            },
            // "Activity timeline" + "Notifications" collapse into one
            // widget — no separate activity-log backend exists anywhere in
            // this codebase, both requested sections are backed by the
            // identical notifications.list data. Same bind shape already
            // proven on page.analytics.
            {
              id: "activity",
              type: "ActivityFeed",
              version: 1,
              props: { title: "Recent Activity", limit: 8 },
              bind: { source: "notifications.list" },
            },
            // List@1's first real blueprint adoption (Phase F) — projects.list
            // already orders by updatedAt desc, take 50, so a client-side
            // limit is all "recent" needs.
            {
              id: "recent-projects",
              type: "List",
              version: 1,
              props: { title: "Recent Projects", titleField: "name", limit: 5 },
              bind: { source: "projects.list" },
              actions: [{ kind: "navigate", to: "page.projects" }],
            },
            // "Upcoming meetings" + "Calendar overview" collapse into one
            // widget bound to calendar.list — already a properly time-
            // windowed, ascending-sorted aggregator across meetings/events/
            // tasks/appointments. Omitting from/to relies on calendar.list's
            // own server-side rolling today->+14-day default (Phase F).
            {
              id: "upcoming",
              type: "List",
              version: 1,
              props: { title: "Upcoming", titleField: "title", limit: 8 },
              bind: { source: "calendar.list" },
              actions: [{ kind: "navigate", to: "page.calendar" }],
            },
            {
              id: "task-view",
              type: "TaskList",
              version: 1,
              props: { title: "Critical Task View" },
              bind: { source: "tasks.list", params: { assigneeId: { ref: "user.id" } }, paginate: true },
              actions: [
                {
                  kind: "mutation",
                  mutation: "task.create",
                  input: { ref: "form.newTask" },
                  requiredPermission: "task:create",
                },
                {
                  kind: "mutation",
                  mutation: "task.updateStatus",
                  input: { ref: "row.id" },
                  requiredPermission: "task:update",
                },
                {
                  kind: "mutation",
                  mutation: "task.reassign",
                  input: { ref: "row.id" },
                  requiredPermission: "task:update",
                },
              ],
            },
            {
              id: "board",
              type: "ProjectBoard",
              version: 1,
              props: { title: "Active Projects" },
              bind: { source: "projects.list", params: { status: { const: "active" } }, paginate: true },
              actions: [
                {
                  kind: "mutation",
                  mutation: "project.create",
                  input: { ref: "form.newProject" },
                  requiredPermission: "project:create",
                },
                {
                  kind: "mutation",
                  mutation: "project.addMember",
                  input: { ref: "form.projectMember" },
                  requiredPermission: "project:update",
                },
                {
                  kind: "mutation",
                  mutation: "project.removeMember",
                  input: { ref: "form.projectMember" },
                  requiredPermission: "project:update",
                },
              ],
            },
            {
              id: "quick-actions",
              type: "QuickActions",
              version: 1,
              props: {
                title: "Quick Actions",
                items: [
                  { label: "New Project", icon: "layers", pageId: "page.projects" },
                  { label: "New Task", icon: "task_alt", pageId: "page.tasks" },
                  // Labels kept in sync with their nav items' new labels
                  // ("Team" -> "Employees", "Org Structure" -> "Teams") even
                  // though the pageIds/mechanism are unchanged.
                  { label: "Employees", icon: "group", pageId: "page.team" },
                  { label: "Teams", icon: "account_tree", pageId: "page.hr" },
                ],
              },
            },
          ],
        },
      ],
    },
    // Rebuilt around ProjectBoard (was FilterBar + Table) so every project —
    // not just ones the Dashboard happens to show as "active" — has a real
    // Member-assignment workflow. The kanban status columns already separate
    // projects by status, making the old standalone status filter largely
    // redundant. `project.delete` carries over as a row-level action so
    // nothing the old Table exposed is lost in the swap.
    "page.projects": {
      id: "page.projects",
      type: "Page",
      version: 1,
      // Mirrors nav.projects's own gate — closes the page/nav sync gap
      // (permission-pruner.ts now checks a page's own root permission, not
      // just its nested actions/children).
      requiredPermission: "project:read",
      children: [
        {
          id: "projects-board",
          type: "ProjectBoard",
          version: 1,
          props: { title: "All Projects" },
          bind: { source: "projects.list", paginate: true },
          actions: [
            {
              kind: "mutation",
              mutation: "project.create",
              input: { ref: "form.newProject" },
              requiredPermission: "project:create",
            },
            // Frontend Structural Redesign, Phase 0 — the new Board view's
            // drag-to-change-status calls this directly (KanbanBoard@1's own
            // updateMutation prop); same permission the mutation itself
            // already requires, no new grant.
            {
              kind: "mutation",
              mutation: "project.update",
              input: { ref: "row.id" },
              requiredPermission: "project:update",
            },
            {
              kind: "mutation",
              mutation: "project.addMember",
              input: { ref: "form.projectMember" },
              requiredPermission: "project:update",
            },
            {
              kind: "mutation",
              mutation: "project.removeMember",
              input: { ref: "form.projectMember" },
              requiredPermission: "project:update",
            },
            {
              kind: "mutation",
              mutation: "project.delete",
              input: { ref: "row.id" },
              requiredPermission: "project:delete",
            },
            // No requiredPermission (Phase 1 Comments & Mentions,
            // CONTEXT.md §49) — anyone who can see this page already has
            // project:read at some scope, which is the only real gate;
            // the mutation itself re-derives and enforces that per-row via
            // assertCommentTargetInScope, not this static field. Reused
            // as-is for document comments too (Phase 2, Submodule 1) — the
            // calling component passes entityType, this action entry only
            // gates whether the "comment" affordance shows at all.
            {
              kind: "mutation",
              mutation: "comment.create",
              input: { ref: "row.id" },
            },
            // Documents (Core Workspace Phase 2, Submodule 1) — DocumentsPanel
            // is a plain shared component (mirrors CommentThread's own
            // "not blueprint-registered" precedent), mounted by ProjectBoard
            // and receiving this same `actions` array as a prop. document.update
            // stands in for rename/replace/approval-status-change collectively
            // — all three share the identical document:update gate, so one
            // entry covers all three UI affordances (same "one canX boolean
            // gates several controls" pattern AnnouncementsWorkspace uses).
            {
              kind: "mutation",
              mutation: "document.create",
              input: { ref: "form.newDocument" },
              requiredPermission: "document:create",
            },
            {
              kind: "mutation",
              mutation: "document.update",
              input: { ref: "row.id" },
              requiredPermission: "document:update",
            },
            {
              kind: "mutation",
              mutation: "document.delete",
              input: { ref: "row.id" },
              requiredPermission: "document:delete",
            },
          ],
        },
      ],
    },
    "page.tasks": {
      id: "page.tasks",
      type: "Page",
      version: 1,
      // Mirrors nav.tasks — see page.projects's comment above.
      requiredPermission: "task:read",
      children: [
        {
          id: "task-list",
          type: "TaskList",
          version: 1,
          bind: { source: "tasks.list", params: { assigneeId: { ref: "user.id" } }, paginate: true },
          actions: [
            {
              kind: "mutation",
              mutation: "task.create",
              input: { ref: "form.newTask" },
              requiredPermission: "task:create",
            },
            {
              kind: "mutation",
              mutation: "task.updateStatus",
              input: { ref: "row.id" },
              requiredPermission: "task:update",
            },
            {
              kind: "mutation",
              mutation: "task.reassign",
              input: { ref: "row.id" },
              requiredPermission: "task:update",
            },
            // See the matching comment on page.projects's ProjectBoard node.
            {
              kind: "mutation",
              mutation: "comment.create",
              input: { ref: "row.id" },
            },
          ],
        },
      ],
    },
    "page.chat": {
      id: "page.chat",
      type: "Page",
      version: 1,
      // No requiredPermission — core tooling, same treatment as
      // page.dashboard/page.settings; access to individual conversations is
      // membership-gated at the mutation/data-source layer, not the page.
      children: [
        {
          id: "chat-workspace",
          type: "ChatWorkspace",
          version: 1,
          actions: [
            { kind: "mutation", mutation: "conversation.createChannel", input: { ref: "form.newChannel" } },
            { kind: "mutation", mutation: "conversation.createDm", input: { ref: "form.newDm" } },
            { kind: "mutation", mutation: "conversation.addMember", input: { ref: "form.addMember" } },
            { kind: "mutation", mutation: "conversation.archive", input: { ref: "row.conversationId" } },
            { kind: "mutation", mutation: "message.send", input: { ref: "form.newMessage" } },
            { kind: "mutation", mutation: "message.delete", input: { ref: "row.id" } },
            { kind: "mutation", mutation: "conversation.markRead", input: { ref: "row.conversationId" } },
          ],
        },
      ],
    },
    "page.team": {
      id: "page.team",
      type: "Page",
      version: 1,
      // Mirrors nav.team — see page.projects's comment above.
      requiredPermission: "user:manage",
      children: [
        {
          id: "team-members",
          type: "TeamMembers",
          version: 1,
          bind: { source: "users.list" },
          actions: [
            {
              kind: "mutation",
              mutation: "user.invite",
              input: { ref: "form.newUser" },
              requiredPermission: "user:invite",
            },
            {
              kind: "mutation",
              mutation: "user.changeRole",
              input: { ref: "form.roleChange" },
              requiredPermission: "role:assign",
            },
          ],
        },
      ],
    },
    "page.hr": {
      id: "page.hr",
      type: "Page",
      version: 1,
      // Mirrors nav.hr — see page.projects's comment above.
      requiredPermission: "department:manage",
      children: [
        {
          id: "org-structure",
          type: "OrgStructure",
          version: 1,
          bind: { source: "departments.list" },
          actions: [
            {
              kind: "mutation",
              mutation: "department.create",
              input: { ref: "form.newDepartment" },
              requiredPermission: "department:manage",
            },
            {
              kind: "mutation",
              mutation: "team.create",
              input: { ref: "form.newTeam" },
              requiredPermission: "department:manage",
            },
            {
              kind: "mutation",
              mutation: "user.assignDepartment",
              input: { ref: "form.assignment" },
              requiredPermission: "user:manage",
            },
            {
              kind: "mutation",
              mutation: "user.setManager",
              input: { ref: "form.assignment" },
              requiredPermission: "user:manage",
            },
            // Organization Lifecycle (Company Administration, Submodule C) —
            // edit/archive/delete/move for departments and teams, plus
            // head/manager assignment. All gated on department:manage,
            // matching every other action already on this node.
            {
              kind: "mutation",
              mutation: "department.update",
              input: { ref: "form.editDepartment" },
              requiredPermission: "department:manage",
            },
            {
              kind: "mutation",
              mutation: "department.setArchived",
              input: { ref: "form.archiveDepartment" },
              requiredPermission: "department:manage",
            },
            {
              kind: "mutation",
              mutation: "department.delete",
              input: { ref: "form.deleteDepartment" },
              requiredPermission: "department:manage",
            },
            {
              kind: "mutation",
              mutation: "department.assignHead",
              input: { ref: "form.assignHead" },
              requiredPermission: "department:manage",
            },
            {
              kind: "mutation",
              mutation: "team.update",
              input: { ref: "form.editTeam" },
              requiredPermission: "department:manage",
            },
            {
              kind: "mutation",
              mutation: "team.moveToDepartment",
              input: { ref: "form.moveTeam" },
              requiredPermission: "department:manage",
            },
            {
              kind: "mutation",
              mutation: "team.setArchived",
              input: { ref: "form.archiveTeam" },
              requiredPermission: "department:manage",
            },
            {
              kind: "mutation",
              mutation: "team.delete",
              input: { ref: "form.deleteTeam" },
              requiredPermission: "department:manage",
            },
            {
              kind: "mutation",
              mutation: "team.assignManager",
              input: { ref: "form.assignManager" },
              requiredPermission: "department:manage",
            },
          ],
        },
      ],
    },
    "page.settings": {
      id: "page.settings",
      type: "Page",
      version: 1,
      children: [
        {
          id: "workspace-settings",
          type: "WorkspaceSettings",
          version: 1,
          actions: [
            {
              kind: "mutation",
              mutation: "tenant.updateBranding",
              input: { ref: "form.branding" },
              requiredPermission: "settings:manage",
            },
            {
              kind: "mutation",
              mutation: "tenant.updateWorkspaceId",
              input: { ref: "form.workspaceId" },
              requiredPermission: "settings:manage",
            },
            {
              kind: "mutation",
              mutation: "workspaceConfig.updateNavigationLabel",
              input: { ref: "form.navLabel" },
              requiredPermission: "settings:manage",
            },
            {
              // Company Administration, Submodule A: company profile,
              // timezone, and business hours all save through this one
              // mutation (each card submits only its own slice).
              kind: "mutation",
              mutation: "tenant.updateProfile",
              input: { ref: "form.profile" },
              requiredPermission: "settings:manage",
            },
            {
              // Step 1 of the logo-upload flow — returns a signed Storage
              // upload URL; the browser uploads directly to Storage, then
              // calls tenant.updateBranding (above) with the resulting URL.
              kind: "mutation",
              mutation: "tenant.createLogoUploadUrl",
              input: { ref: "form.logoUpload" },
              requiredPermission: "settings:manage",
            },
          ],
        },
      ],
    },
    // Core Workspace Modules, Phase 1, Submodule 3: Meetings (complete) — the
    // former Heading+EmptyState placeholder, same shape as page.chat's own
    // real replacement. No requiredPermission — core collaboration tooling,
    // same treatment as page.chat/page.dashboard/page.settings; scheduling
    // authority (meeting:create:<scope>) and per-meeting join/manage access
    // (membership-gated) are both enforced at the mutation/data-source layer,
    // not the page.
    "page.meetings": {
      id: "page.meetings",
      type: "Page",
      version: 1,
      children: [
        {
          id: "meetings-workspace",
          type: "MeetingsWorkspace",
          version: 1,
          actions: [
            // requiredPermission here mirrors the mutation's own gate —
            // permission-pruner.ts reads this static field directly off the
            // ActionSpec node, not a dynamic lookup from the mutation
            // registry, so it must be duplicated here for pruning to
            // actually filter this action out of a lower-tier role's
            // compiled manifest (same requirement tenant.createLogoUploadUrl's
            // action entry already follows in the Settings page below).
            { kind: "mutation", mutation: "meeting.create", input: { ref: "form.scheduleMeeting" }, requiredPermission: "meeting:create" },
            // The other four carry no requiredPermission, matching
            // conversation.archive/message.delete's precedent in page.chat —
            // they're ownership/membership-gated, not RBAC-triple-gated, so
            // there's no static permission string to prune by; visibility is
            // data-driven client-side instead (MeetingsWorkspace's
            // isOrganizer/isParticipant flags).
            { kind: "mutation", mutation: "meeting.cancel", input: { ref: "row.id" } },
            { kind: "mutation", mutation: "meeting.addParticipant", input: { ref: "form.addParticipant" } },
            { kind: "mutation", mutation: "meeting.removeParticipant", input: { ref: "row.userId" } },
            { kind: "mutation", mutation: "meeting.getJoinInfo", input: { ref: "row.id" } },
          ],
        },
      ],
    },
    // Core Workspace Modules, Phase 1, Submodule 4: Announcements
    // (complete). No requiredPermission on the page itself — core
    // collaboration tooling, same treatment as page.chat/page.meetings.
    "page.announcements": {
      id: "page.announcements",
      type: "Page",
      version: 1,
      children: [
        {
          id: "announcements-workspace",
          type: "AnnouncementsWorkspace",
          version: 1,
          actions: [
            // ⚠️ requiredPermission mirrors the mutation's own gate — see
            // the identical note on page.meetings' meeting.create entry
            // above. Omitting it here would repeat the exact bug already
            // hit once for Meetings (server-side auth stays correct, but
            // the "New Announcement" button would incorrectly show for
            // every role regardless of grant).
            { kind: "mutation", mutation: "announcement.create", input: { ref: "form.newAnnouncement" }, requiredPermission: "announcement:create" },
            // No requiredPermission — ownership-only, matching
            // comment.delete/message.delete's precedent.
            { kind: "mutation", mutation: "announcement.delete", input: { ref: "row.id" } },
          ],
        },
      ],
    },
    // Core Workspace Modules, Phase 3, Submodule 1: Calendar & Scheduling.
    // No requiredPermission on the page itself — core collaboration tooling,
    // same treatment as page.chat/page.meetings/page.announcements.
    "page.calendar": {
      id: "page.calendar",
      type: "Page",
      version: 1,
      children: [
        {
          id: "calendar-workspace",
          type: "CalendarWorkspace",
          version: 1,
          actions: [
            // ⚠️ requiredPermission mirrors the mutation's own gate — same
            // note as page.announcements' announcement.create entry above.
            // Note this action survives pruning for EVERY tier, since every
            // role holds at least calendarEvent:create:own (see
            // role.intern above) — intentional, not a bug: it's what makes
            // personal calendar entries universally reachable.
            { kind: "mutation", mutation: "calendarEvent.create", input: { ref: "form.newCalendarEvent" }, requiredPermission: "calendarEvent:create" },
            // No requiredPermission — ownership-only, matching
            // announcement.delete's precedent.
            { kind: "mutation", mutation: "calendarEvent.delete", input: { ref: "row.id" } },
          ],
        },
      ],
    },
    // Core Workspace Modules, Phase 3, Submodule 2: Attendance. Real
    // module now — was a placeholder EmptyState stub, replaced in place.
    "page.attendance": {
      id: "page.attendance",
      type: "Page",
      version: 1,
      requiredPermission: "attendance:read",
      children: [
        {
          id: "attendance-workspace",
          type: "AttendanceWorkspace",
          version: 1,
          actions: [
            // ⚠️ requiredPermission mirrors the mutation's own gate — same
            // note as page.calendar's calendarEvent.create entry above.
            // Survives pruning for EVERY tier, since every role holds at
            // least attendance:create:own (see role.intern above).
            { kind: "mutation", mutation: "attendance.mark", input: { ref: "form.markAttendance" }, requiredPermission: "attendance:create" },
            // Only present for Department Head+ — attendance:update starts
            // at "department" scope, never "own" (see role.department-head
            // above for why).
            { kind: "mutation", mutation: "attendance.correct", input: { ref: "form.correctAttendance" }, requiredPermission: "attendance:update" },
          ],
        },
      ],
    },
    // Placeholder pages below (Sidebar Navigation Phase 1) — each is
    // deliberately just a Heading + EmptyState "coming soon" message, no
    // real data source or mutation. Their `requiredPermission` mirrors the
    // matching nav item exactly, so a permission-gated placeholder can't be
    // reached by a direct pageId fetch either (see permission-pruner.ts's
    // page/nav sync fix). None have a `moduleKey` — not entitlement-gated
    // modules, same treatment as page.team/page.hr/page.settings.
    "page.team-management": {
      id: "page.team-management",
      type: "Page",
      version: 1,
      requiredPermission: "project:create",
      children: [
        { id: "team-management-heading", type: "Heading", version: 1, props: { text: "Team Management" } },
        { id: "team-management-empty", type: "EmptyState", version: 1, props: { message: "Team Management is coming soon." } },
      ],
    },
    "page.recruitment": {
      id: "page.recruitment",
      type: "Page",
      version: 1,
      requiredPermission: "user:manage",
      children: [
        { id: "recruitment-heading", type: "Heading", version: 1, props: { text: "Recruitment" } },
        { id: "recruitment-empty", type: "EmptyState", version: 1, props: { message: "Recruitment is coming soon." } },
      ],
    },
    "page.reviews": {
      id: "page.reviews",
      type: "Page",
      version: 1,
      requiredPermission: "user:manage",
      children: [
        { id: "reviews-heading", type: "Heading", version: 1, props: { text: "Reviews" } },
        { id: "reviews-empty", type: "EmptyState", version: 1, props: { message: "Reviews is coming soon." } },
      ],
    },
    // page.insights retired — consolidated into page.analytics (Core
    // Workspace Modules, Phase 4: Analytics & Insights).
    "page.company": {
      id: "page.company",
      type: "Page",
      version: 1,
      requiredPermission: "settings:manage",
      children: [
        { id: "company-heading", type: "Heading", version: 1, props: { text: "Company" } },
        { id: "company-empty", type: "EmptyState", version: 1, props: { message: "Company settings are coming soon." } },
      ],
    },
    // Roles & Permissions Management (Core Workspace Modules, Phase 3,
    // priority insert ahead of Leave Management). Real module now — was a
    // placeholder EmptyState stub, replaced in place, same transition
    // page.attendance made above.
    "page.roles-permissions": {
      id: "page.roles-permissions",
      type: "Page",
      version: 1,
      requiredPermission: "role:manage",
      children: [
        {
          id: "roles-permissions-workspace",
          type: "RolesPermissionsWorkspace",
          version: 1,
          actions: [
            // ⚠️ requiredPermission mirrors each mutation's own gate — same
            // note as page.attendance's actions above. role:manage is held
            // only by role.admin today, so these all prune to nothing for
            // every other tier (deliberate — see the module's design notes
            // on why role management is Admin-only in v1).
            { kind: "mutation", mutation: "role.createCustom", input: { ref: "form.newRole" }, requiredPermission: "role:manage" },
            { kind: "mutation", mutation: "role.updateCustom", input: { ref: "form.editRole" }, requiredPermission: "role:manage" },
            { kind: "mutation", mutation: "role.clone", input: { ref: "form.cloneRole" }, requiredPermission: "role:manage" },
            { kind: "mutation", mutation: "role.delete", input: { ref: "row.id" }, requiredPermission: "role:manage" },
            // Delegation — per-user permission override, same role:manage
            // gate. input.ref is vestigial like the four above:
            // RolesPermissionsWorkspace calls callMutation imperatively from
            // component state, never through the declarative binding.
            { kind: "mutation", mutation: "delegation.grant", input: { ref: "form.grantDelegation" }, requiredPermission: "role:manage" },
            { kind: "mutation", mutation: "delegation.revoke", input: { ref: "row.id" }, requiredPermission: "role:manage" },
          ],
        },
      ],
    },
    // Core Workspace Modules, Phase 4: Analytics & Insights — real module
    // now, replacing the two dead EmptyState placeholders (page.insights,
    // consolidated in; page.analytics itself). No requiredPermission on the
    // page — broad visibility, matching nav.analytics above. Every widget
    // inside AnalyticsDashboard is independently gated by its own metric's
    // requiredPermission (analytics.dashboard's resolve loop) — genuinely
    // new widget-level pruning territory, not the page/action-level pruning
    // every other module here relies on.
    "page.analytics": {
      id: "page.analytics",
      type: "Page",
      version: 1,
      children: [
        { id: "analytics-heading", type: "Heading", version: 1, props: { text: "Analytics & Insights" } },
        // Phase C (Visual & Widget-Type Depth) — a "Core Widget (Always
        // Available)" per the request's own example list. Bound directly to
        // notifications.list (own-scoped, no requiredPermission), not routed
        // through analytics.dashboard's widget array — Notification rows are
        // per-user personal data, not a cross-tenant MetricRegistry concept.
        {
          id: "analytics-activity",
          type: "ActivityFeed",
          version: 1,
          props: { title: "Recent Activity", limit: 10 },
          bind: { source: "notifications.list" },
        },
        { id: "analytics-dashboard", type: "AnalyticsDashboard", version: 1 },
        // Analytics Phase G (Interactive Kanban & Gantt) — both bind
        // directly to the already-real, already-scoped tasks.list (no extra
        // params — tenant/scope-wide, deliberately broader than page.tasks's
        // own personal `assigneeId: {ref:"user.id"}`-scoped TaskList node).
        // actions mirror page.tasks's own established ActionSpec shape
        // exactly, so action-level permission pruning gates drag/edit the
        // same way task:update already gates every other task mutation.
        {
          id: "analytics-task-kanban",
          type: "KanbanBoard",
          version: 1,
          props: {
            title: "Task Board",
            groupKey: "status",
            labelKey: "title",
            columns: ["todo", "in_progress", "done"],
            updateMutation: "task.updateStatus",
            updateValueKey: "status",
          },
          bind: { source: "tasks.list", params: {} },
          actions: [{ kind: "mutation", mutation: "task.updateStatus", input: { ref: "row.id" }, requiredPermission: "task:update" }],
        },
        {
          id: "analytics-task-gantt",
          type: "GanttChart",
          version: 1,
          props: { title: "Task Timeline", labelKey: "title", startKey: "createdAt", endKey: "dueDate", idKey: "id", updateMutation: "task.updateDueDate" },
          bind: { source: "tasks.list", params: {} },
          actions: [{ kind: "mutation", mutation: "task.updateDueDate", input: { ref: "row.id" }, requiredPermission: "task:update" }],
        },
      ],
    },
    "page.account": {
      id: "page.account",
      type: "Page",
      version: 1,
      children: [
        { id: "account-heading", type: "Heading", version: 1, props: { text: "Account" } },
        { id: "account-empty", type: "EmptyState", version: 1, props: { message: "Account settings are coming soon." } },
      ],
    },
  },
};

// Healthcare Domain, Phase A — the platform's first non-IT industry
// blueprint, proving the config-driven multi-domain architecture for real
// (ARCHITECTURE.md's own roadmap note used to say "everything built so far
// is IT-only" — this is what closes that gap). Deliberately minimal per the
// approved Phase A scope: no department taxonomy (`departmentTypes: []` —
// Patient/Appointment have no `departmentId` column at all, see
// patient.prisma/appointment.prisma's own doc comments), 4 flat roles (no
// `extends` chains — unlike the IT blueprint's tier-ladder inheritance,
// every Healthcare role's `permissions` array is complete and
// self-contained, the simplest correct shape for 4 roles with no shared
// sub-hierarchy worth factoring out yet).
//
// Every role maps onto the SAME universal 7-tier ladder / 5-value scope
// enum every module in this codebase already authorizes through
// (ORG_HIERARCHY.md's own compliance rule — no new authority model
// invented). `role.admin` is required verbatim by AuthService.signup's own
// hardcoded lookup; Doctor/Nurse/Receptionist are ordinary blueprint-defined
// roles, materialized exactly like any IT-blueprint role.
//
// Patient/Appointment ownership scoping (patient:*:own = "my assigned
// patients", appointment:*:own = "my own appointments") is where this
// blueprint's RBAC precision actually lives — Project/Task/Document grants
// are deliberately kept at :tenant scope for Doctor/Nurse rather than :own,
// a disclosed simplification: `isRowInScope`'s "own" check is an OWNERSHIP
// match (Project.ownerId), not a MEMBERSHIP match (ProjectMember) — a
// patient's auto-created chart Project is owned by whoever registered the
// patient, not necessarily the assigned doctor, so an :own grant on
// project/task/document would incorrectly deny a doctor's own patient's
// chart in some cases. Tenant-wide scope for these three sidesteps that
// ownership/membership mismatch entirely; Patient/Appointment's own
// :own-scoped grants are what actually demonstrate real per-role RBAC
// differentiation (see the live-verification plan).
const HEALTHCARE_BLUEPRINT_V1 = {
  id: "healthcare",
  version: 1,
  industry: "Healthcare",
  roles: [
    {
      id: "role.admin",
      label: "Hospital Administrator",
      permissions: [
        "patient:create:tenant",
        "patient:read:tenant",
        "patient:update:tenant",
        "appointment:create:tenant",
        "appointment:read:tenant",
        "appointment:update:tenant",
        "project:create:tenant",
        "project:read:tenant",
        "project:update:tenant",
        "project:delete:tenant",
        "task:create:tenant",
        "task:read:tenant",
        "task:update:tenant",
        "task:delete:tenant",
        "document:create:tenant",
        "document:update:tenant",
        "document:delete:tenant",
        "role:manage:tenant",
        "role:assign:tenant",
        "user:invite:tenant",
        "user:manage:tenant",
        "department:manage:tenant",
        "settings:manage:tenant",
        "meeting:create:tenant",
        "meeting:read:tenant",
        "calendarEvent:create:tenant",
        "attendance:create:tenant",
        "attendance:read:tenant",
        "attendance:update:tenant",
      ],
    },
    {
      id: "role.doctor",
      label: "Doctor",
      permissions: [
        // Needs to look up any patient (referrals/coverage), but may only
        // update their own assigned patients' profile/status.
        "patient:read:tenant",
        "patient:update:own",
        "appointment:read:own",
        "appointment:update:own",
        // See this fixture's own header comment for why these three stay
        // :tenant rather than :own.
        "project:read:tenant",
        "task:create:tenant",
        "task:read:tenant",
        "task:update:tenant",
        "document:create:tenant",
        "document:update:tenant",
        "meeting:read:tenant",
        "calendarEvent:create:own",
        "attendance:create:own",
        "attendance:read:own",
      ],
    },
    {
      id: "role.nurse",
      label: "Nurse",
      permissions: [
        "patient:read:tenant",
        "patient:update:own",
        // Broader than Doctor's own-scoped appointment access — nurses
        // coordinate scheduling across a doctor's whole patient load, not
        // just their own assignments (there is no assignment concept for
        // nurses in Phase A).
        "appointment:read:tenant",
        "project:read:tenant",
        "task:read:tenant",
        "task:update:tenant",
        "meeting:read:tenant",
        "calendarEvent:create:own",
        "attendance:create:own",
        "attendance:read:own",
      ],
    },
    {
      id: "role.receptionist",
      label: "Receptionist",
      permissions: [
        // Registers new patients and books for anyone — no patient:update,
        // no project/task/document grants at all. A receptionist never
        // becomes a chart Project's member, so they see zero care-plan/
        // medical-record content — not a special-cased rule, just the
        // natural consequence of never being added. The concrete,
        // demonstrable "different roles see genuinely different things"
        // proof for this domain.
        "patient:create:tenant",
        "patient:read:tenant",
        "appointment:create:tenant",
        "appointment:read:tenant",
        "appointment:update:tenant",
        "meeting:read:tenant",
        "calendarEvent:create:own",
        "attendance:create:own",
        "attendance:read:own",
      ],
    },
  ],
  // No Healthcare department taxonomy in Phase A — see this fixture's own
  // header comment. Additive to populate later; not a redesign.
  departmentTypes: [],
  navigation: [
    { id: "nav.dashboard", label: "Dashboard", icon: "home", pageId: "page.dashboard" },
    {
      id: "nav.patients",
      label: "Patients",
      icon: "group",
      pageId: "page.patients",
      requiredPermission: "patient:read",
      moduleKey: "patients",
    },
    {
      id: "nav.appointments",
      label: "Appointments",
      icon: "calendar",
      pageId: "page.appointments",
      requiredPermission: "appointment:read",
      moduleKey: "appointments",
    },
    // Everything below reuses an existing module's own nav entry verbatim
    // (same pageId-bearing composite, same permission gate where one
    // exists) — zero new code, only blueprint content, per this initiative's
    // own "reuse as many existing modules as possible" mandate.
    { id: "nav.analytics", label: "Analytics", icon: "analytics", pageId: "page.analytics" },
    { id: "nav.chat", label: "Chat", icon: "chat", pageId: "page.chat" },
    { id: "nav.meetings", label: "Meetings", icon: "meetings", pageId: "page.meetings" },
    { id: "nav.calendar", label: "Calendar", icon: "calendar", pageId: "page.calendar" },
    {
      id: "nav.attendance",
      label: "Attendance",
      icon: "attendance",
      pageId: "page.attendance",
      requiredPermission: "attendance:read",
    },
    {
      id: "nav.roles-permissions",
      label: "Roles & Permissions",
      icon: "roles-permissions",
      pageId: "page.roles-permissions",
      requiredPermission: "role:manage",
    },
    { id: "nav.settings", label: "Settings", icon: "settings", pageId: "page.settings" },
    { id: "nav.account", label: "Account", icon: "account", pageId: "page.account" },
  ],
  dashboards: { default: "page.dashboard" },
  modules: ["patients", "appointments"],
  pages: {
    "page.dashboard": {
      id: "page.dashboard",
      type: "Page",
      version: 1,
      // Deliberately minimal — no requiredPermission (must never be
      // permission-gated, see main()'s own sanity check below). Phase C
      // resolved the earlier "enrich this later" breadcrumb: role-specific
      // Patient/Appointment widgets are delivered entirely through
      // page.analytics's own AnalyticsDashboard composite (already present
      // below) plus DEFAULT_DASHBOARD_WIDGET_KEYS role curation
      // (auth.service.ts) — not by duplicating that composite here, which
      // would show identical content on two different nav pages and
      // contradict the original request's own "do not redesign the
      // dashboard" instruction. This page stays a plain welcome heading.
      children: [{ id: "hdr", type: "Heading", version: 1, props: { text: "Good morning, {{user.displayName}}" } }],
    },
    "page.patients": {
      id: "page.patients",
      type: "Page",
      version: 1,
      requiredPermission: "patient:read",
      children: [
        {
          id: "patients-workspace",
          type: "PatientsWorkspace",
          version: 1,
          props: { title: "Patients" },
          bind: { source: "patients.list", params: {} },
          actions: [
            { kind: "mutation", mutation: "patient.register", input: { ref: "form.registerPatient" }, requiredPermission: "patient:create" },
            { kind: "mutation", mutation: "patient.updateStatus", input: { ref: "row.id" }, requiredPermission: "patient:update" },
            { kind: "mutation", mutation: "patient.assignDoctor", input: { ref: "row.id" }, requiredPermission: "patient:update" },
            // Healthcare Domain, Phase D — Medical Records. Verbatim copy of
            // page.projects's own document.*/comment.create entries (same
            // reasoning: comment.create has no requiredPermission since the
            // mutation itself re-derives scope per-row via
            // assertCommentTargetInScope; this only gates whether the
            // affordance shows at all). PatientsWorkspace.tsx derives
            // canCreateDocuments/canUpdateDocuments/canDeleteDocuments from
            // this same actions array, mirroring ProjectBoard.tsx exactly.
            { kind: "mutation", mutation: "comment.create", input: { ref: "row.id" } },
            { kind: "mutation", mutation: "document.create", input: { ref: "form.newDocument" }, requiredPermission: "document:create" },
            { kind: "mutation", mutation: "document.update", input: { ref: "row.id" }, requiredPermission: "document:update" },
            { kind: "mutation", mutation: "document.delete", input: { ref: "row.id" }, requiredPermission: "document:delete" },
          ],
        },
      ],
    },
    "page.appointments": {
      id: "page.appointments",
      type: "Page",
      version: 1,
      requiredPermission: "appointment:read",
      children: [
        {
          id: "appointments-workspace",
          type: "AppointmentsWorkspace",
          version: 1,
          props: { title: "Appointments" },
          bind: { source: "appointments.list", params: {} },
          actions: [
            { kind: "mutation", mutation: "appointment.create", input: { ref: "form.bookAppointment" }, requiredPermission: "appointment:create" },
            { kind: "mutation", mutation: "appointment.updateStatus", input: { ref: "row.id" }, requiredPermission: "appointment:update" },
          ],
        },
      ],
    },
    // Everything below reuses an existing blueprint page's own real content
    // verbatim (same composite type, same actions/mutations) — copied, not
    // referenced, since `pages` is a per-blueprint map; zero new frontend
    // code either way, only JSON.
    "page.analytics": {
      id: "page.analytics",
      type: "Page",
      version: 1,
      children: [
        { id: "analytics-heading", type: "Heading", version: 1, props: { text: "Analytics & Insights" } },
        {
          id: "analytics-activity",
          type: "ActivityFeed",
          version: 1,
          props: { title: "Recent Activity", limit: 10 },
          bind: { source: "notifications.list" },
        },
        { id: "analytics-dashboard", type: "AnalyticsDashboard", version: 1 },
      ],
    },
    "page.chat": {
      id: "page.chat",
      type: "Page",
      version: 1,
      children: [
        {
          id: "chat-workspace",
          type: "ChatWorkspace",
          version: 1,
          actions: [
            { kind: "mutation", mutation: "conversation.createChannel", input: { ref: "form.newChannel" } },
            { kind: "mutation", mutation: "conversation.createDm", input: { ref: "form.newDm" } },
            { kind: "mutation", mutation: "conversation.addMember", input: { ref: "form.addMember" } },
            { kind: "mutation", mutation: "conversation.archive", input: { ref: "row.conversationId" } },
            { kind: "mutation", mutation: "message.send", input: { ref: "form.newMessage" } },
            { kind: "mutation", mutation: "message.delete", input: { ref: "row.id" } },
            { kind: "mutation", mutation: "conversation.markRead", input: { ref: "row.conversationId" } },
          ],
        },
      ],
    },
    "page.meetings": {
      id: "page.meetings",
      type: "Page",
      version: 1,
      children: [
        {
          id: "meetings-workspace",
          type: "MeetingsWorkspace",
          version: 1,
          actions: [
            { kind: "mutation", mutation: "meeting.create", input: { ref: "form.scheduleMeeting" }, requiredPermission: "meeting:create" },
            { kind: "mutation", mutation: "meeting.cancel", input: { ref: "row.id" } },
            { kind: "mutation", mutation: "meeting.addParticipant", input: { ref: "form.addParticipant" } },
            { kind: "mutation", mutation: "meeting.removeParticipant", input: { ref: "row.userId" } },
            { kind: "mutation", mutation: "meeting.getJoinInfo", input: { ref: "row.id" } },
          ],
        },
      ],
    },
    "page.calendar": {
      id: "page.calendar",
      type: "Page",
      version: 1,
      children: [
        {
          id: "calendar-workspace",
          type: "CalendarWorkspace",
          version: 1,
          actions: [
            { kind: "mutation", mutation: "calendarEvent.create", input: { ref: "form.newCalendarEvent" }, requiredPermission: "calendarEvent:create" },
            { kind: "mutation", mutation: "calendarEvent.delete", input: { ref: "row.id" } },
          ],
        },
      ],
    },
    "page.attendance": {
      id: "page.attendance",
      type: "Page",
      version: 1,
      requiredPermission: "attendance:read",
      children: [
        {
          id: "attendance-workspace",
          type: "AttendanceWorkspace",
          version: 1,
          actions: [
            { kind: "mutation", mutation: "attendance.mark", input: { ref: "form.markAttendance" }, requiredPermission: "attendance:create" },
            { kind: "mutation", mutation: "attendance.correct", input: { ref: "form.correctAttendance" }, requiredPermission: "attendance:update" },
          ],
        },
      ],
    },
    "page.roles-permissions": {
      id: "page.roles-permissions",
      type: "Page",
      version: 1,
      requiredPermission: "role:manage",
      children: [
        {
          id: "roles-permissions-workspace",
          type: "RolesPermissionsWorkspace",
          version: 1,
          actions: [
            { kind: "mutation", mutation: "role.createCustom", input: { ref: "form.newRole" }, requiredPermission: "role:manage" },
            { kind: "mutation", mutation: "role.updateCustom", input: { ref: "form.editRole" }, requiredPermission: "role:manage" },
            { kind: "mutation", mutation: "role.clone", input: { ref: "form.cloneRole" }, requiredPermission: "role:manage" },
            { kind: "mutation", mutation: "role.delete", input: { ref: "row.id" }, requiredPermission: "role:manage" },
            { kind: "mutation", mutation: "delegation.grant", input: { ref: "form.grantDelegation" }, requiredPermission: "role:manage" },
            { kind: "mutation", mutation: "delegation.revoke", input: { ref: "row.id" }, requiredPermission: "role:manage" },
          ],
        },
      ],
    },
    "page.settings": {
      id: "page.settings",
      type: "Page",
      version: 1,
      children: [
        {
          id: "workspace-settings",
          type: "WorkspaceSettings",
          version: 1,
          actions: [
            { kind: "mutation", mutation: "tenant.updateBranding", input: { ref: "form.branding" }, requiredPermission: "settings:manage" },
            { kind: "mutation", mutation: "tenant.updateWorkspaceId", input: { ref: "form.workspaceId" }, requiredPermission: "settings:manage" },
            {
              kind: "mutation",
              mutation: "workspaceConfig.updateNavigationLabel",
              input: { ref: "form.navLabel" },
              requiredPermission: "settings:manage",
            },
            { kind: "mutation", mutation: "tenant.updateProfile", input: { ref: "form.profile" }, requiredPermission: "settings:manage" },
            { kind: "mutation", mutation: "tenant.createLogoUploadUrl", input: { ref: "form.logoUpload" }, requiredPermission: "settings:manage" },
          ],
        },
      ],
    },
    "page.account": {
      id: "page.account",
      type: "Page",
      version: 1,
      children: [
        { id: "account-heading", type: "Heading", version: 1, props: { text: "Account" } },
        { id: "account-empty", type: "EmptyState", version: 1, props: { message: "Account settings are coming soon." } },
      ],
    },
  },
};

// Shared by both blueprints — the default dashboard must never be
// permission-gated for any tier, or a real user whose effective permissions
// fail that gate would hit compileWorkspace's unguarded
// `pruned.pages[defaultPageId]` lookup (compiler.service.ts) and get a raw
// 500, not a controlled 404. Caught here, at seed time.
function assertDefaultDashboardUngated(blueprint: { dashboards: { default: string }; pages: Record<string, { requiredPermission?: string }> }) {
  const defaultPage = blueprint.pages[blueprint.dashboards.default];
  if (defaultPage?.requiredPermission) {
    throw new Error(`Default dashboard "${blueprint.dashboards.default}" must not have a requiredPermission`);
  }
}

async function main() {
  // Validated against the same shared contract the Configuration Engine
  // compiles against — a malformed fixture fails here, at seed time, not
  // silently inside a compiled manifest later.
  BlueprintDefinitionSchema.parse(IT_BLUEPRINT_V1);
  BlueprintDefinitionSchema.parse(HEALTHCARE_BLUEPRINT_V1);

  assertDefaultDashboardUngated(IT_BLUEPRINT_V1);
  assertDefaultDashboardUngated(HEALTHCARE_BLUEPRINT_V1);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }),
  });

  await prisma.blueprint.upsert({
    where: { industry_version: { industry: "IT", version: 1 } },
    create: { industry: "IT", version: 1, definition: IT_BLUEPRINT_V1 },
    update: { definition: IT_BLUEPRINT_V1 },
  });
  console.log("Seeded blueprint: IT v1");

  // Healthcare Domain, Phase A — the platform's first non-IT blueprint,
  // coexisting in the same `blueprints` table with zero collision (the
  // unique key is the pair `[industry, version]`, not `industry` alone).
  await prisma.blueprint.upsert({
    where: { industry_version: { industry: "Healthcare", version: 1 } },
    create: { industry: "Healthcare", version: 1, definition: HEALTHCARE_BLUEPRINT_V1 },
    update: { definition: HEALTHCARE_BLUEPRINT_V1 },
  });
  console.log("Seeded blueprint: Healthcare v1");

  // Roles are materialized at tenant provisioning (AuthService.signup) —
  // a `Role` row's `permissions` is a snapshot copied from the blueprint at
  // that moment, not re-derived live on every permission check (see
  // rbac/permission-resolver.service.ts). That's a deliberate performance
  // choice, but it means a permission added to a blueprint role *after* a
  // tenant already exists never reaches that tenant on its own — every
  // stage that adds a new permission (HR's department:manage, Settings'
  // settings:manage, and every future module) silently locks existing
  // tenants' Admins out of it until this re-sync runs. There's no per-tenant
  // role customization mechanism in Phase 1 (unlike nav/branding, which do
  // have one via TenantConfigOverrides), so overwriting to match the
  // blueprint exactly is always correct, not just convenient — revisit this
  // assumption if tenant-specific role customization is ever added.
  //
  // Uses `materializeBlueprintRoles` — the exact same function
  // `AuthService.signup` uses for a brand-new tenant — per existing tenant,
  // not a flat `updateMany`. This is what actually *creates* a tenant's
  // missing roles when the blueprint grows new ones (as it just did: 2
  // roles -> 8), not just refreshes permissions on roles that already
  // exist; a plain `updateMany` matched by `sourceBlueprintRoleId` would
  // silently do nothing for a role a tenant has never seen before.
  const tenantIds = (await prisma.tenant.findMany({ where: { industry: IT_BLUEPRINT_V1.industry }, select: { id: true } })).map((t) => t.id);
  let syncedTenants = 0;
  for (const tenantId of tenantIds) {
    const roleIds = await materializeBlueprintRoles(prisma, tenantId, IT_BLUEPRINT_V1.roles);
    await materializeDepartmentTypeLabels(prisma, tenantId, IT_BLUEPRINT_V1.departmentTypes, roleIds);
    syncedTenants++;
  }
  console.log(`Re-synced roles + department-type labels for ${syncedTenants} existing IT tenant(s) to the current blueprint`);

  // Same re-sync, scoped to Healthcare tenants — identical mechanism, zero
  // industry-conditional branching beyond which blueprint's own `roles`/
  // `departmentTypes` get passed in.
  const healthcareTenantIds = (
    await prisma.tenant.findMany({ where: { industry: HEALTHCARE_BLUEPRINT_V1.industry }, select: { id: true } })
  ).map((t) => t.id);
  let syncedHealthcareTenants = 0;
  for (const tenantId of healthcareTenantIds) {
    const roleIds = await materializeBlueprintRoles(prisma, tenantId, HEALTHCARE_BLUEPRINT_V1.roles);
    await materializeDepartmentTypeLabels(prisma, tenantId, HEALTHCARE_BLUEPRINT_V1.departmentTypes, roleIds);
    syncedHealthcareTenants++;
  }
  console.log(`Re-synced roles + department-type labels for ${syncedHealthcareTenants} existing Healthcare tenant(s) to the current blueprint`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
