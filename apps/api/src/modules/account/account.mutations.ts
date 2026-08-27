import { BadRequestException, ForbiddenException, Logger, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import type { TenantPrismaService } from "../../tenancy/tenant-prisma.service";
import type { SupabaseAdminService } from "../../auth/supabase-admin.service";
import { StripeService } from "../../billing/stripe.service";
import { logAudit } from "../../audit/log-audit";

const logger = new Logger("AccountMutations");

// ---------------------------------------------------------------------------
// account.deleteSelf
// ---------------------------------------------------------------------------

const DeleteSelfInputSchema = z.object({
  /** The user must retype their own email. Not security — anyone reaching
   * this already holds the session — but a genuine misclick guard on an
   * action whose data becomes unrecoverable after the retention window. */
  confirmEmail: z.string().email(),
});

/**
 * Go-Live, Phase 05 — a person deleting their own account.
 *
 * **No `requiredPermission`**, deliberately: this acts on the caller's own
 * user row and nothing else, so ownership *is* the authorization — the same
 * reasoning `notifications.list` and `comment.delete` already use. Adding a
 * permission would mean an admin could revoke someone's ability to leave,
 * which is the opposite of what a data-protection feature should allow.
 *
 * Soft-delete, not hard: the `User` row is referenced by tasks, comments,
 * messages and audit entries across the tenant, and removing it immediately
 * would either cascade into other people's data or leave dangling references.
 * The retention job purges it after the window (see retention-purge.service).
 *
 * The Supabase Auth user IS deleted immediately, because the alternative —
 * leaving a working login attached to a deleted account — is worse. That
 * makes the deletion irreversible from the user's side even inside the
 * retention window; the window protects the *data* for recovery by an
 * operator, not the login. Said plainly here rather than implied.
 */
export function createDeleteSelfMutation(
  tenantPrisma: TenantPrismaService,
  supabaseAdmin: SupabaseAdminService,
): MutationDefinition<z.infer<typeof DeleteSelfInputSchema>> {
  return {
    name: "account.deleteSelf",
    inputSchema: DeleteSelfInputSchema,
    async resolve(input, ctx, tx) {
      const user = await tx.user.findFirst({ where: { id: ctx.userId, tenantId: ctx.tenantId, deletedAt: null } });
      if (!user) throw new NotFoundException("No account to delete");

      if (user.email.toLowerCase() !== input.confirmEmail.trim().toLowerCase()) {
        throw new BadRequestException("The email you typed doesn't match this account");
      }

      // A workspace with no Company Admin cannot be administered, billed, or
      // closed — it would be permanently stranded. The last admin has to hand
      // over first, which is a real product rule, not a technical limitation.
      const adminRole = await tx.role.findFirst({ where: { tenantId: ctx.tenantId, sourceBlueprintRoleId: "role.admin" } });
      if (adminRole) {
        const isAdmin = await tx.roleAssignment.findFirst({ where: { tenantId: ctx.tenantId, userId: ctx.userId, roleId: adminRole.id } });
        if (isAdmin) {
          const otherAdmins = await tx.roleAssignment.count({
            where: { tenantId: ctx.tenantId, roleId: adminRole.id, userId: { not: ctx.userId } },
          });
          if (otherAdmins === 0) {
            throw new ForbiddenException(
              "You're the only Company Admin. Promote someone else first, or close the whole workspace instead.",
            );
          }
        }
      }

      await tx.user.update({ where: { id: ctx.userId }, data: { deletedAt: new Date() } });

      await logAudit(tx, ctx, { action: "account.deleteSelf", resource: "user", resourceId: ctx.userId });

      // Last, and outside the tenant data: revoking the login is what makes
      // the deletion take effect immediately. Failure is logged rather than
      // thrown — the row is already soft-deleted and `CurrentUserService`
      // rejects it, so access is gone either way; a surviving auth user is an
      // orphan to clean up, not a security hole.
      if (user.authUserId) {
        await supabaseAdmin.deleteUser(user.authUserId).catch((err) => {
          logger.error(
            `Soft-deleted user ${ctx.userId} but failed to delete their Supabase Auth account (${user.authUserId}): ` +
              `${err instanceof Error ? err.message : err}`,
          );
        });
      }

      return { deleted: true, purgeAfterDays: 30 };
    },
  };
}

// ---------------------------------------------------------------------------
// tenant.closeWorkspace
// ---------------------------------------------------------------------------

const CloseWorkspaceInputSchema = z.object({
  /** The workspace ID, retyped. The most destructive action in the product
   * gets the strongest confirmation the UI can ask for. */
  confirmWorkspaceId: z.string().min(1),
});

/**
 * Go-Live, Phase 05 — closing an entire workspace.
 *
 * Gated on its own `tenant:delete` permission rather than `settings:manage`,
 * because deleting every record an organization owns is not the same
 * authority as editing its branding.
 *
 * Three things happen, and the order matters:
 *  1. The Stripe subscription is cancelled first — a closed workspace that
 *     keeps billing its customer is the worst possible failure here, and it
 *     is exactly the step that gets forgotten. Runs in `preResolve` so the
 *     external call never sits inside the transaction.
 *  2. Every `User` row is soft-deleted. This is what actually revokes access,
 *     and it does so through the check every request already performs — so
 *     closure costs nothing on the hot path.
 *  3. The tenant is marked closed and stamped for the retention job.
 */
export function createCloseWorkspaceMutation(
  tenantPrisma: TenantPrismaService,
  stripe: StripeService,
): MutationDefinition<z.infer<typeof CloseWorkspaceInputSchema>, { cancelledSubscription: boolean }> {
  return {
    name: "tenant.closeWorkspace",
    inputSchema: CloseWorkspaceInputSchema,
    requiredPermission: "tenant:delete",
    async preResolve(input, { tenantId }) {
      const tenant = await tenantPrisma.root.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException("No such workspace");
      if (tenant.deletedAt) throw new BadRequestException("This workspace is already closed");

      if ((tenant.workspaceId ?? "").toLowerCase() !== input.confirmWorkspaceId.trim().toLowerCase()) {
        throw new BadRequestException("The workspace ID you typed doesn't match");
      }

      // Stop the money before anything else. If this throws, nothing has been
      // destroyed and the admin can retry.
      if (tenant.stripeSubscriptionId && StripeService.isConfigured()) {
        try {
          await stripe.cancelSubscriptionAtPeriodEnd(tenant.stripeSubscriptionId);
          return { cancelledSubscription: true };
        } catch (err) {
          throw new BadRequestException(
            `Couldn't cancel the Stripe subscription, so the workspace was not closed — try again, or cancel from billing settings first. (${
              err instanceof Error ? err.message : err
            })`,
          );
        }
      }
      return { cancelledSubscription: false };
    },
    async resolve(_input, ctx, tx, pre) {
      const now = new Date();

      // Revokes access for everyone, via the check every request already
      // makes — no new per-request query.
      await tx.user.updateMany({ where: { tenantId: ctx.tenantId, deletedAt: null }, data: { deletedAt: now } });

      await logAudit(tx, ctx, { action: "tenant.closeWorkspace", resource: "tenant", resourceId: ctx.tenantId });

      // Tenant is a platform-root row, unreachable through the tenant-scoped
      // `tx` — same reasoning as every other billing/settings mutation.
      await tenantPrisma.root.tenant.update({
        where: { id: ctx.tenantId },
        data: { status: "closed", deletedAt: now, cancelAtPeriodEnd: true },
      });

      logger.warn(`Workspace ${ctx.tenantId} closed by user ${ctx.userId}; scheduled for purge after the retention window`);

      return { closed: true, cancelledSubscription: pre?.cancelledSubscription ?? false, purgeAfterDays: 30 };
    },
  };
}
