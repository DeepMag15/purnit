import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { appointmentsWhere } from "./appointments.data-sources";

/** AI RAG Phase C — Appointment has a real free-text `notes` field, unlike
 * most other structured-data modules; embeds real prose when present. No
 * natural single "name" field — the status is used as the citation label. */
export const appointmentRagHandler: RagSourceHandler = {
  sourceType: "appointment",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const appointment = await tx.appointment.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId } });
    if (!appointment) return null;
    const where = await appointmentsWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.appointment.findFirst({ where }) : null;
    return inScope ? `Appointment (${appointment.status})` : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const appointment = await tx.appointment.findFirst({ where: { id: sourceId, tenantId } });
    if (!appointment) return null;
    return `Appointment, ${appointment.status}${appointment.notes ? `: ${appointment.notes}` : ""}`;
  },
};
