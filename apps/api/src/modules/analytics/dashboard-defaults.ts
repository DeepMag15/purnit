import type { WidgetLayoutEntry } from "./dashboard-layout.types";

// Role-Based Workspaces, Stage B — the widget layout each role's dashboard
// opens with.
//
// Ordering is the whole point: the first four widgets should answer the
// question that role actually starts their day with. A Receptionist opens on
// today's appointments; an HR Manager on attendance and productivity; a
// Procurement Officer on open purchase-order value. Everything else the role
// is permitted to see is auto-appended below by AnalyticsDashboard.tsx's own
// mergeLayout, so this list is a priority order, never a whitelist.
//
// Two rules hold for every entry, both enforced by dashboard-defaults.spec.ts:
//   1. Every key must be a REAL registered metric. A typo silently renders
//      nothing — which is exactly what had happened: `employeeProductivityScore`
//      was a phantom key sitting in 3 roles' top slots.
//   2. Every key must be one that role can actually SEE. Listing a widget
//      gated behind a permission the role lacks leaves a hole in the layout;
//      Executive and HR Manager each had 3 of their top 4 widgets in this
//      state before Stage B.
//
// `industry` scopes an entry to one blueprint. It exists because
// `role.admin` is shared across all five domains, and a Hospital
// Administrator opening on "At-Risk Projects" is precisely the generic
// experience this work exists to remove. An entry without `industry` applies
// to whichever blueprint defines that role.
export const DEFAULT_DASHBOARD_WIDGET_KEYS: { blueprintRoleId: string; industry?: string; keys: string[] }[] = [
  // ---------------------------------------------------------------- IT ----
  // Individual contributors: their own work, nothing organizational.
  { blueprintRoleId: "role.intern", keys: ["tasks.openCount", "tasks.overdueCount", "meetings.timeline", "attendance.rateThisMonth"] },
  {
    blueprintRoleId: "role.member",
    keys: ["tasks.openCount", "tasks.overdueCount", "projects.activeCount", "meetings.timeline", "attendance.rateThisMonth"],
  },
  // Senior Practitioner shares Practitioner's navigation (they differ only in
  // scope), so the dashboard is where the difference shows: review-shaped
  // widgets — what is queued, what is waiting on them.
  {
    blueprintRoleId: "role.senior-employee",
    keys: [
      "tasks.openCount",
      "tasks.overdueCount",
      "tasks.byPriority",
      "documents.pendingApprovals",
      "projects.activeCount",
      "meetings.timeline",
    ],
  },
  // Lead: the team's throughput, not their own task list.
  {
    blueprintRoleId: "role.team-lead",
    keys: [
      "tasks.assigneeWorkload",
      "tasks.openCount",
      "tasks.completionRate",
      "projects.atRisk",
      "tasks.statusFunnel",
      "meetings.heldThisWeek",
    ],
  },
  // Manager: delivery risk and who is overloaded.
  {
    blueprintRoleId: "role.project-manager",
    keys: [
      "projects.atRisk",
      "tasks.overloadedEmployees",
      "tasks.assigneeWorkload",
      "projects.activeCount",
      "tasks.completionRate",
      "documents.pendingApprovals",
    ],
  },
  // Department Head: their own department's health.
  {
    blueprintRoleId: "role.department-head",
    keys: [
      "attendance.rateByDepartment",
      "tasks.completionRate",
      "projects.atRisk",
      "tasks.overloadedEmployees",
      "attendance.statusByDepartment",
      "projects.activeCount",
    ],
  },
  // Executive: departments compared against each other — the one widget
  // Department Head cannot see, and the reason these two are distinct.
  {
    blueprintRoleId: "role.executive",
    keys: [
      "department.performanceLeaderboard",
      "projects.atRisk",
      "attendance.rateByDepartment",
      "tasks.completionRate",
      "projects.activeCount",
      "tasks.overloadedEmployees",
    ],
  },
  // HR Manager: people, not projects. Same navigation as the two above, a
  // completely different dashboard.
  {
    blueprintRoleId: "role.hr-manager",
    keys: [
      "attendance.rateThisMonth",
      "tasks.productivityLeaderboard",
      "attendance.statusByDepartment",
      "attendance.rateByDepartment",
      "tasks.overloadedEmployees",
      "meetings.heldThisWeek",
    ],
  },
  {
    blueprintRoleId: "role.admin",
    industry: "IT",
    keys: [
      "projects.atRisk",
      "tasks.overloadedEmployees",
      "department.performanceLeaderboard",
      "documents.pendingApprovals",
      "tasks.productivityLeaderboard",
      "attendance.rateThisMonth",
      "projects.activeCount",
      "tasks.completionRate",
      "ai.usageSummary",
    ],
  },

  // -------------------------------------------------------- Healthcare ----
  {
    blueprintRoleId: "role.doctor",
    keys: ["appointments.todayCount", "tasks.openCount", "patients.totalCount", "tasks.overdueCount", "patients.statusBreakdown", "documents.pendingApprovals"],
  },
  {
    blueprintRoleId: "role.nurse",
    keys: ["appointments.todayCount", "tasks.openCount", "patients.statusBreakdown", "patients.totalCount", "tasks.overdueCount", "attendance.rateThisMonth"],
  },
  // Receptionist: the front desk's day. No clinical or task widgets — they
  // hold neither permission, and listing them would leave holes.
  {
    blueprintRoleId: "role.receptionist",
    keys: ["appointments.todayCount", "appointments.completedCount", "patients.totalCount", "doctors.activeCount", "meetings.timeline"],
  },
  {
    blueprintRoleId: "role.admin",
    industry: "Healthcare",
    keys: [
      "patients.totalCount",
      "appointments.todayCount",
      "doctors.activeCount",
      "patients.statusBreakdown",
      "appointments.completedCount",
      "attendance.rateThisMonth",
      "tasks.overloadedEmployees",
    ],
  },

  // --------------------------------------------------------- Education ----
  {
    blueprintRoleId: "role.teacher",
    keys: ["assignments.dueSoonCount", "grades.averagePercent", "courses.activeCount", "tasks.openCount", "grades.recordedCount", "students.totalCount"],
  },
  {
    blueprintRoleId: "role.teaching-assistant",
    keys: ["assignments.dueSoonCount", "tasks.openCount", "courses.activeCount", "students.totalCount", "grades.recordedCount"],
  },
  // Registrar: enrolment lifecycle. Structurally excluded from the gradebook,
  // so no grade or assignment widget appears.
  {
    blueprintRoleId: "role.registrar",
    keys: ["students.totalCount", "enrollments.activeCount", "students.statusBreakdown", "courses.activeCount", "attendance.rateThisMonth"],
  },
  {
    blueprintRoleId: "role.admin",
    industry: "Education",
    keys: [
      "students.totalCount",
      "enrollments.activeCount",
      "courses.activeCount",
      "teachers.activeCount",
      "grades.averagePercent",
      "assignments.dueSoonCount",
      "attendance.rateThisMonth",
    ],
  },

  // ----------------------------------------------------------- Finance ----
  {
    // No payment widget: a Billing Clerk manages invoices but holds no
    // `payment:read`, so `payments.collectedThisMonth` would render nothing.
    // Caught by dashboard-defaults.spec.ts rather than by review.
    blueprintRoleId: "role.billing-clerk",
    keys: ["invoices.overdueCount", "invoices.totalOutstanding", "clients.totalCount"],
  },
  {
    blueprintRoleId: "role.accountant",
    keys: ["invoices.totalOutstanding", "invoices.overdueCount", "payments.collectedThisMonth", "clients.totalCount", "clients.statusBreakdown"],
  },
  // Account Manager: their own book of clients first, then the money.
  {
    blueprintRoleId: "role.sales-rep",
    keys: ["clients.totalCount", "invoices.totalOutstanding", "invoices.overdueCount", "clients.statusBreakdown"],
  },
  {
    blueprintRoleId: "role.admin",
    industry: "Finance",
    keys: [
      "invoices.totalOutstanding",
      "payments.collectedThisMonth",
      "invoices.overdueCount",
      "clients.totalCount",
      "clients.statusBreakdown",
      "attendance.rateThisMonth",
    ],
  },

  // ----------------------------------------------------- Manufacturing ----
  {
    blueprintRoleId: "role.warehouse-staff",
    keys: ["inventoryItems.lowStockCount", "inventoryItems.totalValue", "workOrders.inProgressCount", "inventoryItems.typeBreakdown"],
  },
  {
    blueprintRoleId: "role.procurement-officer",
    keys: ["purchaseOrders.totalOpenValue", "purchaseOrders.openCount", "inventoryItems.lowStockCount", "suppliers.totalCount"],
  },
  {
    blueprintRoleId: "role.production-planner",
    keys: ["workOrders.inProgressCount", "inventoryItems.lowStockCount", "inventoryItems.typeBreakdown", "inventoryItems.totalValue"],
  },
  {
    blueprintRoleId: "role.admin",
    industry: "Manufacturing",
    keys: [
      "workOrders.inProgressCount",
      "inventoryItems.lowStockCount",
      "purchaseOrders.totalOpenValue",
      "inventoryItems.totalValue",
      "suppliers.totalCount",
      "attendance.rateThisMonth",
    ],
  },
];

/** A simple flowing 12-column grid — 2 widgets per row, `w: 6, h: 4` each.
 * The same small algorithm AnalyticsDashboard.tsx independently implements
 * for its own "no saved layout" client-side fallback — not extracted into a
 * shared package for one small function, deliberately duplicated cheaply on
 * both sides of the runtime boundary.
 *
 * Reference-fidelity pass — only the first `DEFAULT_VISIBLE_WIDGET_COUNT`
 * keys in each role's own already-priority-ordered list (see this file's
 * own doc comment above `DEFAULT_DASHBOARD_WIDGET_KEYS`: "headline metrics
 * first") start visible; the rest are seeded present-but-hidden. Nothing is
 * dropped and no permission changes — every widget still exists in the
 * saved layout and reappears the moment a user ticks it back on in
 * AnalyticsDashboard.tsx's existing "Manage Widgets" panel (Analytics Phase
 * E), unchanged. This only lowers the number of charts a role sees before
 * asking for more, matching reference_design.png's own uncluttered-by-
 * default board. */
export const DEFAULT_VISIBLE_WIDGET_COUNT = 5;
export function autoLayout(keys: string[]): WidgetLayoutEntry[] {
  return keys.map((key, i) => ({ key, visible: i < DEFAULT_VISIBLE_WIDGET_COUNT, x: (i % 2) * 6, y: Math.floor(i / 2) * 4, w: 6, h: 4 }));
}
