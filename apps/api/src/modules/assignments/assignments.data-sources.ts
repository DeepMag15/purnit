import { z } from "zod";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { teacherOwnedCourseIds } from "../courses/courses.data-sources";

/** Education Domain, Phase A. Unlike `studentsWhere`/`enrollmentsWhere`'s
 * inert `:own` branches, THIS one is live: Teacher holds
 * `assignment:read:own`, TA holds `assignment:read:tenant` — the genuine
 * read-side differentiation in this domain. Resolved transitively through
 * `teacherOwnedCourseIds` (an ownership query, not `coursesWhere` — see that
 * function's own doc comment for why conflating the two would be a real
 * bug). */
export async function assignmentsWhere(
  tx: PrismaTx,
  ctx: DataSourceContext,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("assignment", "read");
  if (!scope) return null;

  const where: Record<string, unknown> = { tenantId: ctx.tenantId, deletedAt: null, ...extra };
  if (scope === "tenant") return where;
  where.courseId = { in: await teacherOwnedCourseIds(tx, ctx) };
  return where;
}

const ListParamsSchema = z.object({ courseId: z.string() });

export const assignmentsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "assignments.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "assignment:read",
  async resolve(params, ctx, tx) {
    const where = await assignmentsWhere(tx, ctx, { courseId: params.courseId });
    if (!where) return [];
    return tx.assignment.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
  },
};
