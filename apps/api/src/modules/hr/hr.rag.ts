import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { hrDepartmentWhere, hrTeamWhere } from "./hr.data-sources";

/** AI RAG Phase C — HR's own RAG content is Department/Team rows, not
 * `User` rows (confirmed directly — this module has no roster/User query
 * anywhere). No free-text field on either; synthesizes from name/type. */
export const departmentRagHandler: RagSourceHandler = {
  sourceType: "department",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const department = await tx.department.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, archivedAt: null } });
    if (!department) return null;
    const where = await hrDepartmentWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.department.findFirst({ where }) : null;
    return inScope ? department.name : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const department = await tx.department.findFirst({ where: { id: sourceId, tenantId, archivedAt: null } });
    if (!department) return null;
    return department.type ? `${department.name} (${department.type})` : department.name;
  },
};

export const teamRagHandler: RagSourceHandler = {
  sourceType: "team",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const team = await tx.team.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, archivedAt: null } });
    if (!team) return null;
    const where = await hrTeamWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.team.findFirst({ where }) : null;
    return inScope ? team.name : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const team = await tx.team.findFirst({ where: { id: sourceId, tenantId, archivedAt: null }, include: { department: true } });
    if (!team) return null;
    return `${team.name} (${team.department.name})`;
  },
};
