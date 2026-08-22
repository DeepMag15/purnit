import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { meetingsWhere } from "./meetings.data-sources";

/** AI RAG Phase C — real prose (title + description). `Meeting.notes` is
 * deliberately out of scope for this phase (no such field exists today,
 * and adding one is a product feature beyond "wire up RAG using content
 * that already exists" — see the plan's own note). */
export const meetingRagHandler: RagSourceHandler = {
  sourceType: "meeting",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const meeting = await tx.meeting.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId } });
    if (!meeting) return null;
    const where = await meetingsWhere(tx, ctx, { id: sourceId });
    const inScope = await tx.meeting.findFirst({ where });
    return inScope ? meeting.title : null;
  },
  // AI Assistant Phase F — one batched query instead of N pairs of them.
  async checkVisibilityAndGetNames(tx, ctx, sourceIds) {
    const where = await meetingsWhere(tx, ctx, { id: { in: sourceIds } });
    const meetings = await tx.meeting.findMany({ where, select: { id: true, title: true } });
    return new Map(meetings.map((m) => [m.id, m.title]));
  },
  async extractText(tx, tenantId, sourceId) {
    const meeting = await tx.meeting.findFirst({ where: { id: sourceId, tenantId } });
    if (!meeting) return null;
    const text = `${meeting.title}\n${meeting.description ?? ""}`.trim();
    return text || null;
  },
};
