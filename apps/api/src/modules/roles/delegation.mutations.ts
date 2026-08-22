import { ConflictException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import { assertPermissionsGrantableByActor } from "../../rbac/permission-grant-check";
import { assertKnownPermissions } from "./roles.mutations";
import { logAudit } from "../../audit/log-audit";

const GrantDelegationInputSchema = z.object({
  userId: z.string(),
  permissions: z.array(z.string()).min(1),
});

/** Per-user permission override ("Delegation") — grants specific triples to
 * ONE individual, on top of whatever role(s) they hold. Same order as
 * role.createCustom: catalog membership (400) before escalation (403), since
 * they're distinct failure modes. */
export const delegationGrantMutation: MutationDefinition<z.infer<typeof GrantDelegationInputSchema>> = {
  name: "delegation.grant",
  inputSchema: GrantDelegationInputSchema,
  requiredPermission: "role:manage",
  async resolve(input, ctx, tx) {
    const target = await tx.user.findFirst({ where: { id: input.userId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!target) throw new NotFoundException(`No user "${input.userId}"`);

    assertKnownPermissions(input.permissions);
    assertPermissionsGrantableByActor(ctx.effective, input.permissions);

    const alreadyActive = await tx.permissionDelegation.findMany({
      where: { tenantId: ctx.tenantId, userId: input.userId, revokedAt: null, permission: { in: input.permissions } },
      select: { permission: true },
    });
    if (alreadyActive.length > 0) {
      throw new ConflictException(`Already delegated: ${alreadyActive.map((d) => d.permission).join(", ")}`);
    }

    // Sequential creates, not createMany/createManyAndReturn — this
    // codebase has no existing use of createManyAndReturn (an unverified
    // surface against this project's Prisma 7 + PrismaPg driver-adapter
    // setup) and this keeps the standing sequential-query-per-tx discipline
    // uniform throughout the mutation.
    const created = [];
    for (const permission of input.permissions) {
      created.push(
        await tx.permissionDelegation.create({
          data: { tenantId: ctx.tenantId, userId: input.userId, permission, grantedById: ctx.userId },
        }),
      );
    }

    // Self-delegation fires no notification — same "telling someone about
    // their own action isn't a notification" precedent used elsewhere.
    // Left unblocked entirely (unlike user.changeRole's self-change guard):
    // assertPermissionsGrantableByActor already caps a self-grant at what
    // the actor holds, so it carries no escalation risk.
    if (input.userId !== ctx.userId) {
      await tx.notification.create({
        data: {
          tenantId: ctx.tenantId,
          userId: input.userId,
          type: "delegation.granted",
          title: "You were granted an extra permission",
          body: input.permissions.join(", "),
          data: { delegationIds: created.map((d) => d.id), permissions: input.permissions },
        },
      });
    }

    await logAudit(tx, ctx, { action: "delegation.grant", resource: "delegation", resourceId: input.userId, after: { permissions: input.permissions } });

    return created;
  },
};

const RevokeDelegationInputSchema = z.object({ delegationId: z.string() });

/** No assertPermissionsGrantableByActor here — deliberate. Revocation is
 * gated identically to granting (role:manage); any holder may revoke ANY
 * delegation, not only its original grantor. Revoking can only remove
 * authority, never add it, so there is no escalation surface to guard. */
export const delegationRevokeMutation: MutationDefinition<z.infer<typeof RevokeDelegationInputSchema>> = {
  name: "delegation.revoke",
  inputSchema: RevokeDelegationInputSchema,
  requiredPermission: "role:manage",
  async resolve(input, ctx, tx) {
    const delegation = await tx.permissionDelegation.findFirst({
      where: { id: input.delegationId, tenantId: ctx.tenantId, revokedAt: null },
    });
    if (!delegation) throw new NotFoundException(`No active delegation "${input.delegationId}"`);

    const revoked = await tx.permissionDelegation.update({
      where: { id: input.delegationId },
      data: { revokedAt: new Date(), revokedById: ctx.userId },
    });

    if (delegation.userId !== ctx.userId) {
      await tx.notification.create({
        data: {
          tenantId: ctx.tenantId,
          userId: delegation.userId,
          type: "delegation.revoked",
          title: "A delegated permission was revoked",
          body: delegation.permission,
          data: { delegationId: delegation.id, permission: delegation.permission },
        },
      });
    }

    await logAudit(tx, ctx, {
      action: "delegation.revoke",
      resource: "delegation",
      resourceId: input.delegationId,
      before: { userId: delegation.userId, permission: delegation.permission },
    });

    return revoked;
  },
};
