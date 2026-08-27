import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { leaveWhere } from "./leave.data-sources";

/** AI RAG Phase C — Leave is one of the industry-sensitive modules covered
 * by the "include industry-sensitive data uniformly" decision, and the
 * module whose own `leaveWhere` (this file) was a genuine new scope-check
 * extraction, not a pre-existing function. Synthesizes from LeaveType name
 * + date range + status + the optional free-text `reason` — matches the
 * plan's own `extractLeaveRequestText` example exactly. */
export const leaveRequestRagHandler: RagSourceHandler = {
  sourceType: "leaveRequest",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const request = await tx.leaveRequest.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId } });
    if (!request) return null;
    const where = await leaveWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.leaveRequest.findFirst({ where }) : null;
    return inScope ? "Leave request" : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const request = await tx.leaveRequest.findFirst({ where: { id: sourceId, tenantId } });
    if (!request) return null;
    const type = await tx.leaveType.findFirst({ where: { id: request.leaveTypeId, tenantId } });
    const start = request.startDate.toISOString().slice(0, 10);
    const end = request.endDate.toISOString().slice(0, 10);
    const base = `${type?.name ?? "Leave"}, ${start}–${end} (${request.status})`;
    return request.reason ? `${base}: ${request.reason}` : base;
  },
};
