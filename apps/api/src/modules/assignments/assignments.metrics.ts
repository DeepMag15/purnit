import type { ScalarMetricDefinition } from "../../metrics/metric-registry.service";
import { assignmentsWhere } from "./assignments.data-sources";

// A rolling 7-day deadline window, not a fixed day like
// appointments.todayCount — assignments aren't day-specific events, "due
// soon" is the meaningful signal for a teacher's dashboard.
const DUE_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const assignmentsDueSoonCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "assignments.dueSoonCount",
  module: "Assignments",
  label: "Assignments Due Soon",
  requiredPermission: "assignment:read",
  format: "count",
  async computeLive(ctx, tx) {
    const now = new Date();
    const in7Days = new Date(now.getTime() + DUE_SOON_WINDOW_MS);
    // assignmentsWhere already resolves the :own floor transitively through
    // teacherOwnedCourseIds — Teacher sees only their own courses' due
    // assignments, Admin/TA see every course's, matching assignmentsWhere's
    // own already-proven scope chain.
    const where = await assignmentsWhere(tx, ctx, { dueDate: { gte: now, lte: in7Days } });
    if (!where) return 0;
    return tx.assignment.count({ where });
  },
};
