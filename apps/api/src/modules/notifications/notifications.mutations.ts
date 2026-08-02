import { NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";

// Ownership (`userId: ctx.userId`) is the only check here — same reasoning
// as notifications.data-sources.ts: an own-scoped inbox has no role-based
// permission to gate, only "is this yours."

const MarkReadInputSchema = z.object({ id: z.string() });

export const notificationMarkReadMutation: MutationDefinition<z.infer<typeof MarkReadInputSchema>> = {
  name: "notification.markRead",
  inputSchema: MarkReadInputSchema,
  async resolve(input, ctx, tx) {
    const existing = await tx.notification.findFirst({ where: { id: input.id, tenantId: ctx.tenantId, userId: ctx.userId } });
    if (!existing) throw new NotFoundException(`No notification "${input.id}"`);

    return tx.notification.update({ where: { id: input.id }, data: { readAt: new Date() } });
  },
};

const MarkAllReadInputSchema = z.object({});

export const notificationMarkAllReadMutation: MutationDefinition<z.infer<typeof MarkAllReadInputSchema>> = {
  name: "notification.markAllRead",
  inputSchema: MarkAllReadInputSchema,
  async resolve(_input, ctx, tx) {
    const { count } = await tx.notification.updateMany({
      where: { tenantId: ctx.tenantId, userId: ctx.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count };
  },
};
