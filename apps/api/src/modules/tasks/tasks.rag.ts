import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { tasksWhere } from "./tasks.data-sources";

/** AI RAG Phase C — real prose (title + description). `tasksWhere` takes
 * specific typed filter params (status/assigneeId/overdue/...), not a
 * generic `extra` bag like most other `xWhere` functions — so the `id`
 * filter is merged onto its returned scope condition here instead of being
 * passed in, same effect either way. */
export const taskRagHandler: RagSourceHandler = {
  sourceType: "task",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const task = await tx.task.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!task) return null;
    const scopeWhere = await tasksWhere(tx, ctx, {});
    if (!scopeWhere) return null;
    const inScope = await tx.task.findFirst({ where: { ...scopeWhere, id: sourceId } });
    return inScope ? task.title : null;
  },
  // AI Assistant Phase F — collapses N candidates' worth of the two
  // sequential queries above into one: the RBAC-scoped `tasksWhere` query
  // alone proves both existence-in-scope and sources the display name, no
  // separate unscoped existence fetch needed the way the single-id version
  // above does (that one needs a distinct "exists at all" vs. "in scope"
  // split only because it returns null either way and callers don't
  // distinguish the reason — a batch caller only ever wants the visible
  // subset, so one query suffices).
  async checkVisibilityAndGetNames(tx, ctx, sourceIds) {
    const scopeWhere = await tasksWhere(tx, ctx, {});
    if (!scopeWhere) return new Map();
    const tasks = await tx.task.findMany({ where: { ...scopeWhere, id: { in: sourceIds } }, select: { id: true, title: true } });
    return new Map(tasks.map((t) => [t.id, t.title]));
  },
  async extractText(tx, tenantId, sourceId) {
    const task = await tx.task.findFirst({ where: { id: sourceId, tenantId, deletedAt: null } });
    if (!task) return null;
    const text = `${task.title}\n${task.description ?? ""}`.trim();
    return text || null;
  },
};
