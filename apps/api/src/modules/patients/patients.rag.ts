import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { patientsWhere } from "./patients.data-sources";

/** AI RAG Phase C — Patients is one of the industry-sensitive modules
 * explicitly named in the original "include industry-sensitive data
 * uniformly" decision. No free-text field beyond contact info, so this
 * synthesizes a composed blurb rather than embedding real prose. */
export const patientRagHandler: RagSourceHandler = {
  sourceType: "patient",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const patient = await tx.patient.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!patient) return null;
    const where = await patientsWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.patient.findFirst({ where }) : null;
    return inScope ? patient.name : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const patient = await tx.patient.findFirst({ where: { id: sourceId, tenantId, deletedAt: null } });
    if (!patient) return null;
    return `${patient.name} (${patient.status})`;
  },
};
