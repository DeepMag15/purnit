import { z } from "zod";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

/** Manufacturing Domain, Phase A. No top-level nav page — reached only via
 * `InventoryItemDetail`'s own BOM tab, same as Assignment/Grade in
 * Education. `bomLine:read` gates the whole list; no `:own` concept. */
const ListParamsSchema = z.object({ parentItemId: z.string() });

/**
 * AI RAG Phase C — the reusable `xWhere`-style scope function this module
 * never had before. Deliberately does NOT invent a new `:own` tier —
 * `bomLine:read` has no `:own` concept today (this file's own comment
 * above), mirroring `InventoryItem`'s explicit design ("every role that can
 * see items at all sees the whole shared catalog"). Inventing one here
 * would silently widen product scope beyond what wiring RAG calls for.
 */
export async function bomLinesWhere(tx: PrismaTx, ctx: DataSourceContext, extra: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("bomLine", "read");
  if (!scope) return null;
  return { tenantId: ctx.tenantId, ...extra };
}

export const bomLinesListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "bomLines.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "bomLine:read",
  async resolve(params, ctx, tx) {
    const lines = await tx.bOMLine.findMany({
      where: { tenantId: ctx.tenantId, parentItemId: params.parentItemId },
      orderBy: { createdAt: "asc" },
    });
    if (lines.length === 0) return [];

    const componentIds = [...new Set(lines.map((l) => l.componentItemId))];
    const components = await tx.inventoryItem.findMany({
      where: { id: { in: componentIds } },
      select: { id: true, sku: true, name: true, unitOfMeasure: true, currentStock: true },
    });
    const componentsById = new Map(components.map((c) => [c.id, c]));

    return lines.map((line) => ({
      ...line,
      component: componentsById.get(line.componentItemId) ?? null,
    }));
  },
};
