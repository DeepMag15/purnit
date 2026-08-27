import type { ReportAnchor } from "./report-lens-registry.service";

/**
 * Contextual Reporting — what a report means in each domain, to each role.
 *
 * All five domains in one file rather than scattered across modules, because
 * the value here is being able to read them side by side: the whole point is
 * that a Teacher, a Registrar and a Student get *different* answers from the
 * same file, and that is only reviewable if the lenses sit next to each other.
 *
 * Two rules hold throughout:
 *
 *   1. **Lenses are ordered most-specific first.** The first one whose
 *      permission the caller holds wins. `grade:read` before `enrollment:read`
 *      means a Teacher gets the gradebook lens even though they also hold
 *      enrolment-shaped grants.
 *   2. **Every lens permission is one the role already has.** No lens invents
 *      a grant. That is what makes this configuration rather than code: the
 *      Student role, added yesterday, gets its lens purely because it holds
 *      `studentPortal:read`.
 */

// ---------------------------------------------------------------------------
// IT — plain Projects
// ---------------------------------------------------------------------------
export const projectAnchor: ReportAnchor = {
  type: "project",
  async resolveContext(tx, tenantId, projectId) {
    const project = await tx.project.findFirst({
      where: { id: projectId, tenantId, deletedAt: null },
      select: { name: true, status: true },
    });
    if (!project) return null;
    // Sequential, not Promise.all — shared-tx rule (CONTEXT.md §9).
    const openTasks = await tx.task.count({ where: { tenantId, projectId, deletedAt: null, status: { not: "done" } } });
    return { name: project.name, detail: `a ${project.status} project with ${openTasks} open task(s)` };
  },
  lenses: [
    {
      key: "project.portfolioRisk",
      label: "Portfolio & delivery risk",
      // Only tiers that actually own a portfolio: Department Head, Executive,
      // Company Admin. `project:delete` is the cleanest proxy — it is the
      // grant that lags a tier behind create/update in this ladder.
      requiredPermission: "project:delete",
      focus:
        "delivery risk across the portfolio: slipping milestones, blocked or unstaffed work, dependencies at risk, and where resourcing is thin. Lead with what threatens a delivery date.",
    },
    {
      key: "project.teamDelivery",
      label: "Team delivery & workload",
      // Lead and Manager: they create documents and run a team.
      requiredPermission: "document:create",
      focus:
        "how the team is tracking: workload distribution, who is overloaded, overdue or stalled items, and incidents or blockers that need a decision this week.",
    },
    {
      key: "project.myWork",
      label: "What this means for my work",
      // Practitioner / Senior Practitioner — can read the project, cannot
      // upload. They get an individual-contributor reading, not a manager's.
      requiredPermission: "project:read",
      focus:
        "what this means for the reader's own work: which items involve them, what is newly blocked or reprioritised, and what they should pick up next. Do not comment on other people's performance.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Healthcare — Patient.chartProjectId
// ---------------------------------------------------------------------------
export const patientAnchor: ReportAnchor = {
  type: "patient",
  async resolveContext(tx, tenantId, projectId) {
    const patient = await tx.patient.findFirst({
      where: { chartProjectId: projectId, tenantId, deletedAt: null },
      select: { name: true, status: true },
    });
    if (!patient) return null;
    return { name: patient.name, detail: `a ${patient.status} patient record` };
  },
  // ⚠️ The discriminators here were chosen by checking the actual grant lists,
  // not by assuming. `patient:update` looks like "the doctor's permission" and
  // is not — Nurse holds `patient:update:own` too, so ordering the clinical
  // lens on it would have handed a Nurse the doctor's reading. `document:update`
  // is what actually separates the roles that originate clinical records
  // (Doctor, Hospital Administrator) from those that don't.
  lenses: [
    {
      key: "patient.clinical",
      label: "Clinical review",
      requiredPermission: "document:update",
      focus:
        "clinical findings in this report: results outside normal ranges, changes since previous results, medication or dosage concerns, and what needs following up at the next appointment. Flag anything urgent first. Do not diagnose — surface what the report says and what warrants review.",
    },
    {
      key: "patient.careDelivery",
      label: "Care delivery notes",
      // Nurse — patient:update:own, but no authority to originate records.
      requiredPermission: "patient:update",
      focus:
        "what this means for day-to-day care: observations to monitor, scheduling or preparation implications, and anything the care team should be aware of on the next shift. Practical care notes, not clinical decisions.",
    },
    {
      key: "patient.frontDesk",
      label: "Scheduling & admin",
      // Receptionist — appointment:update:tenant, deliberately no
      // patient:update. They get the administrative reading of a chart
      // document, never the clinical one.
      requiredPermission: "appointment:update",
      focus:
        "the administrative side only: appointments to book, reschedule or follow up, missing paperwork or registration details, and anything affecting the schedule. Do NOT interpret clinical results, values or medications — that is not this reader's role.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Education — Course.materialsProjectId, Student.filesProjectId,
//             Enrollment.submissionsProjectId
// ---------------------------------------------------------------------------
export const courseAnchor: ReportAnchor = {
  type: "course",
  async resolveContext(tx, tenantId, projectId) {
    const course = await tx.course.findFirst({
      where: { materialsProjectId: projectId, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!course) return null;
    const enrolled = await tx.enrollment.count({ where: { tenantId, courseId: course.id, status: "enrolled" } });
    return { name: course.name, detail: `a course with ${enrolled} enrolled student(s)` };
  },
  lenses: [
    {
      key: "course.classPerformance",
      label: "Class performance",
      // ⚠️ `grade:create`, not `grade:read`. Teaching Assistant holds
      // `grade:read:tenant`, so ordering on read would have given a TA the
      // teacher's reading. Marking authority is what separates them.
      requiredPermission: "grade:create",
      focus:
        "how this class is doing: where students are struggling or excelling, topics the cohort has clearly not absorbed, attendance patterns affecting results, and which students need attention. Name specifics from the report, not general teaching advice.",
    },
    {
      key: "course.classOverview",
      label: "Class overview",
      // Teaching Assistant — sees the whole gradebook, marks nothing.
      requiredPermission: "grade:read",
      focus:
        "an overview of where the class stands: overall patterns, topics that look weak across the cohort, and where support sessions would help most. Keep it at cohort level — individual student judgements are the teacher's call, not this reader's.",
    },
    {
      key: "course.enrolmentCompliance",
      label: "Enrolment & attendance compliance",
      // Registrar — enrolment lifecycle, structurally excluded from grades.
      requiredPermission: "enrollment:read",
      focus:
        "the enrolment and attendance record: incomplete or irregular enrolments, attendance below expected thresholds, and anything that affects reporting obligations or a student's standing. Do not comment on academic performance or grades.",
    },
    // ⚠️ No student lens here, and that is a finding rather than an omission.
    // A course's materials Project is owned by the Admin who ran
    // `course.create`, and a Student holds only `project:read:own`, so
    // `assertProjectVisible` refuses them a course-materials document outright
    // — a student lens on this anchor would never once resolve. Students read
    // materials through `myCourseMaterials.list` (bounded by enrolment) and
    // analyse their own work through the `submission` anchor below, which they
    // genuinely own. Verified live: a Student gets 403 on a course-materials
    // document, exactly as this predicts.
  ],
};

export const studentFileAnchor: ReportAnchor = {
  type: "studentFile",
  async resolveContext(tx, tenantId, projectId) {
    const student = await tx.student.findFirst({
      where: { filesProjectId: projectId, tenantId, deletedAt: null },
      select: { name: true, status: true },
    });
    if (!student) return null;
    return { name: student.name, detail: `a ${student.status} student's record` };
  },
  lenses: [
    {
      key: "studentFile.registrar",
      label: "Student record review",
      requiredPermission: "student:update",
      focus:
        "this student's academic record: enrolment history and status, completeness of required paperwork, anything affecting their standing or progression, and any discrepancy that needs correcting.",
    },
  ],
};

export const submissionAnchor: ReportAnchor = {
  type: "submission",
  async resolveContext(tx, tenantId, projectId) {
    const enrolment = await tx.enrollment.findFirst({
      where: { submissionsProjectId: projectId, tenantId },
      select: { studentId: true, courseId: true },
    });
    if (!enrolment) return null;
    const student = await tx.student.findFirst({ where: { id: enrolment.studentId, tenantId }, select: { name: true } });
    const course = await tx.course.findFirst({ where: { id: enrolment.courseId, tenantId }, select: { name: true } });
    return {
      name: `${student?.name ?? "A student"} — ${course?.name ?? "course"}`,
      detail: "a student's own submitted work for one course",
    };
  },
  lenses: [
    {
      key: "submission.teacherReview",
      label: "Marking notes",
      // Teacher first: on a submission, the person who grades it gets the
      // marking view even though the student can also open the same file.
      requiredPermission: "grade:create",
      focus:
        "this submission as work to be marked: whether it addresses what was set, its strengths, specific weaknesses with evidence, and what feedback would most help this student improve. Do not assign a grade — that is the teacher's call.",
    },
    {
      key: "submission.selfCheck",
      label: "Check my work",
      requiredPermission: "studentPortal:read",
      focus:
        "a constructive check of the reader's OWN submitted work before it is marked: whether it appears to answer what was asked, what is unclear or missing, and what to improve. Encouraging and specific. Never predict a grade.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Finance — Client.filesProjectId
// ---------------------------------------------------------------------------
export const clientAnchor: ReportAnchor = {
  type: "client",
  async resolveContext(tx, tenantId, projectId) {
    const client = await tx.client.findFirst({
      where: { filesProjectId: projectId, tenantId, deletedAt: null },
      select: { id: true, name: true, status: true },
    });
    if (!client) return null;
    const outstanding = await tx.invoice.count({
      where: { tenantId, clientId: client.id, deletedAt: null, status: { notIn: ["paid", "void"] } },
    });
    return { name: client.name, detail: `a ${client.status} client with ${outstanding} unpaid invoice(s)` };
  },
  lenses: [
    {
      key: "client.financialPosition",
      label: "Financial position & anomalies",
      // Finance Director / Accountant — the roles holding payment authority.
      requiredPermission: "payment:create",
      focus:
        "the financial picture: revenue and expense movement, margin changes, anomalies or entries that look out of pattern, cash-flow timing risk, and anything that would matter at month end. Quote the figures you are drawing on.",
    },
    {
      key: "client.receivables",
      label: "Billing & receivables",
      // Billing Clerk — invoices, not the ledger.
      requiredPermission: "invoice:update",
      focus:
        "billing and collections: outstanding and overdue amounts, invoices that look wrong or duplicated, payment patterns for this client, and which items need chasing first. Stay on billing — no commentary on overall company finances.",
    },
    {
      key: "client.relationship",
      label: "Account health",
      // Account Manager — owns the relationship, not the ledger.
      requiredPermission: "client:update",
      focus:
        "the health of this account: signals about satisfaction or risk of churn, changes in activity or spend, commitments made, and what the account manager should raise at the next conversation.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Manufacturing — InventoryItem.filesProjectId
// ---------------------------------------------------------------------------
export const inventoryItemAnchor: ReportAnchor = {
  type: "inventoryItem",
  async resolveContext(tx, tenantId, projectId) {
    const item = await tx.inventoryItem.findFirst({
      where: { filesProjectId: projectId, tenantId, deletedAt: null },
      select: { name: true, currentStock: true, reorderPoint: true },
    });
    if (!item) return null;
    return {
      name: item.name,
      detail: `an inventory item at ${item.currentStock} in stock (reorder point ${item.reorderPoint})`,
    };
  },
  lenses: [
    {
      key: "inventory.plantPerformance",
      label: "Plant performance",
      // Plant Manager — the only Manufacturing role holding workOrder:complete.
      requiredPermission: "workOrder:complete",
      focus:
        "production performance: output against plan, downtime and its causes, capacity constraints, quality issues, and where throughput is being lost. Lead with whatever is costing the most output.",
    },
    {
      key: "inventory.supplyChain",
      label: "Supplier & procurement",
      requiredPermission: "purchaseOrder:receive",
      focus:
        "supply reliability: supplier lead times and delivery performance, late or short deliveries, price movement, and material availability risk against upcoming demand.",
    },
    {
      key: "inventory.production",
      label: "Production planning",
      requiredPermission: "workOrder:create",
      focus:
        "planning implications: material usage against forecast, stock that will not cover scheduled work orders, and scheduling changes this report justifies.",
    },
    {
      key: "inventory.stockHandling",
      label: "Stock & handling",
      // Warehouse Staff — stock movement, not planning or supplier strategy.
      requiredPermission: "inventoryItem:update",
      focus:
        "stock handling: discrepancies between recorded and actual quantities, items near or below reorder level, damage or wastage, and what needs counting or moving. Practical warehouse actions only.",
    },
  ],
};

/**
 * ⚠️ Order matters, and `projectAnchor` MUST stay last.
 *
 * Every domain entity is backed by a real `Project` row, so `projectAnchor`
 * matches literally every document in the system — a patient chart, a course's
 * materials and a client's files are all Projects. Probed first it would claim
 * all of them and hand a Doctor the IT "portfolio risk" lens on a patient
 * chart. Last, it is what it should be: the fallback for a plain project that
 * no domain entity claims.
 *
 * `resolve()` deliberately stops rather than falling through once an anchor
 * claims a project but the caller matches none of its lenses — otherwise a
 * Receptionist with no patient lens would drop through to the IT lens on a
 * patient chart, which is exactly the leak this ordering exists to prevent.
 */
export const DOMAIN_ANCHORS: ReportAnchor[] = [
  patientAnchor,
  courseAnchor,
  studentFileAnchor,
  submissionAnchor,
  clientAnchor,
  inventoryItemAnchor,
  projectAnchor,
];
