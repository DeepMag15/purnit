import type { BreakdownMetricDefinition } from "../../metrics/metric-registry.service";
import { projectsWhere } from "../projects/projects.data-sources";

/** Phase F (Cross-Module Composites + Executive Attention) — Documents'
 * first-ever MetricRegistry entry. No document:read permission exists
 * (ORG_HIERARCHY.md §12 — visibility is entirely derived from the parent
 * project); requiredPermission is set to project:read anyway, matching this
 * codebase's own established precedent (projects.activeCount etc. all
 * declare requiredPermission even though their *Where() builder does its own
 * scoping too) — an empty-but-present widget for a zero-project:read caller
 * is worse UX than the widget simply not rendering at all. */
export const documentsPendingApprovalsMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "documents.pendingApprovals",
  module: "Documents",
  label: "Pending Approvals",
  requiredPermission: "project:read",
  nameKey: "document",
  valueKey: "daysPending",
  async computeLive(ctx, tx) {
    const where = await projectsWhere(tx, ctx, {});
    if (!where) return [];
    const projects = await tx.project.findMany({ where, select: { id: true } });
    if (projects.length === 0) return [];
    const projectIds = projects.map((p) => p.id);

    const docs = await tx.document.findMany({
      where: { tenantId: ctx.tenantId, projectId: { in: projectIds }, approvalStatus: "pending", deletedAt: null },
      select: { id: true, name: true, updatedAt: true, project: { select: { name: true } } },
      orderBy: { updatedAt: "asc" },
      take: 10,
    });

    return docs.map((d) => ({
      document: `${d.name} (${d.project.name})`,
      daysPending: Math.floor((Date.now() - d.updatedAt.getTime()) / 86_400_000),
    }));
  },
};
