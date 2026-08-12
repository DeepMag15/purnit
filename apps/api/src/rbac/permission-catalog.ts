/**
 * Hand-maintained catalog of every real, enforced "resource:action" pair in
 * this codebase, grouped by module — the single source of truth for the
 * Roles & Permissions UI's "group by module" picker. `resource`/`action` are
 * unvalidated free-form strings (packages/manifest-schema/src/permission.ts
 * — only `scope` is a closed enum), so there is no way to derive this list
 * by introspection; it must be kept in sync by hand.
 *
 * ⚠️ Standing maintenance obligation: any future module that introduces a
 * new `resource:action` triple with a real enforced consumer (a
 * `requiredPermission` on a mutation/data source, or a runtime
 * `ctx.effective.has(...)` check) must add an entry here in the same PR —
 * otherwise that permission is silently ungrantable through this UI (not a
 * crash, just invisible in the picker).
 *
 * Deliberately excluded, confirmed via grep of every `requiredPermission:`
 * site in every module's `.mutations.ts`/`.data-sources.ts`:
 * - `task:delete` — granted at every scope in seed.ts's role ladder but has
 *   zero consuming mutation anywhere (`tasks.mutations.ts` only checks
 *   `task:create`/`task:update`). A confirmed dead/anticipatory grant;
 *   including it here would let an Admin hand out a permission that does
 *   nothing, which would look like a bug in this module rather than a
 *   pre-existing one.
 * - Notifications, Comments, Chat, AI Assistant — zero RBAC resource
 *   anywhere (ownership/membership-scoped only). Nothing to render for
 *   these; noted so the omission doesn't look like an oversight.
 */

export interface PermissionCatalogEntry {
  resource: string;
  action: string;
  label: string;
}

export interface PermissionCatalogModule {
  module: string;
  entries: readonly PermissionCatalogEntry[];
}

export const PERMISSION_CATALOG: readonly PermissionCatalogModule[] = [
  {
    module: "Projects",
    entries: [
      { resource: "project", action: "create", label: "Create projects" },
      { resource: "project", action: "read", label: "View projects" },
      { resource: "project", action: "update", label: "Edit projects" },
      { resource: "project", action: "delete", label: "Delete projects" },
    ],
  },
  {
    module: "Tasks",
    entries: [
      { resource: "task", action: "create", label: "Create tasks" },
      { resource: "task", action: "read", label: "View tasks" },
      { resource: "task", action: "update", label: "Edit tasks" },
    ],
  },
  {
    module: "Meetings",
    entries: [
      { resource: "meeting", action: "create", label: "Create meetings" },
      { resource: "meeting", action: "read", label: "View meetings" },
    ],
  },
  {
    module: "Calendar",
    entries: [{ resource: "calendarEvent", action: "create", label: "Create calendar events" }],
  },
  {
    module: "Attendance",
    entries: [
      { resource: "attendance", action: "create", label: "Mark own attendance" },
      { resource: "attendance", action: "read", label: "View attendance records" },
      { resource: "attendance", action: "update", label: "Correct attendance records" },
    ],
  },
  {
    module: "Documents",
    entries: [
      { resource: "document", action: "create", label: "Create documents" },
      { resource: "document", action: "update", label: "Edit documents" },
      { resource: "document", action: "delete", label: "Delete documents" },
    ],
  },
  {
    module: "Announcements",
    entries: [{ resource: "announcement", action: "create", label: "Post announcements" }],
  },
  {
    module: "Organization",
    entries: [{ resource: "department", action: "manage", label: "Manage departments & teams" }],
  },
  {
    module: "People",
    entries: [
      { resource: "user", action: "invite", label: "Invite teammates" },
      { resource: "user", action: "manage", label: "Manage teammates & org placement" },
    ],
  },
  {
    module: "Workspace",
    entries: [{ resource: "settings", action: "manage", label: "Manage workspace settings" }],
  },
  {
    module: "Roles & Permissions",
    entries: [
      { resource: "role", action: "assign", label: "Assign roles to users" },
      { resource: "role", action: "manage", label: "Create & edit roles" },
    ],
  },
  {
    // Analytics Phase D — permission-controlled widgets. Each entry gates a
    // widget that deliberately does NOT reuse its owning module's own scope
    // builder (attendance:read/task:read) — the permission itself IS the
    // scope, always tenant-wide when granted, same presence-only shape as
    // settings:manage/role:manage. See the metric files' own doc comments.
    module: "Analytics",
    entries: [
      { resource: "analytics", action: "departmentPerformance", label: "View cross-department performance comparisons" },
      { resource: "analytics", action: "productivity", label: "View cross-employee productivity comparisons" },
      { resource: "analytics", action: "aiUsage", label: "View AI usage analytics" },
    ],
  },
  {
    // Healthcare Domain, Phase A — the platform's first non-IT industry
    // blueprint. Same shape/discipline as every module above; nothing here
    // is industry-filtered — this catalog is global, reused unchanged.
    module: "Patients",
    entries: [
      { resource: "patient", action: "create", label: "Register new patients" },
      { resource: "patient", action: "read", label: "View patient records" },
      { resource: "patient", action: "update", label: "Update patient profile/status" },
    ],
  },
  {
    module: "Appointments",
    entries: [
      { resource: "appointment", action: "create", label: "Book appointments" },
      { resource: "appointment", action: "read", label: "View appointments" },
      { resource: "appointment", action: "update", label: "Update/reschedule/cancel appointments" },
    ],
  },
  // Education Domain, Phase A — the platform's second non-IT industry
  // blueprint. Same shape/discipline as every module above.
  {
    module: "Students",
    entries: [
      { resource: "student", action: "create", label: "Register new students" },
      { resource: "student", action: "read", label: "View student records" },
      { resource: "student", action: "update", label: "Update student profile/status" },
    ],
  },
  {
    module: "Courses",
    entries: [
      { resource: "course", action: "create", label: "Create courses" },
      { resource: "course", action: "read", label: "View courses" },
      { resource: "course", action: "update", label: "Edit courses / reassign teacher" },
    ],
  },
  {
    module: "Enrollments",
    entries: [
      { resource: "enrollment", action: "create", label: "Enroll students in courses" },
      { resource: "enrollment", action: "read", label: "View enrollment records" },
      { resource: "enrollment", action: "update", label: "Update enrollment status/final grade" },
    ],
  },
  {
    module: "Assignments",
    entries: [
      { resource: "assignment", action: "create", label: "Create assignments" },
      { resource: "assignment", action: "read", label: "View assignments" },
      { resource: "assignment", action: "update", label: "Edit assignments" },
    ],
  },
  {
    module: "Grades",
    entries: [
      { resource: "grade", action: "create", label: "Enter grades" },
      { resource: "grade", action: "read", label: "View grades" },
      { resource: "grade", action: "update", label: "Correct grades" },
    ],
  },
  // Finance Domain, Phase A — the platform's third industry blueprint. Same
  // shape/discipline as every module above.
  {
    module: "Clients",
    entries: [
      { resource: "client", action: "create", label: "Register new clients" },
      { resource: "client", action: "read", label: "View client records" },
      { resource: "client", action: "update", label: "Update client profile/status/account manager" },
    ],
  },
  {
    module: "Invoices",
    entries: [
      { resource: "invoice", action: "create", label: "Create invoices" },
      { resource: "invoice", action: "read", label: "View invoices" },
      { resource: "invoice", action: "update", label: "Send/void invoices" },
    ],
  },
  {
    module: "Payments",
    entries: [
      { resource: "payment", action: "create", label: "Record payments" },
      { resource: "payment", action: "read", label: "View payment history" },
    ],
  },
  // Manufacturing Domain, Phase A — the platform's fourth industry blueprint.
  // Same shape/discipline as every module above. `receive`/`complete` are
  // custom non-CRUD actions, the same established pattern `role:assign`/
  // `user:invite`/`department:manage` already use — not a new mechanism.
  {
    module: "Suppliers",
    entries: [
      { resource: "supplier", action: "create", label: "Register new suppliers" },
      { resource: "supplier", action: "read", label: "View supplier records" },
      { resource: "supplier", action: "update", label: "Update supplier profile/status" },
    ],
  },
  {
    module: "Inventory",
    entries: [
      { resource: "inventoryItem", action: "create", label: "Add inventory items" },
      { resource: "inventoryItem", action: "read", label: "View inventory items" },
      { resource: "inventoryItem", action: "update", label: "Edit items & adjust stock" },
    ],
  },
  {
    module: "Bill of Materials",
    entries: [
      { resource: "bomLine", action: "create", label: "Add BOM component lines" },
      { resource: "bomLine", action: "read", label: "View bills of materials" },
      { resource: "bomLine", action: "update", label: "Edit BOM component quantities" },
      { resource: "bomLine", action: "delete", label: "Remove BOM component lines" },
    ],
  },
  {
    module: "Purchase Orders",
    entries: [
      { resource: "purchaseOrder", action: "create", label: "Create purchase orders" },
      { resource: "purchaseOrder", action: "read", label: "View purchase orders" },
      { resource: "purchaseOrder", action: "update", label: "Submit/cancel purchase orders" },
      { resource: "purchaseOrder", action: "receive", label: "Receive purchase orders (adjusts stock)" },
    ],
  },
  {
    module: "Work Orders",
    entries: [
      { resource: "workOrder", action: "create", label: "Create work orders" },
      { resource: "workOrder", action: "read", label: "View work orders" },
      { resource: "workOrder", action: "update", label: "Schedule/cancel work orders" },
      { resource: "workOrder", action: "complete", label: "Complete work orders (adjusts stock)" },
    ],
  },
];

const KNOWN_PERMISSIONS = new Set(PERMISSION_CATALOG.flatMap((m) => m.entries.map((e) => `${e.resource}:${e.action}`)));

export function isKnownPermission(resource: string, action: string): boolean {
  return KNOWN_PERMISSIONS.has(`${resource}:${action}`);
}
