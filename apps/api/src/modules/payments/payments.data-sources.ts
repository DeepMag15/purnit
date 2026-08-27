import { z } from "zod";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

/** Same `*Where()` contract every module follows. No role in this blueprint
 * is ever granted `payment:read:own` today (only Admin/Accountant hold
 * `payment:read`, both `:tenant`) — the `:own` branch (payments the actor
 * personally recorded, via `recordedById`) exists defensively for a future
 * custom role, same "not exercised today, still correct" precedent
 * `students.data-sources.ts`'s own `studentsWhere` doc comment established. */
export async function paymentsWhere(
  tx: PrismaTx,
  ctx: DataSourceContext,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("payment", "read");
  if (!scope) return null;

  const where: Record<string, unknown> = { tenantId: ctx.tenantId, ...extra };
  if (scope === "tenant") return where;
  where.recordedById = ctx.userId;
  return where;
}

async function withRecorderNames(tx: PrismaTx, payments: { recordedById: string }[]) {
  const recorderIds = [...new Set(payments.map((p) => p.recordedById))];
  if (recorderIds.length === 0) return new Map<string, string>();
  const recorders = await tx.user.findMany({ where: { id: { in: recorderIds } }, select: { id: true, displayName: true } });
  return new Map(recorders.map((r) => [r.id, r.displayName]));
}

const ListParamsSchema = z.object({ invoiceId: z.string() });

export const paymentsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "payments.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "payment:read",
  async resolve(params, ctx, tx) {
    const where = await paymentsWhere(tx, ctx, { invoiceId: params.invoiceId });
    if (!where) return [];
    const payments = await tx.payment.findMany({ where, orderBy: { paidAt: "desc" } });
    const recorderNames = await withRecorderNames(tx, payments);
    return payments.map((p) => ({ ...p, recordedByName: recorderNames.get(p.recordedById) ?? "Unknown" }));
  },
};
