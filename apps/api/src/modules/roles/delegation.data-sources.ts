import { NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { DataSourceDefinition } from "../../data-sources/data-source-registry.service";

const ListDelegationsParamsSchema = z.object({ userId: z.string() });

/** Per-user, not tenant-wide, deliberately — a delegation is only ever
 * meaningful in the context of one specific person; the one real consumer
 * (RolesPermissionsWorkspace's UserPermissionViewer) always has a selected
 * user first. Same "two narrow sources over one over-fetching one"
 * discipline as attendance.list/attendance.roster. */
export const delegationsListDataSource: DataSourceDefinition<z.infer<typeof ListDelegationsParamsSchema>> = {
  name: "delegations.list",
  paramsSchema: ListDelegationsParamsSchema,
  requiredPermission: "role:manage",
  async resolve(params, ctx, tx) {
    const user = await tx.user.findFirst({ where: { id: params.userId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!user) throw new NotFoundException(`No user "${params.userId}"`);

    const delegations = await tx.permissionDelegation.findMany({
      where: { tenantId: ctx.tenantId, userId: params.userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });

    // grantedById has no Prisma relation (same as Announcement.authorId) —
    // resolve display names with one extra sequential findMany.
    const granterIds = [...new Set(delegations.map((d) => d.grantedById))];
    const granters = granterIds.length
      ? await tx.user.findMany({ where: { id: { in: granterIds } }, select: { id: true, displayName: true } })
      : [];
    const nameById = new Map(granters.map((g) => [g.id, g.displayName]));

    return delegations.map((d) => ({
      id: d.id,
      permission: d.permission,
      grantedById: d.grantedById,
      grantedByName: nameById.get(d.grantedById) ?? "Unknown",
      createdAt: d.createdAt,
    }));
  },
};
