import { Injectable } from "@nestjs/common";
import type { DataSourceContext } from "../data-sources/data-source-registry.service";
import type { PrismaTx } from "../tenancy/tenant-prisma.service";

/**
 * Contextual Reporting — how a report gets read differently depending on who
 * is reading it and what it is attached to.
 *
 * Same registrar pattern as `MetricRegistry` and `RagSourceRegistry`: each
 * domain module registers its own anchors and lenses at boot, and this file
 * knows nothing about courses, patients, invoices or work orders. Adding a
 * domain, or a new lens for an existing one, is a module-local change.
 *
 * **An anchor** answers "what is this document attached to" — resolved from
 * the Document's `projectId`, because every domain already backs its entities
 * with a Project (Patient.chartProjectId, Course.materialsProjectId,
 * Client.filesProjectId, InventoryItem.filesProjectId, and IT's plain
 * Projects). That is why this capability needed no new document store.
 *
 * **A lens** answers "what should this reader get out of it". Lenses are
 * ordered most-specific-first and selected by the caller's *existing*
 * permissions, so role differentiation falls out of the RBAC system already
 * in place rather than from a switch on role name. On one Course document a
 * Teacher gets class performance, a Registrar gets enrolment compliance, and
 * a Student gets feedback on their own work — from the same document, the
 * same mutation and no per-role code.
 */

export type FindingSeverity = "info" | "attention" | "risk";

export interface ReportLens {
  /** Stable id, stored on every analysis row so an old insight keeps saying
   * which question it answered even after lenses change. */
  key: string;
  label: string;
  /** "resource:action" — presence-only, identical contract to
   * `DataSourceDefinition.requiredPermission`. The FIRST lens whose
   * permission the caller holds wins, so order these most-specific first.
   * A lens with no permission is the anchor's fallback for anyone who can
   * see the document at all. */
  requiredPermission?: string;
  /** What this reader actually needs from the report, in plain language.
   * Becomes the analysis instruction — written for the domain, not for the
   * model, so it reads like a job description rather than a prompt. */
  focus: string;
}

export interface ReportAnchor {
  /** e.g. "course", "patient", "invoiceClient", "project". */
  type: string;
  /** Shown to the reader: "Algebra II", "Ada Lovelace". */
  resolveContext: (tx: PrismaTx, tenantId: string, projectId: string) => Promise<AnchorContext | null>;
  lenses: ReportLens[];
}

export interface AnchorContext {
  /** Human name of the thing the document hangs off. */
  name: string;
  /** One line of domain context handed to the model — e.g. "a course with 24
   * enrolled students, taught by Dr Chen". Optional; anchors that have
   * nothing useful to add return just a name. */
  detail?: string;
}

export interface ResolvedLens {
  anchorType: string;
  anchorName: string;
  anchorDetail?: string;
  lens: ReportLens;
}

@Injectable()
export class ReportLensRegistry {
  private readonly anchors: ReportAnchor[] = [];

  register(anchor: ReportAnchor): void {
    if (this.anchors.some((a) => a.type === anchor.type)) {
      throw new Error(`Report anchor "${anchor.type}" is already registered`);
    }
    this.anchors.push(anchor);
  }

  list(): readonly ReportAnchor[] {
    return this.anchors;
  }

  /**
   * Which lens applies to this document, for this caller.
   *
   * Returns null when nothing matches — either the document hangs off a
   * project no anchor claims (a plain IT project in a domain workspace, say),
   * or the caller holds none of the anchor's lens permissions. Callers turn
   * that into a refusal rather than silently analysing with a default lens:
   * an analysis whose angle nobody chose is worse than no analysis.
   *
   * Anchors are probed sequentially, not with Promise.all — same shared-`tx`
   * rule as every other multi-query path in this codebase (CONTEXT.md §9).
   */
  async resolve(tx: PrismaTx, ctx: DataSourceContext, projectId: string): Promise<ResolvedLens | null> {
    for (const anchor of this.anchors) {
      const context = await anchor.resolveContext(tx, ctx.tenantId, projectId);
      if (!context) continue;

      for (const lens of anchor.lenses) {
        if (lens.requiredPermission) {
          const [resource, action] = lens.requiredPermission.split(":");
          if (ctx.effective.has(resource!, action!) === null) continue;
        }
        return { anchorType: anchor.type, anchorName: context.name, anchorDetail: context.detail, lens };
      }
      // The anchor claimed this project but the caller matched no lens —
      // stop rather than letting a later anchor mis-claim it.
      return null;
    }
    return null;
  }
}
