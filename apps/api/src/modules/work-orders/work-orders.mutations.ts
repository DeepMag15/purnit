import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";

/** Same `requireClientInScope` shape every module follows. */
async function requireWorkOrderInScope(tx: PrismaTx, ctx: MutationContext, workOrderId: string) {
  const existing = await tx.workOrder.findFirst({ where: { id: workOrderId, tenantId: ctx.tenantId, deletedAt: null } });
  if (!existing) throw new NotFoundException(`No work order "${workOrderId}"`);

  const scope = ctx.effective.has("workOrder", "update");
  const inScope = scope && isRowInScope(scope, { ownerId: existing.assignedToId }, { userId: ctx.userId });
  if (!inScope) throw new ForbiddenException("Not allowed to update this work order");
  return existing;
}

const CreateInputSchema = z.object({
  itemId: z.string(),
  quantity: z.number().int().positive(),
  dueDate: z.string(),
  assignedToId: z.string().optional(),
  notes: z.string().optional(),
});

/** `assignedToId` defaults to the creator — a real, non-inert `:own` scope
 * floor, same "the person who creates it becomes its owner" pattern
 * `client.create`'s `accountManagerId` already established. */
export const workOrderCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "workOrder.create",
  inputSchema: CreateInputSchema,
  requiredPermission: "workOrder:create",
  async resolve(input, ctx, tx) {
    const item = await tx.inventoryItem.findFirst({ where: { id: input.itemId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!item) throw new NotFoundException(`No inventory item "${input.itemId}"`);

    if (input.assignedToId) {
      const assignee = await tx.user.findFirst({ where: { id: input.assignedToId, tenantId: ctx.tenantId, deletedAt: null } });
      if (!assignee) throw new NotFoundException(`No user "${input.assignedToId}"`);
    }

    return tx.workOrder.create({
      data: {
        tenantId: ctx.tenantId,
        itemId: input.itemId,
        quantity: input.quantity,
        dueDate: new Date(input.dueDate),
        assignedToId: input.assignedToId ?? ctx.userId,
        notes: input.notes,
        createdById: ctx.userId,
      },
    });
  },
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  planned: ["in_progress", "cancelled"],
  in_progress: ["cancelled"],
  completed: [],
  cancelled: [],
};

const UpdateStatusInputSchema = z.object({ id: z.string(), status: z.enum(["planned", "in_progress", "cancelled"]) });

/** Only forward scheduling transitions — deliberately NEVER `→completed`.
 * Moving to "completed" is `workOrder.complete`'s own job, gated on the
 * distinct `workOrder:complete` permission — the production half of this
 * domain's segregation-of-duties control. Scope-checked via
 * `requireWorkOrderInScope` (real `:own` for Production Planner). */
export const workOrderUpdateStatusMutation: MutationDefinition<z.infer<typeof UpdateStatusInputSchema>> = {
  name: "workOrder.updateStatus",
  inputSchema: UpdateStatusInputSchema,
  requiredPermission: "workOrder:update",
  async resolve(input, ctx, tx) {
    const existing = await requireWorkOrderInScope(tx, ctx, input.id);
    if (existing.status !== input.status && !VALID_TRANSITIONS[existing.status]?.includes(input.status)) {
      throw new BadRequestException(`Cannot move a work order from "${existing.status}" to "${input.status}"`);
    }
    return tx.workOrder.update({ where: { id: existing.id }, data: { status: input.status } });
  },
};

const CompleteInputSchema = z.object({ id: z.string() });

/** The production half of this domain's real segregation-of-duties
 * control: `workOrder:complete` is held by Warehouse Staff/Admin only —
 * Production Planner holds `workOrder:create/update:own` but zero
 * `workOrder:complete`, so it can schedule production yet can never be the
 * one to confirm it's done (`requiredPermission` alone enforces this — no
 * `:own` check here at all, matching `payment.record`'s own shape: this
 * action has no ownership concept, only a flat tenant-wide grant).
 * Requires "in_progress". Looks up every `BOMLine` for the item, validates
 * each component's `currentStock >= quantityRequired × quantity` BEFORE
 * mutating anything — the real payoff of having a BOM at all. */
export const workOrderCompleteMutation: MutationDefinition<z.infer<typeof CompleteInputSchema>> = {
  name: "workOrder.complete",
  inputSchema: CompleteInputSchema,
  requiredPermission: "workOrder:complete",
  async resolve(input, ctx, tx) {
    const existing = await tx.workOrder.findFirst({ where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null } });
    if (!existing) throw new NotFoundException(`No work order "${input.id}"`);
    if (existing.status !== "in_progress") {
      throw new BadRequestException(`Cannot complete a work order with status "${existing.status}"`);
    }

    const bomLines = await tx.bOMLine.findMany({ where: { tenantId: ctx.tenantId, parentItemId: existing.itemId } });
    if (bomLines.length > 0) {
      const componentIds = bomLines.map((l) => l.componentItemId);
      const components = await tx.inventoryItem.findMany({ where: { id: { in: componentIds } } });
      const componentsById = new Map(components.map((c) => [c.id, c]));

      const insufficient: string[] = [];
      for (const line of bomLines) {
        const component = componentsById.get(line.componentItemId);
        const required = line.quantityRequired * existing.quantity;
        if (!component || component.currentStock < required) {
          insufficient.push(`${component?.name ?? line.componentItemId} (need ${required}, have ${component?.currentStock ?? 0})`);
        }
      }
      if (insufficient.length > 0) {
        throw new BadRequestException(`Insufficient stock to complete this work order: ${insufficient.join("; ")}`);
      }

      for (const line of bomLines) {
        await tx.inventoryItem.update({
          where: { id: line.componentItemId },
          data: { currentStock: { decrement: line.quantityRequired * existing.quantity } },
        });
      }
    }

    await tx.inventoryItem.update({ where: { id: existing.itemId }, data: { currentStock: { increment: existing.quantity } } });

    return tx.workOrder.update({ where: { id: existing.id }, data: { status: "completed" } });
  },
};
