import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_DASHBOARD_WIDGET_KEYS, autoLayout } from "../src/modules/analytics/dashboard-defaults";
import { BlueprintDefinitionSchema } from "@purnit/manifest-schema";
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
      rank: 8,
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
      // leave:create:own/leave:read:own — Leave Management: same universal-
      // floor mechanism, ORG_HIERARCHY.md §9-10's first real consumer of
      // User.managerId/user.setManager (see resolve-approver.ts).
      permissions: [
        "task:read:own",
        "task:update:own",
        "calendarEvent:create:own",
        "attendance:create:own",
        "attendance:read:own",
        "leave:create:own",
        "leave:read:own",
      ],
    },
    {
      // Was "Employee" — relabeled to match ORG_HIERARCHY.md's universal
      // tier name. Permissions unchanged.
      id: "role.member",
      label: "Practitioner",
      rank: 7,
      extends: "role.intern",
      // meeting:read:team — Meetings (Core Workspace Phase 1, Submodule 3):
      // this only *widens* visibility beyond the always-on participant floor
      // (meetingsWhere's OR-condition, see meetings.data-sources.ts); an
      // Intern with no meeting:read grant still always sees meetings they
      // organize or were personally invited to.
      permissions: ["+project:read:team", "+project:update:own", "+reportAnalysis:create:team", "+task:create:team", "+task:read:team", "+task:delete:own", "+meeting:read:team"],
    },
    {
      // Was "Senior Employee".
      id: "role.senior-employee",
      label: "Senior Practitioner",
      rank: 6,
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
      rank: 5,
      extends: "role.senior-employee",
      permissions: [
        "+project:create:team",
        "+project:update:team",
        "+task:delete:team",
        "+meeting:create:team",
        "+document:create:team",
        "+reportAnalysis:create:team",
        "+document:update:team",
        // leave:approve:own — Leave Management: "own" here means "requests
        // where I am literally the assigned approver" (ARCHITECTURE.md
        // §5.2's "own is contextual to the resource" precedent, same shape
        // as department:manage:own), not row-ownership. First appears here,
        // not at Manager — same "Lead tier and above" reading
        // ORG_HIERARCHY.md's project:create note already establishes,
        // since anyone from Lead tier up can plausibly be someone's direct
        // manager in this org model.
        "+leave:approve:own",
        // Role-Based Workspaces, Stage A — Analytics becomes visible from the
        // Lead tier up, and is inherited by Manager / Department Head /
        // Executive / HR Manager through the extends chain. Below this tier a
        // person's own work is the whole job; organizational analytics is
        // noise they cannot act on. Opening the page only — every metric on
        // it still enforces its own permission and scope.
        "+analytics:read:tenant",
      ],
    },
    {
      // Was "Project Manager" — the universal people-manager tier.
      id: "role.project-manager",
      label: "Manager",
      rank: 4,
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
        "+reportAnalysis:create:department",
        "+document:update:department",
        "+document:delete:team",
        // contact/deal:*:own — CRM: IT has no dedicated sales-facing role
        // (unlike Finance's Sales Rep), so Manager tier — already the tier
        // that holds general business-development authority elsewhere
        // (project/meeting/document creation) — is where CRM starts. `:own`
        // here is real, not inert: contact.create/deal.create default
        // ownerId to the creator, so a Manager who creates a contact/deal
        // genuinely owns it from day one, same shape as Client's own
        // Sales Rep precedent.
        "+contact:create:own",
        "+contact:read:own",
        "+contact:update:own",
        "+deal:create:own",
        "+deal:read:own",
        "+deal:update:own",
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
      rank: 2,
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
        // leave:approve:department — Leave Management: the override-
        // visibility safety valve (ORG_HIERARCHY.md §10) — can act on any
        // pending request within their own department, whether or not
        // they're the requester's direct manager.
        "+leave:approve:department",
        // contact/deal:read:tenant — CRM: oversight visibility (see the
        // whole pipeline, not just what you personally own), not broader
        // create/update authority — editing someone else's contact/deal
        // stays owner-or-Admin only, same restraint Client's own design
        // shows (no tier grants blanket edit rights over another Sales
        // Rep's clients either). `:tenant` here (not `:department-subtree`)
        // is deliberate: Contact/Deal carry no departmentId at all, so a
        // `:department-subtree` grant would silently collapse to behaving
        // exactly like `:own` in `isRowInScope` (its subject.departmentId
        // branch can never match) — a real, checked-before-using footgun,
        // not an oversight.
        "+contact:read:tenant",
        "+deal:read:tenant",
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
      rank: 1,
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
        // Role-Based Workspaces, Stage B — the Executive tier's whole purpose
        // is comparing departments against each other, which is exactly what
        // this permission unlocks. Until now only Company Admin held it, so
        // an Executive's seeded dashboard listed a leaderboard they could not
        // actually see: 3 of their top 4 widgets rendered nothing.
        //
        // This is also what makes Executive genuinely distinct from
        // Department Head. The two have identical resource:action pairs and
        // therefore identical navigation by construction — their real
        // difference is reach (department vs department-subtree), and this is
        // the widget that shows it.
        "+analytics:departmentPerformance:tenant",
        "+meeting:read:department-subtree",
        "+announcement:create:department-subtree",
        "+document:create:department-subtree",
        "+reportAnalysis:create:department-subtree",
        "+document:update:department-subtree",
        "+document:delete:department-subtree",
        "+calendarEvent:create:department-subtree",
        "+attendance:read:department-subtree",
        "+attendance:update:department-subtree",
        // leave:approve:department-subtree — Leave Management: same
        // override-visibility widening every other subtree grant here
        // already follows.
        "+leave:approve:department-subtree",
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
      rank: 3,
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
        // Role-Based Workspaces, Stage B — workforce analytics is HR's actual
        // job, and both of these were already listed in HR Manager's seeded
        // dashboard without the permission to render them (3 of their top 4
        // widgets showed nothing).
        //
        // These two grants are what make HR Manager a genuinely different
        // workspace from Department Head and Executive rather than a third
        // copy: same navigation by construction, but a people-shaped
        // dashboard — productivity and attendance across the organization
        // instead of project delivery.
        "+analytics:productivity:tenant",
        "+analytics:departmentPerformance:tenant",
        // attendance:read/update:tenant — Attendance (Core Workspace Phase
        // 3): HR Manager is the natural tenant-wide attendance authority,
        // same bonus-grant channel as its other HR-flavored tenant grants
        // above.
        "+attendance:read:tenant",
        "+attendance:update:tenant",
        // leave:approve:tenant — Leave Management: same "HR Manager is the
        // natural tenant-wide authority" bonus-grant channel as attendance
        // above — leave is squarely HR's domain.
        "+leave:approve:tenant",
      ],
    },
    {
      id: "role.admin",
      label: "Company Admin",
      rank: 0,
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
        "audit:read:tenant",
        "billing:manage:tenant",
        "featureFlag:manage:tenant",
        "sso:manage:tenant",
        "tenant:delete:tenant",
        "analytics:read:tenant",
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
        "reportAnalysis:create:tenant",
        "document:update:tenant",
        "document:delete:tenant",
        "attendance:create:tenant",
        "attendance:read:tenant",
        "attendance:update:tenant",
        // leave:* — Leave Management: full tenant-wide authority (create/
        // read for the Admin's own requests, approve for anyone's, plus
        // manageTypes to define the tenant's leave types).
        "leave:create:tenant",
        "leave:read:tenant",
        "leave:approve:tenant",
        "leave:manageTypes:tenant",
        // contact/deal:* — CRM: full tenant-wide authority.
        "contact:create:tenant",
        "contact:read:tenant",
        "contact:update:tenant",
        "deal:create:tenant",
        "deal:read:tenant",
        "deal:update:tenant",
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
  // this reorg.
  //
  // "Coming soon" placeholder pages (Team Management, Recruitment, Reviews,
  // Company, Account) removed — a UI/UX audit flagged them as real,
  // permission-gated nav items that led nowhere. See ORG_HIERARCHY.md §12
  // for which of these remain real future design sessions; when one is
  // actually built, give it a real nav entry + page then, not a placeholder
  // ahead of time.
  // Role-Based Workspaces, Stage A — grouped, fully-gated navigation.
  //
  // One static tree per blueprint; the per-role sidebar is produced entirely
  // by `pruneNavItems` (permission-pruner.ts), which removes items a role
  // lacks the permission for and then removes any group left empty. Adding a
  // role — Student included — is therefore blueprint data plus grants, never
  // a frontend change.
  //
  // Previously 7-8 of these carried no `requiredPermission` at all, which is
  // why a Doctor, a Nurse and a Receptionist all opened the identical eleven
  // items. Everything here is now either genuinely universal (Dashboard,
  // Calendar, Leave, Chat, Meetings, Announcements) or gated on a real
  // permission.
  navigation: [
    {
      id: "nav.dashboard",
      label: "Dashboard",
      icon: "home",
      pageId: "page.dashboard",
    },
    {
      id: "nav.work",
      label: "Work",
      icon: "work",
      children: [
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
          id: "nav.crm",
          label: "CRM",
          icon: "handshake",
          pageId: "page.crm",
          requiredPermission: "contact:read",
          moduleKey: "crm",
        },
      ],
    },
    {
      id: "nav.people",
      label: "People",
      icon: "people",
      children: [
        {
          id: "nav.team",
          label: "Employees",
          icon: "users",
          pageId: "page.team",
          requiredPermission: "user:manage",
        },
        {
          id: "nav.hr",
          label: "Teams",
          icon: "sitemap",
          pageId: "page.hr",
          requiredPermission: "department:manage",
        },
      ],
    },
    {
      id: "nav.insights",
      label: "Insights",
      icon: "insights",
      children: [
        {
          id: "nav.analytics",
          label: "Analytics",
          icon: "analytics",
          pageId: "page.analytics",
          requiredPermission: "analytics:read",
        },
      ],
    },
    {
      id: "nav.collaborate",
      label: "Collaborate",
      icon: "collaborate",
      children: [
        {
          id: "nav.chat",
          label: "Chat",
          icon: "chat",
          pageId: "page.chat",
        },
        {
          id: "nav.meetings",
          label: "Meetings",
          icon: "meetings",
          pageId: "page.meetings",
        },
        {
          id: "nav.announcements",
          label: "Announcements",
          icon: "announcements",
          pageId: "page.announcements",
        },
      ],
    },
    {
      id: "nav.personal",
      label: "My Work",
      icon: "personal",
      children: [
        {
          id: "nav.calendar",
          label: "Calendar",
          icon: "calendar",
          pageId: "page.calendar",
        },
        {
          id: "nav.attendance",
          label: "Attendance",
          icon: "attendance",
          pageId: "page.attendance",
          requiredPermission: "attendance:read",
        },
        {
          id: "nav.leave",
          label: "Leave",
          icon: "event_busy",
          pageId: "page.leave",
          moduleKey: "leave",
        },
      ],
    },
    {
      id: "nav.administration",
      label: "Administration",
      icon: "workspace-admin",
      children: [
        {
          id: "nav.roles-permissions",
          label: "Roles & Permissions",
          icon: "roles-permissions",
          pageId: "page.roles-permissions",
          requiredPermission: "role:manage",
        },
        {
          id: "nav.settings",
          label: "Settings",
          icon: "settings",
          pageId: "page.settings",
          requiredPermission: "settings:manage",
        },
        {
          id: "nav.audit-logs",
          label: "Audit Logs",
          icon: "audit-logs",
          pageId: "page.audit-logs",
          requiredPermission: "audit:read",
        },
      ],
    },
  ],
  dashboards: { default: "page.dashboard" },
  modules: ["projects", "tasks", "leave", "crm"],
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
              props: { label: "Active Projects", tone: "accent" },
              bind: { source: "projects.count", params: { status: { const: "active" } } },
            },
            {
              id: "k2",
              type: "KpiCard",
              version: 1,
              props: { label: "My Open Tasks", tone: "info" },
              bind: {
                source: "tasks.count",
                params: { assigneeId: { ref: "user.id" }, status: { const: "todo" } },
              },
            },
            {
              id: "k3",
              type: "KpiCard",
              version: 1,
              props: { label: "Overdue Tasks", tone: "danger" },
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
          // Role-Based Workspaces, Stage C — deliberately NO assigneeId here.
          // `tasksWhere` derives the right rows from the caller's own scope:
          // "own" self-filters, "team"/"department" widen to the group. Pinning
          // assigneeId meant a Lead or Manager could never see their team's
          // tasks on this page.
          bind: { source: "tasks.list", params: {}, paginate: true },
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
      // Mirrors this page's nav item exactly (ARCHITECTURE.md §6.9) — without
      // it the page stays directly fetchable by a role that cannot see the link.
      requiredPermission: "settings:manage",
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
            {
              // Stripe Billing — Admin-only (billing:manage), same gate the
              // whole "Billing & Plan" card presence-checks on.
              kind: "mutation",
              mutation: "billing.createCheckoutSession",
              input: { ref: "form.checkout" },
              requiredPermission: "billing:manage",
            },
            {
              kind: "mutation",
              mutation: "billing.createPortalSession",
              input: { ref: "form.portal" },
              requiredPermission: "billing:manage",
            },
            {
              // Feature Flags (module 3 of the 4-initiative backlog) — Admin-only.
              kind: "mutation",
              mutation: "featureFlag.set",
              input: { ref: "form.featureFlag" },
              requiredPermission: "featureFlag:manage",
            },
            {
              // Enterprise SSO (initiative 2 of the 4-initiative backlog) — Admin-only.
              kind: "mutation",
              mutation: "sso.configure",
              input: { ref: "form.sso" },
              requiredPermission: "sso:manage",
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
    // page.insights retired — consolidated into page.analytics (Core
    // Workspace Modules, Phase 4: Analytics & Insights).
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
      // Mirrors this page's nav item exactly (ARCHITECTURE.md §6.9) — without
      // it the page stays directly fetchable by a role that cannot see the link.
      requiredPermission: "analytics:read",
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
    // Leave Management — ships as a dedicated route from day one (no
    // catch-all detour, this module never existed on the old renderer).
    // This backing Page node exists only for nav-permission-sync and a
    // graceful direct-fetch fallback (permission-pruner.ts) — the real UI
    // is LeaveWorkspace.tsx, mounted by /workspace/leave.
    "page.leave": {
      id: "page.leave",
      type: "Page",
      version: 1,
      children: [{ id: "leave-heading", type: "Heading", version: 1, props: { text: "Leave" } }],
    },
    // CRM — requiredPermission mirrors nav.crm's own gate (permission-
    // pruner.ts's page/nav sync — a permission-gated nav item's backing
    // page must carry the same gate, or a direct pageId fetch could reach
    // it without the grant).
    "page.crm": {
      id: "page.crm",
      type: "Page",
      version: 1,
      requiredPermission: "contact:read",
      children: [{ id: "crm-heading", type: "Heading", version: 1, props: { text: "CRM" } }],
    },
    // Audit Logs — trivial placeholder, same reasoning as page.leave/
    // page.crm above: DEDICATED_ROUTES intercepts navigation before
    // this tree ever actually renders.
    "page.audit-logs": {
      id: "page.audit-logs",
      type: "Page",
      version: 1,
      requiredPermission: "audit:read",
      children: [{ id: "audit-logs-heading", type: "Heading", version: 1, props: { text: "Audit Logs" } }],
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
      rank: 0,
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
        "reportAnalysis:create:tenant",
        "document:update:tenant",
        "document:delete:tenant",
        "role:manage:tenant",
        "audit:read:tenant",
        "billing:manage:tenant",
        "featureFlag:manage:tenant",
        "sso:manage:tenant",
        "tenant:delete:tenant",
        "analytics:read:tenant",
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
        // leave:* — Leave Management: full tenant-wide authority. Healthcare
        // has no generic manager-tier ladder (flat 4-role structure, unlike
        // IT), so — matching that same flatness rather than inventing a
        // middle-management concept that doesn't exist here — approval
        // authority stops at Admin; Doctor/Nurse/Receptionist get only the
        // universal create/read floor below.
        "leave:create:tenant",
        "leave:read:tenant",
        "leave:approve:tenant",
        "leave:manageTypes:tenant",
        // contact/deal:* — CRM: full tenant-wide authority. Same "flat
        // structure, no natural sales-facing role, Admin-only" reasoning as
        // Leave Management's own approval tier in this blueprint —
        // Doctor/Nurse/Receptionist get nothing, a deliberate, disclosed
        // choice, not an oversight.
        "contact:create:tenant",
        "contact:read:tenant",
        "contact:update:tenant",
        "deal:create:tenant",
        "deal:read:tenant",
        "deal:update:tenant",
      ],
    },
    {
      id: "role.doctor",
      label: "Doctor",
      rank: 1,
      permissions: [
        // Role-Based Workspaces, Stage A — this role owns a real book of
        // work whose numbers it is accountable for, so it opens Analytics.
        // Page access only; every metric still enforces its own permission.
        "analytics:read:tenant",
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
        "reportAnalysis:create:tenant",
        "document:update:tenant",
        "meeting:read:tenant",
        "calendarEvent:create:own",
        "attendance:create:own",
        "attendance:read:own",
        "leave:create:own",
        "leave:read:own",
      ],
    },
    {
      id: "role.nurse",
      label: "Nurse",
      rank: 2,
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
        "leave:create:own",
        "leave:read:own",
      
        // Contextual Reporting — a Nurse already reads charts, so can analyse
        // what a Doctor filed there. Deliberately no document:create: a Nurse
        // still originates nothing, and document:update is what selects the
        // clinical lens, so they get the care-delivery reading.
        "reportAnalysis:create:tenant",
      ],
    },
    {
      id: "role.receptionist",
      label: "Receptionist",
      rank: 3,
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
        "leave:create:own",
        "leave:read:own",
      
        // Contextual Reporting — front-desk paperwork on a patient record.
        // ⚠️ document:create WITHOUT document:update is deliberate: the patient
        // anchor selects its CLINICAL lens on document:update, so granting
        // update here would hand a Receptionist a clinical reading of a chart.
        // They upload and analyse; they get the scheduling/admin lens only.
        "project:read:tenant",
        "document:create:tenant",
        "reportAnalysis:create:tenant",
      ],
    },
  ],
  // No Healthcare department taxonomy in Phase A — see this fixture's own
  // header comment. Additive to populate later; not a redesign.
  departmentTypes: [],
  // Role-Based Workspaces, Stage A — grouped, fully-gated navigation.
  //
  // One static tree per blueprint; the per-role sidebar is produced entirely
  // by `pruneNavItems` (permission-pruner.ts), which removes items a role
  // lacks the permission for and then removes any group left empty. Adding a
  // role — Student included — is therefore blueprint data plus grants, never
  // a frontend change.
  //
  // Previously 7-8 of these carried no `requiredPermission` at all, which is
  // why a Doctor, a Nurse and a Receptionist all opened the identical eleven
  // items. Everything here is now either genuinely universal (Dashboard,
  // Calendar, Leave, Chat, Meetings, Announcements) or gated on a real
  // permission.
  navigation: [
    {
      id: "nav.dashboard",
      label: "Dashboard",
      icon: "home",
      pageId: "page.dashboard",
    },
    {
      id: "nav.care",
      label: "Care",
      icon: "care",
      children: [
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
        {
          id: "nav.tasks",
          label: "Care Tasks",
          icon: "check-square",
          pageId: "page.tasks",
          requiredPermission: "task:read",
          moduleKey: "tasks",
        },
      ],
    },
    {
      id: "nav.insights",
      label: "Insights",
      icon: "insights",
      children: [
        {
          id: "nav.analytics",
          label: "Analytics",
          icon: "analytics",
          pageId: "page.analytics",
          requiredPermission: "analytics:read",
        },
      ],
    },
    {
      id: "nav.collaborate",
      label: "Collaborate",
      icon: "collaborate",
      children: [
        {
          id: "nav.chat",
          label: "Chat",
          icon: "chat",
          pageId: "page.chat",
        },
        {
          id: "nav.meetings",
          label: "Meetings",
          icon: "meetings",
          pageId: "page.meetings",
        },
      ],
    },
    {
      id: "nav.personal",
      label: "My Work",
      icon: "personal",
      children: [
        {
          id: "nav.calendar",
          label: "Calendar",
          icon: "calendar",
          pageId: "page.calendar",
        },
        {
          id: "nav.attendance",
          label: "Attendance",
          icon: "attendance",
          pageId: "page.attendance",
          requiredPermission: "attendance:read",
        },
        {
          id: "nav.leave",
          label: "Leave",
          icon: "event_busy",
          pageId: "page.leave",
          moduleKey: "leave",
        },
      ],
    },
    {
      id: "nav.administration",
      label: "Administration",
      icon: "workspace-admin",
      children: [
        {
          id: "nav.crm",
          label: "CRM",
          icon: "handshake",
          pageId: "page.crm",
          requiredPermission: "contact:read",
          moduleKey: "crm",
        },
        {
          id: "nav.roles-permissions",
          label: "Roles & Permissions",
          icon: "roles-permissions",
          pageId: "page.roles-permissions",
          requiredPermission: "role:manage",
        },
        {
          id: "nav.settings",
          label: "Settings",
          icon: "settings",
          pageId: "page.settings",
          requiredPermission: "settings:manage",
        },
        {
          id: "nav.audit-logs",
          label: "Audit Logs",
          icon: "audit-logs",
          pageId: "page.audit-logs",
          requiredPermission: "audit:read",
        },
      ],
    },
  ],
  dashboards: { default: "page.dashboard" },
  modules: ["patients", "appointments", "leave", "crm", "tasks"],
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
    // Role-Based Workspaces, Stage A — the existing Tasks module, surfaced
    // in this blueprint for the first time. Defaults to the signed-in
    // person's own items (`assigneeId: user.id`), matching IT's page.tasks.
    "page.tasks": {
      id: "page.tasks",
      type: "Page",
      version: 1,
      requiredPermission: "task:read",
      children: [
        {
          id: "task-list",
          type: "TaskList",
          version: 1,
          // Role-Based Workspaces, Stage C — deliberately NO assigneeId here.
          // `tasksWhere` derives the right rows from the caller's own scope:
          // "own" self-filters, "team"/"department" widen to the group. Pinning
          // assigneeId meant a Lead or Manager could never see their team's
          // tasks on this page.
          bind: { source: "tasks.list", params: {}, paginate: true },
          actions: [
            { kind: "mutation", mutation: "task.create", input: { ref: "form.newTask" }, requiredPermission: "task:create" },
            { kind: "mutation", mutation: "task.updateStatus", input: { ref: "row.id" }, requiredPermission: "task:update" },
            { kind: "mutation", mutation: "task.reassign", input: { ref: "row.id" }, requiredPermission: "task:update" },
            { kind: "mutation", mutation: "comment.create", input: { ref: "row.id" } },
          ],
        },
      ],
    },
    "page.analytics": {
      id: "page.analytics",
      type: "Page",
      version: 1,
      // Mirrors this page's nav item exactly (ARCHITECTURE.md §6.9) — without
      // it the page stays directly fetchable by a role that cannot see the link.
      requiredPermission: "analytics:read",
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
      // Mirrors this page's nav item exactly (ARCHITECTURE.md §6.9) — without
      // it the page stays directly fetchable by a role that cannot see the link.
      requiredPermission: "settings:manage",
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
            // Stripe Billing — Admin-only (billing:manage), same gate the
            // whole "Billing & Plan" card presence-checks on.
            { kind: "mutation", mutation: "billing.createCheckoutSession", input: { ref: "form.checkout" }, requiredPermission: "billing:manage" },
            { kind: "mutation", mutation: "billing.createPortalSession", input: { ref: "form.portal" }, requiredPermission: "billing:manage" },
            // Feature Flags (module 3 of the 4-initiative backlog) — Admin-only.
            { kind: "mutation", mutation: "featureFlag.set", input: { ref: "form.featureFlag" }, requiredPermission: "featureFlag:manage" },
            // Enterprise SSO (initiative 2 of the 4-initiative backlog) — Admin-only.
            { kind: "mutation", mutation: "sso.configure", input: { ref: "form.sso" }, requiredPermission: "sso:manage" },
          ],
        },
      ],
    },
    // Leave Management — see the IT blueprint's own page.leave comment.
    "page.leave": {
      id: "page.leave",
      type: "Page",
      version: 1,
      children: [{ id: "leave-heading", type: "Heading", version: 1, props: { text: "Leave" } }],
    },
    // CRM — requiredPermission mirrors nav.crm's own gate (permission-
    // pruner.ts's page/nav sync — a permission-gated nav item's backing
    // page must carry the same gate, or a direct pageId fetch could reach
    // it without the grant).
    "page.crm": {
      id: "page.crm",
      type: "Page",
      version: 1,
      requiredPermission: "contact:read",
      children: [{ id: "crm-heading", type: "Heading", version: 1, props: { text: "CRM" } }],
    },
    // Audit Logs — trivial placeholder, same reasoning as page.leave/
    // page.crm above: DEDICATED_ROUTES intercepts navigation before
    // this tree ever actually renders.
    "page.audit-logs": {
      id: "page.audit-logs",
      type: "Page",
      version: 1,
      requiredPermission: "audit:read",
      children: [{ id: "audit-logs-heading", type: "Heading", version: 1, props: { text: "Audit Logs" } }],
    },
  },
};

const EDUCATION_BLUEPRINT_V1 = {
  id: "education",
  version: 1,
  industry: "Education",
  roles: [
    {
      id: "role.admin",
      label: "School Administrator",
      rank: 0,
      permissions: [
        "student:create:tenant",
        "student:read:tenant",
        "student:update:tenant",
        "course:create:tenant",
        "course:read:tenant",
        "course:update:tenant",
        "enrollment:create:tenant",
        "enrollment:read:tenant",
        "enrollment:update:tenant",
        "assignment:create:tenant",
        "assignment:read:tenant",
        "assignment:update:tenant",
        "grade:create:tenant",
        "grade:read:tenant",
        "grade:update:tenant",
        "project:create:tenant",
        "project:read:tenant",
        "project:update:tenant",
        "project:delete:tenant",
        "task:create:tenant",
        "task:read:tenant",
        "task:update:tenant",
        "task:delete:tenant",
        "document:create:tenant",
        "reportAnalysis:create:tenant",
        "document:update:tenant",
        "document:delete:tenant",
        "role:manage:tenant",
        "audit:read:tenant",
        "billing:manage:tenant",
        "featureFlag:manage:tenant",
        "sso:manage:tenant",
        "tenant:delete:tenant",
        "analytics:read:tenant",
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
        // leave:* — Leave Management: full tenant-wide authority. Same
        // "flat structure, approval stops at Admin" reasoning as Healthcare
        // — Education has no generic manager-tier ladder either.
        "leave:create:tenant",
        "leave:read:tenant",
        "leave:approve:tenant",
        "leave:manageTypes:tenant",
        // contact/deal:* — CRM: full tenant-wide authority. Same flat-
        // blueprint, Admin-only reasoning as Healthcare — Teacher/Teaching
        // Assistant/Registrar get nothing.
        "contact:create:tenant",
        "contact:read:tenant",
        "contact:update:tenant",
        "deal:create:tenant",
        "deal:read:tenant",
        "deal:update:tenant",
      ],
    },
    {
      id: "role.teacher",
      label: "Teacher",
      rank: 1,
      permissions: [
        // Role-Based Workspaces, Stage A — this role owns a real book of
        // work whose numbers it is accountable for, so it opens Analytics.
        // Page access only; every metric still enforces its own permission.
        "analytics:read:tenant",
        // Needs to look up any student/course (coordination, substitute
        // coverage), but may only edit courses actually assigned to them —
        // identical reasoning to Doctor's patient:read:tenant / patient:update:own.
        "student:read:tenant",
        "course:read:tenant",
        "course:update:own",
        // The domain's real gradebook authority — own-scoped through the
        // Course -> Assignment -> Grade chain (see grades.data-sources.ts).
        "assignment:create:own",
        "assignment:read:own",
        "assignment:update:own",
        "grade:create:own",
        "grade:read:own",
        "grade:update:own",
        // See this fixture's own header comment for why these three stay
        // :tenant rather than :own — materialsProjectId is always owned by
        // whichever Admin ran course.create (course:create is Admin-only in
        // Phase A), never the assigned teacher, so an :own grant here would
        // never actually reach a Teacher's own course materials.
        "project:read:tenant",
        "task:create:tenant",
        "task:read:tenant",
        "task:update:tenant",
        "document:create:tenant",
        "reportAnalysis:create:tenant",
        "document:update:tenant",
        "meeting:read:tenant",
        "calendarEvent:create:own",
        "attendance:create:own",
        "attendance:read:own",
        "leave:create:own",
        "leave:read:own",
      ],
    },
    {
      id: "role.teaching-assistant",
      label: "Teaching Assistant",
      rank: 2,
      permissions: [
        "student:read:tenant",
        "course:read:tenant",
        // Broader than Teacher's own-scoped reach — a TA supports multiple
        // teachers' courses, not just one, mirroring Nurse's broader
        // appointment:read:tenant vs Doctor's :own. No create/update on
        // either — narrower authority than Teacher, the concrete "sees more,
        // originates nothing" differentiation for this role.
        "assignment:read:tenant",
        "grade:read:tenant",
        "project:read:tenant",
        // Contextual Reporting — cohort overview lens, never the
        // teacher's per-student reading (that needs grade:create).
        "reportAnalysis:create:tenant",
        "task:read:tenant",
        "task:update:tenant",
        "meeting:read:tenant",
        "calendarEvent:create:own",
        "attendance:create:own",
        "attendance:read:own",
        "leave:create:own",
        "leave:read:own",
      ],
    },
    {
      id: "role.registrar",
      label: "Registrar",
      rank: 3,
      permissions: [
        // Role-Based Workspaces, Stage A — this role owns a real book of
        // work whose numbers it is accountable for, so it opens Analytics.
        // Page access only; every metric still enforces its own permission.
        "analytics:read:tenant",
        // Owns the Student/Enrollment lifecycle tenant-wide — no
        // project/task/document, no assignment/grade at all. A registrar
        // never becomes a course's materialsProject member and never touches
        // the gradebook — not a special-cased rule, just the natural
        // consequence of never being granted it. The concrete, demonstrable
        // "different roles see genuinely different things" proof for this
        // domain, mirroring Receptionist's own exact precedent.
        "student:create:tenant",
        "student:read:tenant",
        "student:update:tenant",
        "course:read:tenant", // to pick a real course when enrolling a student
        "enrollment:create:tenant",
        "enrollment:read:tenant",
        "enrollment:update:tenant",
        "meeting:read:tenant",
        "calendarEvent:create:own",
        "attendance:create:own",
        "attendance:read:own",
        "leave:create:own",
        "leave:read:own",
      
        // Contextual Reporting — the student file (Student.filesProjectId) is a
        // Registrar's actual paperwork. Still no assignment or grade grant, so
        // the gradebook stays structurally out of reach and the course lens
        // they match is enrolment compliance, never class performance.
        "project:read:tenant",
        "document:create:tenant",
        "document:update:tenant",
        "reportAnalysis:create:tenant",
      ],
    },
    {
      // Student Role (2026-08-25) — the first learner-facing role on the
      // platform, and the role the Stage A navigation redesign was explicitly
      // built to absorb without a frontend rebuild.
      //
      // The grant list is deliberately the shortest of any role in any
      // blueprint. A student reads their own record; they do not read "the
      // students module". Everything personal — courses, assignments,
      // progress — resolves through `studentPortal:read` and is
      // ownership-scoped to their own Student row inside the resolver, so no
      // `student:read` / `enrollment:read` / `grade:read` grant appears here
      // at all. Granting those would hand a student the whole school's
      // records at tenant scope, which is precisely the failure this design
      // avoids.
      //
      // No `:own` scope on studentPortal — the resource has no scope ladder;
      // it either is your portal or it is not.
      id: "role.student",
      label: "Student",
      rank: 4,
      permissions: [
        "studentPortal:read:own",
        // Contextual Reporting — submitting work, and checking their own
        // before it is marked. `project:read:own` is safe here in a way it
        // was NOT for course materials: a submissions project is created per
        // enrolment with the student as its owner, so ownerId matching is
        // exactly right. Course materials still come via myCourseMaterials.
        "project:read:own",
        "document:create:own",
        "reportAnalysis:create:own",
        // ⚠️ Deliberately NO `project:*` grant, and the reason is the same
        // trap this fixture already documents for Teacher. Course materials
        // live on the Course's materialsProject, but `projectsWhere` at `own`
        // scope filters on `ownerId` and never looks at membership — and the
        // materialsProject is owned by the Admin who ran `course.create`, so
        // `project:read:own` refuses a student who IS a real ProjectMember.
        // The scope above it (`team`) does check membership but also ORs in
        // the whole department. `myCourseMaterials.list` draws the boundary
        // from enrolment instead, so no project grant is needed at all.
        //
        // Their own attendance record and history, via the same
        // userId-keyed AttendanceRecord every staff role already uses.
        "attendance:create:own",
        "attendance:read:own",
        // Their own timetable. `calendarEvent:create:own` is deliberately
        // absent — a student adding events to the school calendar is a
        // different feature, not part of a read-first portal.
        "meeting:read:own",
      ],
    },
  ],
  // No Education department taxonomy in Phase A — same disclosed MVP
  // narrowing as Healthcare's own Phase A; none of the 5 new models have a
  // departmentId column.
  departmentTypes: [],
  // Role-Based Workspaces, Stage A — grouped, fully-gated navigation.
  //
  // One static tree per blueprint; the per-role sidebar is produced entirely
  // by `pruneNavItems` (permission-pruner.ts), which removes items a role
  // lacks the permission for and then removes any group left empty. Adding a
  // role — Student included — is therefore blueprint data plus grants, never
  // a frontend change.
  //
  // Previously 7-8 of these carried no `requiredPermission` at all, which is
  // why a Doctor, a Nurse and a Receptionist all opened the identical eleven
  // items. Everything here is now either genuinely universal (Dashboard,
  // Calendar, Leave, Chat, Meetings, Announcements) or gated on a real
  // permission.
  navigation: [
    {
      id: "nav.dashboard",
      label: "Dashboard",
      icon: "home",
      pageId: "page.dashboard",
    },
    {
      id: "nav.academics",
      label: "Academics",
      icon: "academics",
      children: [
        {
          id: "nav.students",
          label: "Students",
          icon: "group",
          pageId: "page.students",
          requiredPermission: "student:read",
          moduleKey: "students",
        },
        {
          id: "nav.courses",
          label: "Courses",
          icon: "school",
          pageId: "page.courses",
          requiredPermission: "course:read",
          moduleKey: "courses",
        },
        {
          id: "nav.tasks",
          label: "Coursework",
          icon: "check-square",
          pageId: "page.tasks",
          requiredPermission: "task:read",
          moduleKey: "tasks",
        },
      ],
    },
    {
      // Student Role (2026-08-25). The learner's half of Academics, kept as
      // its own group rather than merged into it: "Students / Courses /
      // Coursework" is the register a school *keeps*; "My Courses /
      // Assignments / My Progress" is what a learner *has*. One gate for the
      // whole group, so a student sees three items and every staff role sees
      // none — see `studentPortal:read` in the permission catalog for why
      // this is not `enrollment:read:own`.
      id: "nav.my-studies",
      label: "My Studies",
      icon: "academics",
      children: [
        {
          id: "nav.my-courses",
          label: "My Courses",
          icon: "school",
          pageId: "page.my-courses",
          requiredPermission: "studentPortal:read",
        },
        {
          id: "nav.my-assignments",
          label: "Assignments",
          icon: "check-square",
          pageId: "page.my-assignments",
          requiredPermission: "studentPortal:read",
        },
        {
          id: "nav.my-progress",
          label: "My Progress",
          icon: "insights",
          pageId: "page.my-progress",
          requiredPermission: "studentPortal:read",
        },
      ],
    },
    {
      id: "nav.insights",
      label: "Insights",
      icon: "insights",
      children: [
        {
          id: "nav.analytics",
          label: "Analytics",
          icon: "analytics",
          pageId: "page.analytics",
          requiredPermission: "analytics:read",
        },
      ],
    },
    {
      id: "nav.collaborate",
      label: "Collaborate",
      icon: "collaborate",
      children: [
        {
          id: "nav.chat",
          label: "Chat",
          icon: "chat",
          pageId: "page.chat",
        },
        {
          id: "nav.meetings",
          label: "Meetings",
          icon: "meetings",
          pageId: "page.meetings",
        },
        {
          // Announcements existed platform-wide but was never surfaced in
          // this blueprint for ANY role — a gap found while building the
          // Student role, and fixed for everyone rather than added as a
          // student-only special case. Universal, same as the two above.
          id: "nav.announcements",
          label: "Announcements",
          icon: "announcements",
          pageId: "page.announcements",
        },
      ],
    },
    {
      id: "nav.personal",
      label: "My Work",
      icon: "personal",
      children: [
        {
          id: "nav.calendar",
          label: "Calendar",
          icon: "calendar",
          pageId: "page.calendar",
        },
        {
          id: "nav.attendance",
          label: "Attendance",
          icon: "attendance",
          pageId: "page.attendance",
          requiredPermission: "attendance:read",
        },
        {
          // Gated on `leave:read` as of the Student role. Every staff role in
          // this blueprint already holds it, so nothing changes for them —
          // but it was previously ungated, which would have put staff *leave
          // requests* in a student's sidebar. An ungated "universal" item is
          // only universal until a role arrives that isn't an employee.
          id: "nav.leave",
          label: "Leave",
          icon: "event_busy",
          pageId: "page.leave",
          requiredPermission: "leave:read",
          moduleKey: "leave",
        },
      ],
    },
    {
      id: "nav.administration",
      label: "Administration",
      icon: "workspace-admin",
      children: [
        {
          id: "nav.crm",
          label: "CRM",
          icon: "handshake",
          pageId: "page.crm",
          requiredPermission: "contact:read",
          moduleKey: "crm",
        },
        {
          id: "nav.roles-permissions",
          label: "Roles & Permissions",
          icon: "roles-permissions",
          pageId: "page.roles-permissions",
          requiredPermission: "role:manage",
        },
        {
          id: "nav.settings",
          label: "Settings",
          icon: "settings",
          pageId: "page.settings",
          requiredPermission: "settings:manage",
        },
        {
          id: "nav.audit-logs",
          label: "Audit Logs",
          icon: "audit-logs",
          pageId: "page.audit-logs",
          requiredPermission: "audit:read",
        },
      ],
    },
  ],
  dashboards: { default: "page.dashboard" },
  modules: ["students", "courses", "leave", "crm", "tasks"],
  pages: {
    "page.dashboard": {
      id: "page.dashboard",
      type: "Page",
      version: 1,
      // Deliberately minimal, same treatment as Healthcare's own
      // page.dashboard — no requiredPermission (must never be
      // permission-gated, see main()'s own sanity check below). Role-specific
      // widget curation belongs on page.analytics via
      // DEFAULT_DASHBOARD_WIDGET_KEYS in a later phase, not duplicated here.
      children: [{ id: "hdr", type: "Heading", version: 1, props: { text: "Good morning, {{user.displayName}}" } }],
    },
    "page.students": {
      id: "page.students",
      type: "Page",
      version: 1,
      requiredPermission: "student:read",
      children: [
        {
          id: "students-workspace",
          type: "StudentsWorkspace",
          version: 1,
          props: { title: "Students" },
          bind: { source: "students.list", params: {} },
          actions: [
            { kind: "mutation", mutation: "student.register", input: { ref: "form.registerStudent" }, requiredPermission: "student:create" },
            { kind: "mutation", mutation: "student.updateStatus", input: { ref: "row.id" }, requiredPermission: "student:update" },
          ],
        },
      ],
    },
    "page.courses": {
      id: "page.courses",
      type: "Page",
      version: 1,
      requiredPermission: "course:read",
      children: [
        {
          id: "courses-workspace",
          type: "CoursesWorkspace",
          version: 1,
          props: { title: "Courses" },
          bind: { source: "courses.list", params: {} },
          actions: [
            { kind: "mutation", mutation: "course.create", input: { ref: "form.newCourse" }, requiredPermission: "course:create" },
            { kind: "mutation", mutation: "course.updateStatus", input: { ref: "row.id" }, requiredPermission: "course:update" },
            { kind: "mutation", mutation: "course.assignTeacher", input: { ref: "row.id" }, requiredPermission: "course:update" },
          ],
        },
      ],
    },
    // ---- Student Role (2026-08-25) ---------------------------------------
    // Three pages, one gate. Each mirrors its nav item's `studentPortal:read`
    // exactly, per §6.9 — a looser gate here would leave them fetchable by
    // direct URL for a Teacher, which is the whole class of bug Stage E's
    // sweep exists to catch.
    //
    // None of them takes a `params` binding identifying *which* student. That
    // is deliberate and is the entire security design: the source resolves
    // the caller's own Student row from `ctx.userId` server-side, so there is
    // no id in the request to tamper with and no way to ask for someone
    // else's record. The same reasoning that removed `assigneeId` from
    // page.tasks in Stage C.
    "page.my-courses": {
      id: "page.my-courses",
      type: "Page",
      version: 1,
      requiredPermission: "studentPortal:read",
      children: [
        {
          id: "my-courses-workspace",
          type: "StudentCourses",
          version: 1,
          props: { title: "My Courses" },
          bind: { source: "myCourses.list", params: {} },
        },
      ],
    },
    "page.my-assignments": {
      id: "page.my-assignments",
      type: "Page",
      version: 1,
      requiredPermission: "studentPortal:read",
      children: [
        {
          id: "my-assignments-workspace",
          type: "StudentAssignments",
          version: 1,
          props: { title: "Assignments" },
          bind: { source: "myAssignments.list", params: {} },
        },
      ],
    },
    "page.my-progress": {
      id: "page.my-progress",
      type: "Page",
      version: 1,
      requiredPermission: "studentPortal:read",
      children: [
        {
          id: "my-progress-workspace",
          type: "StudentProgress",
          version: 1,
          props: { title: "My Progress" },
          bind: { source: "myProgress.get", params: {} },
        },
      ],
    },
    // Everything below reuses an existing blueprint page's own real content
    // verbatim (same composite type, same actions/mutations) — copied, not
    // referenced, since `pages` is a per-blueprint map; zero new frontend
    // code either way, only JSON. Detail-page mutations (enrollment.enroll,
    // assignment.create/update, grade.record/update, comment.create,
    // document.*) are triggered directly from CourseDetail/StudentDetail via
    // useRenderContext().callMutation, not declared here — exactly how
    // ProjectDetail.tsx already calls project.addMember/removeMember today
    // without them appearing in page.projects's own actions.
    // Role-Based Workspaces, Stage A — the existing Tasks module, surfaced
    // in this blueprint for the first time. Defaults to the signed-in
    // person's own items (`assigneeId: user.id`), matching IT's page.tasks.
    "page.tasks": {
      id: "page.tasks",
      type: "Page",
      version: 1,
      requiredPermission: "task:read",
      children: [
        {
          id: "task-list",
          type: "TaskList",
          version: 1,
          // Role-Based Workspaces, Stage C — deliberately NO assigneeId here.
          // `tasksWhere` derives the right rows from the caller's own scope:
          // "own" self-filters, "team"/"department" widen to the group. Pinning
          // assigneeId meant a Lead or Manager could never see their team's
          // tasks on this page.
          bind: { source: "tasks.list", params: {}, paginate: true },
          actions: [
            { kind: "mutation", mutation: "task.create", input: { ref: "form.newTask" }, requiredPermission: "task:create" },
            { kind: "mutation", mutation: "task.updateStatus", input: { ref: "row.id" }, requiredPermission: "task:update" },
            { kind: "mutation", mutation: "task.reassign", input: { ref: "row.id" }, requiredPermission: "task:update" },
            { kind: "mutation", mutation: "comment.create", input: { ref: "row.id" } },
          ],
        },
      ],
    },
    "page.analytics": {
      id: "page.analytics",
      type: "Page",
      version: 1,
      // Mirrors this page's nav item exactly (ARCHITECTURE.md §6.9) — without
      // it the page stays directly fetchable by a role that cannot see the link.
      requiredPermission: "analytics:read",
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
    // Announcements — the page half of the nav item added above. Copied
    // verbatim from the other blueprints (`pages` is a per-blueprint map),
    // so no new frontend code. Ungated, matching page.chat/page.meetings;
    // `announcements.list` scope-resolves what each role may actually read,
    // and the create action carries its own gate so the button only appears
    // for a role that holds `announcement:create`.
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
            { kind: "mutation", mutation: "announcement.create", input: { ref: "form.newAnnouncement" }, requiredPermission: "announcement:create" },
            // No requiredPermission — ownership-only, matching
            // comment.delete/message.delete's precedent.
            { kind: "mutation", mutation: "announcement.delete", input: { ref: "row.id" } },
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
      // Mirrors this page's nav item exactly (ARCHITECTURE.md §6.9) — without
      // it the page stays directly fetchable by a role that cannot see the link.
      requiredPermission: "settings:manage",
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
            // Stripe Billing — Admin-only (billing:manage), same gate the
            // whole "Billing & Plan" card presence-checks on.
            { kind: "mutation", mutation: "billing.createCheckoutSession", input: { ref: "form.checkout" }, requiredPermission: "billing:manage" },
            { kind: "mutation", mutation: "billing.createPortalSession", input: { ref: "form.portal" }, requiredPermission: "billing:manage" },
            // Feature Flags (module 3 of the 4-initiative backlog) — Admin-only.
            { kind: "mutation", mutation: "featureFlag.set", input: { ref: "form.featureFlag" }, requiredPermission: "featureFlag:manage" },
            // Enterprise SSO (initiative 2 of the 4-initiative backlog) — Admin-only.
            { kind: "mutation", mutation: "sso.configure", input: { ref: "form.sso" }, requiredPermission: "sso:manage" },
          ],
        },
      ],
    },
    "page.leave": {
      id: "page.leave",
      type: "Page",
      version: 1,
      // Mirrors nav.leave's own gate (§6.9). Added with the Student role: the
      // nav item became gated, and a page left ungated behind a gated nav item
      // is exactly the direct-URL hole that rule exists to close.
      requiredPermission: "leave:read",
      children: [{ id: "leave-heading", type: "Heading", version: 1, props: { text: "Leave" } }],
    },
    // CRM — requiredPermission mirrors nav.crm's own gate (permission-
    // pruner.ts's page/nav sync — a permission-gated nav item's backing
    // page must carry the same gate, or a direct pageId fetch could reach
    // it without the grant).
    "page.crm": {
      id: "page.crm",
      type: "Page",
      version: 1,
      requiredPermission: "contact:read",
      children: [{ id: "crm-heading", type: "Heading", version: 1, props: { text: "CRM" } }],
    },
    // Audit Logs — trivial placeholder, same reasoning as page.leave/
    // page.crm above: DEDICATED_ROUTES intercepts navigation before
    // this tree ever actually renders.
    "page.audit-logs": {
      id: "page.audit-logs",
      type: "Page",
      version: 1,
      requiredPermission: "audit:read",
      children: [{ id: "audit-logs-heading", type: "Heading", version: 1, props: { text: "Audit Logs" } }],
    },
  },
};

const FINANCE_BLUEPRINT_V1 = {
  id: "finance",
  version: 1,
  industry: "Finance",
  // 4 flat roles, no `extends` chains — same precedent Healthcare/Education
  // both established. Designed around a real accounting control (separation
  // of duties), not an arbitrary read/write split: Accountant is the only
  // role holding both invoice AND payment authority; Billing Clerk can
  // issue/manage invoices but can never record a payment against one — the
  // person who creates an invoice must not also be the one who marks it
  // paid. Sales Rep owns client relationships and sees only their own
  // clients' invoices, with zero billing/payment authority at all.
  roles: [
    {
      id: "role.admin",
      label: "Finance Director",
      rank: 0,
      permissions: [
        "client:create:tenant",
        "client:read:tenant",
        "client:update:tenant",
        "invoice:create:tenant",
        "invoice:read:tenant",
        "invoice:update:tenant",
        "payment:create:tenant",
        "payment:read:tenant",
        "project:create:tenant",
        "project:read:tenant",
        "project:update:tenant",
        "project:delete:tenant",
        "task:create:tenant",
        "task:read:tenant",
        "task:update:tenant",
        "task:delete:tenant",
        "document:create:tenant",
        "reportAnalysis:create:tenant",
        "document:update:tenant",
        "document:delete:tenant",
        "role:manage:tenant",
        "audit:read:tenant",
        "billing:manage:tenant",
        "featureFlag:manage:tenant",
        "sso:manage:tenant",
        "tenant:delete:tenant",
        "analytics:read:tenant",
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
        // leave:* — Leave Management: full tenant-wide authority. Same
        // "flat structure, approval stops at Admin" reasoning as
        // Healthcare/Education — Finance has no generic manager-tier ladder.
        "leave:create:tenant",
        "leave:read:tenant",
        "leave:approve:tenant",
        "leave:manageTypes:tenant",
        // contact/deal:* — CRM: full tenant-wide authority.
        "contact:create:tenant",
        "contact:read:tenant",
        "contact:update:tenant",
        "deal:create:tenant",
        "deal:read:tenant",
        "deal:update:tenant",
      ],
    },
    {
      // The only role holding both invoice AND payment authority — the real
      // financial-operations tier, mirrors Doctor's/Teacher's core-authority
      // role in the prior two domains.
      id: "role.accountant",
      label: "Accountant",
      rank: 1,
      permissions: [
        // Role-Based Workspaces, Stage A — this role owns a real book of
        // work whose numbers it is accountable for, so it opens Analytics.
        // Page access only; every metric still enforces its own permission.
        "analytics:read:tenant",
        "client:read:tenant",
        "invoice:create:tenant",
        "invoice:read:tenant",
        "invoice:update:tenant",
        "payment:create:tenant",
        "payment:read:tenant",
        // project:read:tenant (not :own) — an Accountant legitimately needs
        // cross-account visibility into client files for collections/
        // reconciliation work, unlike Sales Rep's confidentiality-scoped :own.
        "project:read:tenant",
        "document:create:tenant",
        "reportAnalysis:create:tenant",
        "document:update:tenant",
        "task:create:tenant",
        "task:read:tenant",
        "task:update:tenant",
        "meeting:read:tenant",
        "calendarEvent:create:own",
        "attendance:create:own",
        "attendance:read:own",
        "leave:create:own",
        "leave:read:own",
      ],
    },
    {
      // Separation-of-duties role: can issue/manage invoices (AR clerk
      // duties) but holds ZERO payment:* — cannot record a payment against
      // an invoice it created. Also holds no project:read at all — a
      // billing clerk has no legitimate need to see client correspondence/
      // contracts, the concrete "structurally excluded" proof for this
      // domain (mirrors Receptionist/Registrar's own precedent).
      id: "role.billing-clerk",
      label: "Billing Clerk",
      rank: 2,
      permissions: [
        "client:read:tenant",
        "invoice:create:tenant",
        "invoice:read:tenant",
        "invoice:update:tenant",
        "task:read:tenant",
        "task:update:tenant",
        "meeting:read:tenant",
        "calendarEvent:create:own",
        "attendance:create:own",
        "attendance:read:own",
        "leave:create:own",
        "leave:read:own",
      
        // Contextual Reporting — client files (Client.filesProjectId already
        // exists, so no new anchor). invoice:update selects the receivables
        // lens; they never match the financial-position lens, which needs
        // payment:create.
        "project:read:tenant",
        "document:create:tenant",
        "reportAnalysis:create:tenant",
      ],
    },
    {
      // Owns client relationships (accountManagerId) — a REAL, non-inert
      // :own scope (client:create is tenant-wide for this role, so a Sales
      // Rep genuinely owns the clients they create). Sees only their own
      // clients' invoices (invoice:read:own, resolved transitively through
      // Client via salesRepOwnedClientIds) — zero billing/payment authority
      // at all, a pure relationship-owner role.
      id: "role.sales-rep",
      label: "Account Manager",
      rank: 3,
      permissions: [
        // Role-Based Workspaces, Stage A — this role owns a real book of
        // work whose numbers it is accountable for, so it opens Analytics.
        // Page access only; every metric still enforces its own permission.
        "analytics:read:tenant",
        "client:create:tenant",
        "client:read:tenant",
        "client:update:own",
        "invoice:read:own",
        // project:read:own — confidentiality-scoped: a Sales Rep sees only
        // the Files Project backing clients they themselves created/own,
        // never a colleague's. Real because client:create makes them the
        // Project's ownerId (see client.create's own doc comment).
        "project:read:own",
        "document:create:tenant",
        "reportAnalysis:create:tenant",
        "document:update:tenant",
        "task:create:tenant",
        "task:read:tenant",
        "task:update:tenant",
        "meeting:read:tenant",
        "calendarEvent:create:own",
        "attendance:create:own",
        "attendance:read:own",
        "leave:create:own",
        "leave:read:own",
        // contact/deal:*:own — CRM: the one blueprint where this maps onto
        // an existing, real identity — Account Manager already owns client
        // relationships (client:*:own above); Leads/Deals are the same kind
        // of relationship, just pre-billing. Same asymmetric shape as
        // Client itself: create/read wide open (:tenant — a Sales Rep can
        // see the whole team's pipeline for coverage/handoff), update
        // restricted to what they actually own.
        "contact:create:tenant",
        "contact:read:tenant",
        "contact:update:own",
        "deal:create:tenant",
        "deal:read:tenant",
        "deal:update:own",
      ],
    },
  ],
  // No Finance department taxonomy in Phase A — same disclosed MVP
  // narrowing as Healthcare/Education's own Phase A; none of the 3 new
  // models have a departmentId column.
  departmentTypes: [],
  // Role-Based Workspaces, Stage A — grouped, fully-gated navigation.
  //
  // One static tree per blueprint; the per-role sidebar is produced entirely
  // by `pruneNavItems` (permission-pruner.ts), which removes items a role
  // lacks the permission for and then removes any group left empty. Adding a
  // role — Student included — is therefore blueprint data plus grants, never
  // a frontend change.
  //
  // Previously 7-8 of these carried no `requiredPermission` at all, which is
  // why a Doctor, a Nurse and a Receptionist all opened the identical eleven
  // items. Everything here is now either genuinely universal (Dashboard,
  // Calendar, Leave, Chat, Meetings, Announcements) or gated on a real
  // permission.
  navigation: [
    {
      id: "nav.dashboard",
      label: "Dashboard",
      icon: "home",
      pageId: "page.dashboard",
    },
    {
      id: "nav.accounts",
      label: "Accounts",
      icon: "accounts",
      children: [
        {
          id: "nav.clients",
          label: "Clients",
          icon: "group",
          pageId: "page.clients",
          requiredPermission: "client:read",
          moduleKey: "clients",
        },
        {
          id: "nav.invoices",
          label: "Invoices",
          icon: "receipt",
          pageId: "page.invoices",
          requiredPermission: "invoice:read",
          moduleKey: "invoices",
        },
        {
          id: "nav.crm",
          label: "CRM",
          icon: "handshake",
          pageId: "page.crm",
          requiredPermission: "contact:read",
          moduleKey: "crm",
        },
      ],
    },
    {
      id: "nav.insights",
      label: "Insights",
      icon: "insights",
      children: [
        {
          id: "nav.analytics",
          label: "Analytics",
          icon: "analytics",
          pageId: "page.analytics",
          requiredPermission: "analytics:read",
        },
      ],
    },
    {
      id: "nav.collaborate",
      label: "Collaborate",
      icon: "collaborate",
      children: [
        {
          id: "nav.chat",
          label: "Chat",
          icon: "chat",
          pageId: "page.chat",
        },
        {
          id: "nav.meetings",
          label: "Meetings",
          icon: "meetings",
          pageId: "page.meetings",
        },
      ],
    },
    {
      id: "nav.personal",
      label: "My Work",
      icon: "personal",
      children: [
        {
          id: "nav.calendar",
          label: "Calendar",
          icon: "calendar",
          pageId: "page.calendar",
        },
        {
          id: "nav.attendance",
          label: "Attendance",
          icon: "attendance",
          pageId: "page.attendance",
          requiredPermission: "attendance:read",
        },
        {
          id: "nav.leave",
          label: "Leave",
          icon: "event_busy",
          pageId: "page.leave",
          moduleKey: "leave",
        },
      ],
    },
    {
      id: "nav.administration",
      label: "Administration",
      icon: "workspace-admin",
      children: [
        {
          id: "nav.roles-permissions",
          label: "Roles & Permissions",
          icon: "roles-permissions",
          pageId: "page.roles-permissions",
          requiredPermission: "role:manage",
        },
        {
          id: "nav.settings",
          label: "Settings",
          icon: "settings",
          pageId: "page.settings",
          requiredPermission: "settings:manage",
        },
        {
          id: "nav.audit-logs",
          label: "Audit Logs",
          icon: "audit-logs",
          pageId: "page.audit-logs",
          requiredPermission: "audit:read",
        },
      ],
    },
  ],
  dashboards: { default: "page.dashboard" },
  modules: ["clients", "invoices", "leave", "crm"],
  pages: {
    "page.dashboard": {
      id: "page.dashboard",
      type: "Page",
      version: 1,
      // Deliberately minimal, same treatment as every prior domain's own
      // page.dashboard — no requiredPermission (must never be
      // permission-gated, see main()'s own sanity check below). Role-specific
      // widget curation belongs on page.analytics via
      // DEFAULT_DASHBOARD_WIDGET_KEYS in a later phase, not duplicated here.
      children: [{ id: "hdr", type: "Heading", version: 1, props: { text: "Good morning, {{user.displayName}}" } }],
    },
    "page.clients": {
      id: "page.clients",
      type: "Page",
      version: 1,
      requiredPermission: "client:read",
      children: [
        {
          id: "clients-workspace",
          type: "ClientsWorkspace",
          version: 1,
          props: { title: "Clients" },
          bind: { source: "clients.list", params: {} },
          actions: [
            { kind: "mutation", mutation: "client.create", input: { ref: "form.newClient" }, requiredPermission: "client:create" },
            { kind: "mutation", mutation: "client.updateStatus", input: { ref: "row.id" }, requiredPermission: "client:update" },
          ],
        },
      ],
    },
    "page.invoices": {
      id: "page.invoices",
      type: "Page",
      version: 1,
      requiredPermission: "invoice:read",
      children: [
        {
          id: "invoices-workspace",
          type: "InvoicesWorkspace",
          version: 1,
          props: { title: "Invoices" },
          bind: { source: "invoices.list", params: {} },
          actions: [
            { kind: "mutation", mutation: "invoice.create", input: { ref: "form.newInvoice" }, requiredPermission: "invoice:create" },
            { kind: "mutation", mutation: "invoice.updateStatus", input: { ref: "row.id" }, requiredPermission: "invoice:update" },
          ],
        },
      ],
    },
    // Everything below reuses an existing blueprint page's own real content
    // verbatim (same composite type, same actions/mutations) — copied, not
    // referenced, since `pages` is a per-blueprint map; zero new frontend
    // code either way, only JSON. Detail-page mutations (client.assignAccountManager,
    // payment.record, comment.create, document.*) are triggered directly
    // from ClientDetail/InvoiceDetail via useRenderContext().callMutation,
    // not declared here — exactly how ProjectDetail.tsx already calls
    // project.addMember/removeMember today without them appearing in
    // page.projects's own actions.
    "page.analytics": {
      id: "page.analytics",
      type: "Page",
      version: 1,
      // Mirrors this page's nav item exactly (ARCHITECTURE.md §6.9) — without
      // it the page stays directly fetchable by a role that cannot see the link.
      requiredPermission: "analytics:read",
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
      // Mirrors this page's nav item exactly (ARCHITECTURE.md §6.9) — without
      // it the page stays directly fetchable by a role that cannot see the link.
      requiredPermission: "settings:manage",
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
            // Stripe Billing — Admin-only (billing:manage), same gate the
            // whole "Billing & Plan" card presence-checks on.
            { kind: "mutation", mutation: "billing.createCheckoutSession", input: { ref: "form.checkout" }, requiredPermission: "billing:manage" },
            { kind: "mutation", mutation: "billing.createPortalSession", input: { ref: "form.portal" }, requiredPermission: "billing:manage" },
            // Feature Flags (module 3 of the 4-initiative backlog) — Admin-only.
            { kind: "mutation", mutation: "featureFlag.set", input: { ref: "form.featureFlag" }, requiredPermission: "featureFlag:manage" },
            // Enterprise SSO (initiative 2 of the 4-initiative backlog) — Admin-only.
            { kind: "mutation", mutation: "sso.configure", input: { ref: "form.sso" }, requiredPermission: "sso:manage" },
          ],
        },
      ],
    },
    "page.leave": {
      id: "page.leave",
      type: "Page",
      version: 1,
      children: [{ id: "leave-heading", type: "Heading", version: 1, props: { text: "Leave" } }],
    },
    // CRM — requiredPermission mirrors nav.crm's own gate (permission-
    // pruner.ts's page/nav sync — a permission-gated nav item's backing
    // page must carry the same gate, or a direct pageId fetch could reach
    // it without the grant).
    "page.crm": {
      id: "page.crm",
      type: "Page",
      version: 1,
      requiredPermission: "contact:read",
      children: [{ id: "crm-heading", type: "Heading", version: 1, props: { text: "CRM" } }],
    },
    // Audit Logs — trivial placeholder, same reasoning as page.leave/
    // page.crm above: DEDICATED_ROUTES intercepts navigation before
    // this tree ever actually renders.
    "page.audit-logs": {
      id: "page.audit-logs",
      type: "Page",
      version: 1,
      requiredPermission: "audit:read",
      children: [{ id: "audit-logs-heading", type: "Heading", version: 1, props: { text: "Audit Logs" } }],
    },
  },
};

const MANUFACTURING_BLUEPRINT_V1 = {
  id: "manufacturing",
  version: 1,
  industry: "Manufacturing",
  // 4 flat roles, no `extends` chains — but a genuinely different
  // segregation-of-duties shape than Finance's (which had one "does-both"
  // Accountant tier). Manufacturing instead has three narrow non-admin
  // tiers that each own exactly one leg of a real three-way-match control:
  // the person who orders materials (Procurement Officer) is never the
  // person who confirms they arrived (Warehouse Staff); the person who
  // schedules production (Production Planner) is never the person who
  // confirms it's done (Warehouse Staff again) — nobody but Admin can both
  // create a purchase order and receive it, or both schedule a work order
  // and complete it.
  roles: [
    {
      id: "role.admin",
      label: "Plant Manager",
      rank: 0,
      permissions: [
        "supplier:create:tenant",
        "supplier:read:tenant",
        "supplier:update:tenant",
        "inventoryItem:create:tenant",
        "inventoryItem:read:tenant",
        "inventoryItem:update:tenant",
        "bomLine:create:tenant",
        "bomLine:read:tenant",
        "bomLine:update:tenant",
        "bomLine:delete:tenant",
        "purchaseOrder:create:tenant",
        "purchaseOrder:read:tenant",
        "purchaseOrder:update:tenant",
        "purchaseOrder:receive:tenant",
        "workOrder:create:tenant",
        "workOrder:read:tenant",
        "workOrder:update:tenant",
        "workOrder:complete:tenant",
        "project:create:tenant",
        "project:read:tenant",
        "project:update:tenant",
        "project:delete:tenant",
        "task:create:tenant",
        "task:read:tenant",
        "task:update:tenant",
        "task:delete:tenant",
        "document:create:tenant",
        "reportAnalysis:create:tenant",
        "document:update:tenant",
        "document:delete:tenant",
        "role:manage:tenant",
        "audit:read:tenant",
        "billing:manage:tenant",
        "featureFlag:manage:tenant",
        "sso:manage:tenant",
        "tenant:delete:tenant",
        "analytics:read:tenant",
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
        // leave:* — Leave Management: full tenant-wide authority. Same
        // "flat structure, approval stops at Admin" reasoning as
        // Healthcare/Education/Finance — no generic manager-tier ladder here.
        "leave:create:tenant",
        "leave:read:tenant",
        "leave:approve:tenant",
        "leave:manageTypes:tenant",
        // contact/deal:* — CRM: full tenant-wide authority. Same flat-
        // blueprint, Admin-only reasoning as Healthcare/Education —
        // Production Planner/Procurement Officer/Warehouse Staff get
        // nothing (this blueprint's 3 non-admin roles are all internal-
        // operations-focused, not customer/sales-facing).
        "contact:create:tenant",
        "contact:read:tenant",
        "contact:update:tenant",
        "deal:create:tenant",
        "deal:read:tenant",
        "deal:update:tenant",
      ],
    },
    {
      // Schedules and manages production, owns the recipes (BOM) — but
      // holds ZERO purchaseOrder:* (can't order materials) and, crucially,
      // ZERO workOrder:complete: this role can schedule a work order but
      // can never be the one to confirm it's done. `workOrder:update` is a
      // REAL, non-inert `:own` (assignedToId defaults to the creator on
      // workOrder.create) — a planner can only reschedule/cancel their own
      // work orders, though everyone sees the full shared floor schedule
      // via `:read:tenant`.
      id: "role.production-planner",
      label: "Production Planner",
      rank: 1,
      permissions: [
        // Role-Based Workspaces, Stage A — this role owns a real book of
        // work whose numbers it is accountable for, so it opens Analytics.
        // Page access only; every metric still enforces its own permission.
        "analytics:read:tenant",
        "workOrder:create:tenant",
        "workOrder:read:tenant",
        "workOrder:update:own",
        "bomLine:create:tenant",
        "bomLine:read:tenant",
        "bomLine:update:tenant",
        "bomLine:delete:tenant",
        "inventoryItem:read:tenant",
        "project:read:tenant",
        "document:create:tenant",
        "reportAnalysis:create:tenant",
        "document:update:tenant",
        "task:create:tenant",
        "task:read:tenant",
        "task:update:tenant",
        "meeting:read:tenant",
        "calendarEvent:create:own",
        "attendance:create:own",
        "attendance:read:own",
        "leave:create:own",
        "leave:read:own",
      ],
    },
    {
      // Orders materials from suppliers — but holds ZERO
      // purchaseOrder:receive: this role can create and submit a purchase
      // order but can never be the one to confirm the goods arrived and
      // adjust stock. Also holds zero workOrder:*/bomLine:* — a pure
      // procurement role, structurally excluded from the production side.
      id: "role.procurement-officer",
      label: "Procurement Officer",
      rank: 2,
      permissions: [
        // Role-Based Workspaces, Stage A — this role owns a real book of
        // work whose numbers it is accountable for, so it opens Analytics.
        // Page access only; every metric still enforces its own permission.
        "analytics:read:tenant",
        "purchaseOrder:create:tenant",
        "purchaseOrder:read:tenant",
        "purchaseOrder:update:tenant",
        "supplier:create:tenant",
        "supplier:read:tenant",
        "supplier:update:tenant",
        "inventoryItem:read:tenant",
        "project:read:tenant",
        "document:create:tenant",
        "reportAnalysis:create:tenant",
        "document:update:tenant",
        "task:create:tenant",
        "task:read:tenant",
        "task:update:tenant",
        "meeting:read:tenant",
        "calendarEvent:create:own",
        "attendance:create:own",
        "attendance:read:own",
        "leave:create:own",
        "leave:read:own",
      ],
    },
    {
      // The physical-floor role: the ONLY non-admin role holding
      // purchaseOrder:receive (confirms goods arrived, increments stock)
      // and workOrder:complete (confirms production is done, runs the BOM
      // stock math) — both stock-moving confirmations belong to whoever is
      // actually handling goods, never the role that ordered or scheduled
      // them. Zero purchaseOrder:create/update, zero workOrder:create/update,
      // zero bomLine:*, zero supplier:* — cannot originate any of the
      // paperwork it confirms.
      id: "role.warehouse-staff",
      label: "Warehouse Staff",
      rank: 3,
      permissions: [
        "purchaseOrder:receive:tenant",
        "purchaseOrder:read:tenant",
        "workOrder:complete:tenant",
        "workOrder:read:tenant",
        "inventoryItem:read:tenant",
        "inventoryItem:update:tenant",
        "project:read:tenant",
        "document:create:tenant",
        "reportAnalysis:create:tenant",
        "task:read:tenant",
        "task:update:tenant",
        "meeting:read:tenant",
        "calendarEvent:create:own",
        "attendance:create:own",
        "attendance:read:own",
        "leave:create:own",
        "leave:read:own",
      ],
    },
  ],
  // No Manufacturing department taxonomy in Phase A — same disclosed MVP
  // narrowing as Healthcare/Education/Finance's own Phase A; none of the 5
  // new models have a departmentId column.
  departmentTypes: [],
  // Role-Based Workspaces, Stage A — grouped, fully-gated navigation.
  //
  // One static tree per blueprint; the per-role sidebar is produced entirely
  // by `pruneNavItems` (permission-pruner.ts), which removes items a role
  // lacks the permission for and then removes any group left empty. Adding a
  // role — Student included — is therefore blueprint data plus grants, never
  // a frontend change.
  //
  // Previously 7-8 of these carried no `requiredPermission` at all, which is
  // why a Doctor, a Nurse and a Receptionist all opened the identical eleven
  // items. Everything here is now either genuinely universal (Dashboard,
  // Calendar, Leave, Chat, Meetings, Announcements) or gated on a real
  // permission.
  navigation: [
    {
      id: "nav.dashboard",
      label: "Dashboard",
      icon: "home",
      pageId: "page.dashboard",
    },
    {
      id: "nav.operations",
      label: "Operations",
      icon: "operations",
      children: [
        {
          id: "nav.inventory-items",
          label: "Inventory",
          icon: "inventory_2",
          pageId: "page.inventory-items",
          requiredPermission: "inventoryItem:read",
          moduleKey: "inventory-items",
        },
        {
          id: "nav.work-orders",
          label: "Work Orders",
          icon: "precision_manufacturing",
          pageId: "page.work-orders",
          requiredPermission: "workOrder:read",
          moduleKey: "work-orders",
        },
        {
          id: "nav.purchase-orders",
          label: "Purchase Orders",
          icon: "shopping_cart",
          pageId: "page.purchase-orders",
          requiredPermission: "purchaseOrder:read",
          moduleKey: "purchase-orders",
        },
        {
          id: "nav.suppliers",
          label: "Suppliers",
          icon: "local_shipping",
          pageId: "page.suppliers",
          requiredPermission: "supplier:read",
          moduleKey: "suppliers",
        },
      ],
    },
    {
      id: "nav.insights",
      label: "Insights",
      icon: "insights",
      children: [
        {
          id: "nav.analytics",
          label: "Analytics",
          icon: "analytics",
          pageId: "page.analytics",
          requiredPermission: "analytics:read",
        },
      ],
    },
    {
      id: "nav.collaborate",
      label: "Collaborate",
      icon: "collaborate",
      children: [
        {
          id: "nav.chat",
          label: "Chat",
          icon: "chat",
          pageId: "page.chat",
        },
        {
          id: "nav.meetings",
          label: "Meetings",
          icon: "meetings",
          pageId: "page.meetings",
        },
      ],
    },
    {
      id: "nav.personal",
      label: "My Work",
      icon: "personal",
      children: [
        {
          id: "nav.calendar",
          label: "Calendar",
          icon: "calendar",
          pageId: "page.calendar",
        },
        {
          id: "nav.attendance",
          label: "Attendance",
          icon: "attendance",
          pageId: "page.attendance",
          requiredPermission: "attendance:read",
        },
        {
          id: "nav.leave",
          label: "Leave",
          icon: "event_busy",
          pageId: "page.leave",
          moduleKey: "leave",
        },
      ],
    },
    {
      id: "nav.administration",
      label: "Administration",
      icon: "workspace-admin",
      children: [
        {
          id: "nav.crm",
          label: "CRM",
          icon: "handshake",
          pageId: "page.crm",
          requiredPermission: "contact:read",
          moduleKey: "crm",
        },
        {
          id: "nav.roles-permissions",
          label: "Roles & Permissions",
          icon: "roles-permissions",
          pageId: "page.roles-permissions",
          requiredPermission: "role:manage",
        },
        {
          id: "nav.settings",
          label: "Settings",
          icon: "settings",
          pageId: "page.settings",
          requiredPermission: "settings:manage",
        },
        {
          id: "nav.audit-logs",
          label: "Audit Logs",
          icon: "audit-logs",
          pageId: "page.audit-logs",
          requiredPermission: "audit:read",
        },
      ],
    },
  ],
  dashboards: { default: "page.dashboard" },
  modules: ["suppliers", "inventory-items", "purchase-orders", "work-orders", "leave", "crm"],
  pages: {
    "page.dashboard": {
      id: "page.dashboard",
      type: "Page",
      version: 1,
      // Deliberately minimal, same treatment as every prior domain's own
      // page.dashboard — no requiredPermission (must never be
      // permission-gated, see main()'s own sanity check below). Role-specific
      // widget curation belongs on page.analytics via
      // DEFAULT_DASHBOARD_WIDGET_KEYS in a later phase, not duplicated here.
      children: [{ id: "hdr", type: "Heading", version: 1, props: { text: "Good morning, {{user.displayName}}" } }],
    },
    "page.suppliers": {
      id: "page.suppliers",
      type: "Page",
      version: 1,
      requiredPermission: "supplier:read",
      children: [
        {
          id: "suppliers-workspace",
          type: "SuppliersWorkspace",
          version: 1,
          props: { title: "Suppliers" },
          bind: { source: "suppliers.list", params: {} },
          actions: [
            { kind: "mutation", mutation: "supplier.create", input: { ref: "form.newSupplier" }, requiredPermission: "supplier:create" },
            { kind: "mutation", mutation: "supplier.updateStatus", input: { ref: "row.id" }, requiredPermission: "supplier:update" },
          ],
        },
      ],
    },
    "page.inventory-items": {
      id: "page.inventory-items",
      type: "Page",
      version: 1,
      requiredPermission: "inventoryItem:read",
      children: [
        {
          id: "inventory-items-workspace",
          type: "InventoryItemsWorkspace",
          version: 1,
          props: { title: "Inventory" },
          bind: { source: "inventoryItems.list", params: {} },
          actions: [
            { kind: "mutation", mutation: "inventoryItem.create", input: { ref: "form.newInventoryItem" }, requiredPermission: "inventoryItem:create" },
            { kind: "mutation", mutation: "inventoryItem.update", input: { ref: "row.id" }, requiredPermission: "inventoryItem:update" },
          ],
        },
      ],
    },
    "page.purchase-orders": {
      id: "page.purchase-orders",
      type: "Page",
      version: 1,
      requiredPermission: "purchaseOrder:read",
      children: [
        {
          id: "purchase-orders-workspace",
          type: "PurchaseOrdersWorkspace",
          version: 1,
          props: { title: "Purchase Orders" },
          bind: { source: "purchaseOrders.list", params: {} },
          actions: [
            { kind: "mutation", mutation: "purchaseOrder.create", input: { ref: "form.newPurchaseOrder" }, requiredPermission: "purchaseOrder:create" },
            { kind: "mutation", mutation: "purchaseOrder.updateStatus", input: { ref: "row.id" }, requiredPermission: "purchaseOrder:update" },
          ],
        },
      ],
    },
    "page.work-orders": {
      id: "page.work-orders",
      type: "Page",
      version: 1,
      requiredPermission: "workOrder:read",
      children: [
        {
          id: "work-orders-workspace",
          type: "WorkOrdersWorkspace",
          version: 1,
          props: { title: "Work Orders" },
          bind: { source: "workOrders.list", params: {} },
          actions: [
            { kind: "mutation", mutation: "workOrder.create", input: { ref: "form.newWorkOrder" }, requiredPermission: "workOrder:create" },
            { kind: "mutation", mutation: "workOrder.updateStatus", input: { ref: "row.id" }, requiredPermission: "workOrder:update" },
          ],
        },
      ],
    },
    // Everything below reuses an existing blueprint page's own real content
    // verbatim (same composite type, same actions/mutations) — copied, not
    // referenced, since `pages` is a per-blueprint map; zero new frontend
    // code either way, only JSON. Detail-page mutations (purchaseOrder.receive,
    // workOrder.complete, bomLine.*, comment.create, document.*) are triggered
    // directly from the detail composites via useRenderContext().callMutation,
    // not declared here — exactly how ClientDetail/InvoiceDetail already call
    // their own detail mutations today without them appearing in
    // page.clients/page.invoices's own actions.
    "page.analytics": {
      id: "page.analytics",
      type: "Page",
      version: 1,
      // Mirrors this page's nav item exactly (ARCHITECTURE.md §6.9) — without
      // it the page stays directly fetchable by a role that cannot see the link.
      requiredPermission: "analytics:read",
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
      // Mirrors this page's nav item exactly (ARCHITECTURE.md §6.9) — without
      // it the page stays directly fetchable by a role that cannot see the link.
      requiredPermission: "settings:manage",
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
            // Stripe Billing — Admin-only (billing:manage), same gate the
            // whole "Billing & Plan" card presence-checks on.
            { kind: "mutation", mutation: "billing.createCheckoutSession", input: { ref: "form.checkout" }, requiredPermission: "billing:manage" },
            { kind: "mutation", mutation: "billing.createPortalSession", input: { ref: "form.portal" }, requiredPermission: "billing:manage" },
            // Feature Flags (module 3 of the 4-initiative backlog) — Admin-only.
            { kind: "mutation", mutation: "featureFlag.set", input: { ref: "form.featureFlag" }, requiredPermission: "featureFlag:manage" },
            // Enterprise SSO (initiative 2 of the 4-initiative backlog) — Admin-only.
            { kind: "mutation", mutation: "sso.configure", input: { ref: "form.sso" }, requiredPermission: "sso:manage" },
          ],
        },
      ],
    },
    "page.leave": {
      id: "page.leave",
      type: "Page",
      version: 1,
      children: [{ id: "leave-heading", type: "Heading", version: 1, props: { text: "Leave" } }],
    },
    // CRM — requiredPermission mirrors nav.crm's own gate (permission-
    // pruner.ts's page/nav sync — a permission-gated nav item's backing
    // page must carry the same gate, or a direct pageId fetch could reach
    // it without the grant).
    "page.crm": {
      id: "page.crm",
      type: "Page",
      version: 1,
      requiredPermission: "contact:read",
      children: [{ id: "crm-heading", type: "Heading", version: 1, props: { text: "CRM" } }],
    },
    // Audit Logs — trivial placeholder, same reasoning as page.leave/
    // page.crm above: DEDICATED_ROUTES intercepts navigation before
    // this tree ever actually renders.
    "page.audit-logs": {
      id: "page.audit-logs",
      type: "Page",
      version: 1,
      requiredPermission: "audit:read",
      children: [{ id: "audit-logs-heading", type: "Heading", version: 1, props: { text: "Audit Logs" } }],
    },
  },
};

// Shared by all blueprints — the default dashboard must never be
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


/**
 * Role-Based Workspaces, Stage B — re-sync each tenant's ROLE-level dashboard
 * defaults to the current blueprint, the same way roles themselves are
 * re-synced above.
 *
 * ⚠️ Only touches rows with a `roleId` — the role-wide template. Rows with a
 * `userId` are somebody's personally customised layout and are never
 * overwritten; that distinction is the whole reason both columns exist.
 *
 * Without this, a changed default would only ever reach brand-new tenants,
 * so every existing workspace would keep a dashboard built from the old
 * (and, before this stage, partly broken) widget list.
 */
async function resyncDashboardDefaults(
  prisma: PrismaClient,
  tenantId: string,
  industry: string,
  roleIds: Map<string, { id: string }>,
): Promise<number> {
  let synced = 0;
  for (const entry of DEFAULT_DASHBOARD_WIDGET_KEYS) {
    if (entry.industry && entry.industry !== industry) continue;
    const role = roleIds.get(entry.blueprintRoleId);
    if (!role) continue;
    const widgets = autoLayout(entry.keys);
    const existing = await prisma.dashboardLayout.findFirst({
      where: { tenantId, roleId: role.id, dashboardKey: "analytics" },
      select: { id: true },
    });
    if (existing) {
      await prisma.dashboardLayout.update({ where: { id: existing.id }, data: { widgets } });
    } else {
      await prisma.dashboardLayout.create({
        data: { tenantId, roleId: role.id, dashboardKey: "analytics", widgets },
      });
    }
    synced++;
  }
  return synced;
}

async function main() {
  // Validated against the same shared contract the Configuration Engine
  // compiles against — a malformed fixture fails here, at seed time, not
  // silently inside a compiled manifest later.
  BlueprintDefinitionSchema.parse(IT_BLUEPRINT_V1);
  BlueprintDefinitionSchema.parse(HEALTHCARE_BLUEPRINT_V1);
  BlueprintDefinitionSchema.parse(EDUCATION_BLUEPRINT_V1);
  BlueprintDefinitionSchema.parse(FINANCE_BLUEPRINT_V1);
  BlueprintDefinitionSchema.parse(MANUFACTURING_BLUEPRINT_V1);

  assertDefaultDashboardUngated(IT_BLUEPRINT_V1);
  assertDefaultDashboardUngated(HEALTHCARE_BLUEPRINT_V1);
  assertDefaultDashboardUngated(EDUCATION_BLUEPRINT_V1);
  assertDefaultDashboardUngated(FINANCE_BLUEPRINT_V1);
  assertDefaultDashboardUngated(MANUFACTURING_BLUEPRINT_V1);

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

  // Education Domain, Phase A — the platform's second non-IT blueprint,
  // same zero-collision coexistence as Healthcare above.
  await prisma.blueprint.upsert({
    where: { industry_version: { industry: "Education", version: 1 } },
    create: { industry: "Education", version: 1, definition: EDUCATION_BLUEPRINT_V1 },
    update: { definition: EDUCATION_BLUEPRINT_V1 },
  });
  console.log("Seeded blueprint: Education v1");

  // Finance Domain, Phase A — the platform's third non-IT blueprint, same
  // zero-collision coexistence as Healthcare/Education above.
  await prisma.blueprint.upsert({
    where: { industry_version: { industry: "Finance", version: 1 } },
    create: { industry: "Finance", version: 1, definition: FINANCE_BLUEPRINT_V1 },
    update: { definition: FINANCE_BLUEPRINT_V1 },
  });
  console.log("Seeded blueprint: Finance v1");

  // Manufacturing Domain, Phase A — the platform's fourth non-IT blueprint,
  // same zero-collision coexistence as Healthcare/Education/Finance above.
  await prisma.blueprint.upsert({
    where: { industry_version: { industry: "Manufacturing", version: 1 } },
    create: { industry: "Manufacturing", version: 1, definition: MANUFACTURING_BLUEPRINT_V1 },
    update: { definition: MANUFACTURING_BLUEPRINT_V1 },
  });
  console.log("Seeded blueprint: Manufacturing v1");

  // Stripe Billing — `Plan` is genuinely global (no tenantId), seeded once
  // here rather than per-blueprint. A flat union of every blueprint's own
  // core-domain moduleKeys works as Free's entitlement list because
  // filterByEntitlements only ever filters a nav item that literally
  // declares a matching moduleKey (entitlement-filter.ts) — an IT tenant's
  // Free-plan entitlements listing "patients" has no effect on it, since no
  // IT nav item has moduleKey: "patients". This is what lets one global Plan
  // catalog work across all 5 differently-shaped blueprints.
  const CORE_DOMAIN_MODULE_KEYS = [
    "projects", "tasks", // IT
    "patients", "appointments", // Healthcare
    "students", "courses", // Education
    "clients", "invoices", // Finance
    "suppliers", "inventory-items", "purchase-orders", "work-orders", // Manufacturing
  ];
  // Go-Live — the four-tier per-seat catalog. The entitlement ladder is
  // built only from module keys that are ACTUALLY gated: `leave` and `crm`
  // are the only two non-core modules carrying a `moduleKey` anywhere in any
  // blueprint (confirmed by grep, not assumed), so they are the only ones a
  // plan can genuinely unlock or withhold today. Everything else that
  // differentiates a tier is enforced by a real mechanism too — seat count
  // (`maxSeats`/`Tenant.seatsPurchased`, enforced in user.invite) and the AI
  // daily cap. Nothing in `highlights` below claims a gate that doesn't
  // exist; see docs/PRICING.md for the honest breakdown of what each tier
  // actually enforces versus what is a support commitment.
  const FREE_ENTITLEMENTS = CORE_DOMAIN_MODULE_KEYS;
  const STARTER_ENTITLEMENTS = [...CORE_DOMAIN_MODULE_KEYS, "leave"];
  const PRO_ENTITLEMENTS = [...CORE_DOMAIN_MODULE_KEYS, "leave", "crm"];

  // Yearly unit price is 10x monthly, not 12x — the "2 months free" discount
  // is expressed in the price itself rather than as a Stripe coupon, so one
  // number drives both the marketing copy and the actual charge.
  const YEARLY_MULTIPLIER = 10;

  /** Upserts a plan plus its monthly/yearly PlanPrice rows in one call.
   * `unitMonthlyCents: null` means the tier has no self-serve price at all
   * (Enterprise) and gets no PlanPrice rows. Stripe ids come from env and
   * stay null until a real Stripe account exists — the catalog is fully
   * functional without them (they are the charge authority, these rows are
   * the display authority). */
  async function upsertPlan(spec: {
    key: string;
    name: string;
    tagline: string;
    entitlements: string[];
    aiMessageDailyCap: number | null;
    seatModel: "per_seat" | "flat" | "contact";
    minSeats: number;
    maxSeats: number | null;
    trialDays: number;
    sortOrder: number;
    highlights: string[];
    unitMonthlyCents: number | null;
    stripeProductId?: string | null;
    stripeMonthlyPriceId?: string | null;
    stripeYearlyPriceId?: string | null;
  }) {
    const fields = {
      name: spec.name,
      tagline: spec.tagline,
      entitlements: spec.entitlements,
      aiMessageDailyCap: spec.aiMessageDailyCap,
      seatModel: spec.seatModel,
      minSeats: spec.minSeats,
      maxSeats: spec.maxSeats,
      trialDays: spec.trialDays,
      isPublic: true,
      sortOrder: spec.sortOrder,
      highlights: spec.highlights,
      stripeProductId: spec.stripeProductId || null,
    };
    const plan = await prisma.plan.upsert({
      where: { key: spec.key },
      create: { key: spec.key, ...fields },
      update: fields,
    });

    if (spec.unitMonthlyCents === null) {
      // Enterprise — make a rerun after a catalog change idempotent rather
      // than leaving a stale price behind if a tier ever loses self-serve.
      await prisma.planPrice.deleteMany({ where: { planId: plan.id } });
      return;
    }

    for (const [interval, cents, stripePriceId] of [
      ["month", spec.unitMonthlyCents, spec.stripeMonthlyPriceId],
      ["year", spec.unitMonthlyCents * YEARLY_MULTIPLIER, spec.stripeYearlyPriceId],
    ] as const) {
      await prisma.planPrice.upsert({
        where: { planId_interval_currency: { planId: plan.id, interval, currency: "usd" } },
        create: { planId: plan.id, interval, currency: "usd", unitAmountCents: cents, stripePriceId: stripePriceId || null },
        update: { unitAmountCents: cents, stripePriceId: stripePriceId || null },
      });
    }
  }

  await upsertPlan({
    key: "free",
    name: "Free",
    tagline: "For small teams getting started",
    entitlements: FREE_ENTITLEMENTS,
    aiMessageDailyCap: 50,
    seatModel: "flat",
    minSeats: 1,
    maxSeats: 3,
    trialDays: 0,
    sortOrder: 1,
    unitMonthlyCents: 0,
    highlights: [
      "Up to 3 users",
      "Core workspace modules for your industry",
      "Projects, tasks, calendar, documents and chat",
      "50 AI assistant messages per day",
      "Analytics dashboards",
    ],
  });

  await upsertPlan({
    key: "starter",
    name: "Starter",
    tagline: "For growing teams that need more room",
    entitlements: STARTER_ENTITLEMENTS,
    aiMessageDailyCap: 500,
    seatModel: "per_seat",
    minSeats: 3,
    maxSeats: null,
    trialDays: 14,
    sortOrder: 2,
    unitMonthlyCents: 1200,
    stripeProductId: process.env.STRIPE_PRODUCT_STARTER,
    stripeMonthlyPriceId: process.env.STRIPE_PRICE_STARTER_MONTHLY,
    stripeYearlyPriceId: process.env.STRIPE_PRICE_STARTER_YEARLY,
    highlights: [
      "Everything in Free",
      "Unlimited users",
      "Leave management and approvals",
      "500 AI assistant messages per day",
      "14-day free trial",
    ],
  });

  await upsertPlan({
    key: "professional",
    name: "Professional",
    tagline: "For organizations running their whole operation on Purnit",
    entitlements: PRO_ENTITLEMENTS,
    aiMessageDailyCap: 2000,
    seatModel: "per_seat",
    minSeats: 5,
    maxSeats: null,
    trialDays: 14,
    sortOrder: 3,
    unitMonthlyCents: 2900,
    stripeProductId: process.env.STRIPE_PRODUCT_PROFESSIONAL,
    stripeMonthlyPriceId: process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY,
    stripeYearlyPriceId: process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY,
    highlights: [
      "Everything in Starter",
      "CRM pipeline and contact management",
      "2,000 AI assistant messages per day",
      "Priority email support",
      "14-day free trial",
    ],
  });

  // Enterprise deliberately has no PlanPrice rows — "Contact us," not
  // self-serve checkout (see billing.data-sources.ts's own selfServe flag).
  // aiMessageDailyCap: null — unlimited.
  await upsertPlan({
    key: "enterprise",
    name: "Enterprise",
    tagline: "For organizations with compliance and scale requirements",
    entitlements: PRO_ENTITLEMENTS,
    aiMessageDailyCap: null,
    seatModel: "contact",
    minSeats: 1,
    maxSeats: null,
    trialDays: 0,
    sortOrder: 4,
    unitMonthlyCents: null,
    highlights: [
      "Everything in Professional",
      "Unlimited AI assistant usage",
      "Enterprise SSO / SAML via your own identity provider",
      "Dedicated support and onboarding",
      "Custom contract and invoicing",
    ],
  });

  // The old "pro" tier is superseded by "starter"/"professional". Any tenant
  // still pointing at it keeps working (its row stays, entitlements intact) —
  // it is simply withdrawn from the public catalog rather than deleted, since
  // deleting it would null out those tenants' planId and silently grant them
  // MORE access ("no plan = everything entitled", entitlement-filter.ts).
  const legacyPro = await prisma.plan.findUnique({ where: { key: "pro" } });
  if (legacyPro) {
    await prisma.plan.update({
      where: { key: "pro" },
      data: { isPublic: false, tagline: "Legacy plan — no longer offered", sortOrder: 99 },
    });
    console.log("Withdrew legacy plan 'pro' from the public catalog (existing tenants unaffected)");
  }

  console.log("Seeded plans: free, starter, professional, enterprise (+ prices)");

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
    await resyncDashboardDefaults(prisma, tenantId, IT_BLUEPRINT_V1.industry, roleIds);
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
    await resyncDashboardDefaults(prisma, tenantId, HEALTHCARE_BLUEPRINT_V1.industry, roleIds);
    syncedHealthcareTenants++;
  }
  console.log(`Re-synced roles + department-type labels for ${syncedHealthcareTenants} existing Healthcare tenant(s) to the current blueprint`);

  // Same re-sync, scoped to Education tenants.
  const educationTenantIds = (
    await prisma.tenant.findMany({ where: { industry: EDUCATION_BLUEPRINT_V1.industry }, select: { id: true } })
  ).map((t) => t.id);
  let syncedEducationTenants = 0;
  for (const tenantId of educationTenantIds) {
    const roleIds = await materializeBlueprintRoles(prisma, tenantId, EDUCATION_BLUEPRINT_V1.roles);
    await materializeDepartmentTypeLabels(prisma, tenantId, EDUCATION_BLUEPRINT_V1.departmentTypes, roleIds);
    await resyncDashboardDefaults(prisma, tenantId, EDUCATION_BLUEPRINT_V1.industry, roleIds);
    syncedEducationTenants++;
  }
  console.log(`Re-synced roles + department-type labels for ${syncedEducationTenants} existing Education tenant(s) to the current blueprint`);

  // Same re-sync, scoped to Finance tenants.
  const financeTenantIds = (
    await prisma.tenant.findMany({ where: { industry: FINANCE_BLUEPRINT_V1.industry }, select: { id: true } })
  ).map((t) => t.id);
  let syncedFinanceTenants = 0;
  for (const tenantId of financeTenantIds) {
    const roleIds = await materializeBlueprintRoles(prisma, tenantId, FINANCE_BLUEPRINT_V1.roles);
    await materializeDepartmentTypeLabels(prisma, tenantId, FINANCE_BLUEPRINT_V1.departmentTypes, roleIds);
    await resyncDashboardDefaults(prisma, tenantId, FINANCE_BLUEPRINT_V1.industry, roleIds);
    syncedFinanceTenants++;
  }
  console.log(`Re-synced roles + department-type labels for ${syncedFinanceTenants} existing Finance tenant(s) to the current blueprint`);

  // Same re-sync, scoped to Manufacturing tenants.
  const manufacturingTenantIds = (
    await prisma.tenant.findMany({ where: { industry: MANUFACTURING_BLUEPRINT_V1.industry }, select: { id: true } })
  ).map((t) => t.id);
  let syncedManufacturingTenants = 0;
  for (const tenantId of manufacturingTenantIds) {
    const roleIds = await materializeBlueprintRoles(prisma, tenantId, MANUFACTURING_BLUEPRINT_V1.roles);
    await materializeDepartmentTypeLabels(prisma, tenantId, MANUFACTURING_BLUEPRINT_V1.departmentTypes, roleIds);
    await resyncDashboardDefaults(prisma, tenantId, MANUFACTURING_BLUEPRINT_V1.industry, roleIds);
    syncedManufacturingTenants++;
  }
  console.log(`Re-synced roles + department-type labels for ${syncedManufacturingTenants} existing Manufacturing tenant(s) to the current blueprint`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
