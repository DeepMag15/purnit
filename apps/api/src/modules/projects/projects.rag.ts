import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { projectsWhere } from "./projects.data-sources";

/** AI RAG Phase C — real prose (name + description), reusing `projectsWhere`
 * for both directions (visibility check here, scoping everywhere else). */
export const projectRagHandler: RagSourceHandler = {
  sourceType: "project",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const project = await tx.project.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!project) return null;
    const where = await projectsWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.project.findFirst({ where }) : null;
    return inScope ? project.name : null;
  },
  // AI Assistant Phase F — one batched query instead of N pairs of them.
  async checkVisibilityAndGetNames(tx, ctx, sourceIds) {
    const where = await projectsWhere(tx, ctx, { id: { in: sourceIds } });
    if (!where) return new Map();
    const projects = await tx.project.findMany({ where, select: { id: true, name: true } });
    return new Map(projects.map((p) => [p.id, p.name]));
  },
  async extractText(tx, tenantId, sourceId) {
    const project = await tx.project.findFirst({ where: { id: sourceId, tenantId, deletedAt: null } });
    if (!project) return null;
    const text = `${project.name}\n${project.description ?? ""}`.trim();
    return text || null;
  },
};
