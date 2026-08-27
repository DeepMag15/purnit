import { NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import { WidgetLayoutEntrySchema } from "./dashboard-layout.types";

// Platform UI/UX Redesign, Phase F — `dashboardKey` is additive and
// defaults to "analytics", so every existing Analytics call site (which
// never passes it) is 100% behavior-unchanged. Lets a second named
// dashboard (Dashboard's own `DashboardGrid`, dashboardKey: "dashboard")
// reuse this exact same persistence/versioning mechanism rather than a
// second one — the `DashboardLayout` model's own `dashboardKey` column was
// already designed for this, just never generalized past the one literal.
const SaveInputSchema = z.object({ widgets: z.array(WidgetLayoutEntrySchema), dashboardKey: z.string().default("analytics") });

/** Personal layout save — no requiredPermission, every tenant member may
 * save their own arrangement, same "universal, ownership-scoped" precedent
 * `notifications.list` already set. TenantConfig's own exact versioning
 * shape (`updateNavigationLabelMutation`, settings.mutations.ts): deactivate
 * the current active row (if any), insert a new one — never UPDATE
 * `widgets` in place. Both statements run inside this mutation's own
 * already-open `tx` (MutationsController wraps every resolve() in one
 * transaction), so this is atomic by construction. The two partial unique
 * indexes (dashboard_layouts_one_active_per_user/_role) are the real,
 * DB-level backstop — not application logic alone. */
export const dashboardLayoutSaveMutation: MutationDefinition<z.infer<typeof SaveInputSchema>> = {
  name: "dashboardLayout.save",
  inputSchema: SaveInputSchema,
  async resolve(input, ctx, tx) {
    const current = await tx.dashboardLayout.findFirst({
      where: { tenantId: ctx.tenantId, userId: ctx.userId, dashboardKey: input.dashboardKey, isActive: true },
    });
    if (current) {
      await tx.dashboardLayout.update({ where: { id: current.id }, data: { isActive: false } });
    }
    return tx.dashboardLayout.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        dashboardKey: input.dashboardKey,
        widgets: input.widgets,
        version: (current?.version ?? 0) + 1,
        isActive: true,
      },
    });
  },
};

const ResetInputSchema = z.object({ dashboardKey: z.string().default("analytics") });

/** Deactivates the caller's own active personal layout, if one exists — no
 * new row inserted. The next analytics.dashboard call then falls through to
 * the role-level template (or the frontend's own auto-computed
 * arrangement, if neither exists). A no-op, not an error, when the caller
 * has no personal layout to begin with. */
export const dashboardLayoutResetMutation: MutationDefinition<z.infer<typeof ResetInputSchema>> = {
  name: "dashboardLayout.reset",
  inputSchema: ResetInputSchema,
  async resolve(input, ctx, tx) {
    const current = await tx.dashboardLayout.findFirst({
      where: { tenantId: ctx.tenantId, userId: ctx.userId, dashboardKey: input.dashboardKey, isActive: true },
    });
    if (current) {
      await tx.dashboardLayout.update({ where: { id: current.id }, data: { isActive: false } });
    }
    return { success: true };
  },
};

const SaveAsTemplateInputSchema = z.object({
  roleId: z.string(),
  widgets: z.array(WidgetLayoutEntrySchema),
  dashboardKey: z.string().default("analytics"),
});

/** Company-Admin-tier — reuses the existing role:manage permission rather
 * than inventing a new one, same "reuse before inventing" precedent as
 * every other module in this codebase. Versions the TARGET role's row
 * identically to .save above, keyed by roleId instead of userId. */
export const dashboardLayoutSaveAsTemplateMutation: MutationDefinition<z.infer<typeof SaveAsTemplateInputSchema>> = {
  name: "dashboardLayout.saveAsTemplate",
  inputSchema: SaveAsTemplateInputSchema,
  requiredPermission: "role:manage",
  async resolve(input, ctx, tx) {
    const role = await tx.role.findFirst({ where: { id: input.roleId, tenantId: ctx.tenantId } });
    if (!role) throw new NotFoundException(`No role "${input.roleId}" in this tenant`);

    const current = await tx.dashboardLayout.findFirst({
      where: { tenantId: ctx.tenantId, roleId: input.roleId, dashboardKey: input.dashboardKey, isActive: true },
    });
    if (current) {
      await tx.dashboardLayout.update({ where: { id: current.id }, data: { isActive: false } });
    }
    return tx.dashboardLayout.create({
      data: {
        tenantId: ctx.tenantId,
        roleId: input.roleId,
        dashboardKey: input.dashboardKey,
        widgets: input.widgets,
        version: (current?.version ?? 0) + 1,
        isActive: true,
      },
    });
  },
};
