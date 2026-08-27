import { randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Logger, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import type { SupabaseAdminService } from "../../auth/supabase-admin.service";
import type { EmailService } from "../../email/email.service";
import type { PrismaTx, TenantPrismaService } from "../../tenancy/tenant-prisma.service";
import { isRoleAssignableBy } from "../../rbac/role-hierarchy";
import { logAudit } from "../../audit/log-audit";
import { assertSeatAvailable } from "../../billing/assert-seat-available";

const logger = new Logger("UsersMutations");

/** Shared by `user.invite` and `userAssignDepartmentMutation` — both need to
 * confirm a department (and, if given, a team within that exact department)
 * genuinely exist in this tenant before writing them onto a User row. */
async function validateDepartmentAndTeam(tx: PrismaTx, tenantId: string, departmentId: string, teamId?: string) {
  const department = await tx.department.findFirst({ where: { id: departmentId, tenantId } });
  if (!department) throw new BadRequestException(`No department "${departmentId}" in this tenant`);

  if (teamId) {
    const team = await tx.team.findFirst({ where: { id: teamId, tenantId, departmentId } });
    if (!team) throw new BadRequestException(`No team "${teamId}" in department "${departmentId}"`);
  }
}

// Base64url avoids characters that are awkward to read/type aloud when an
// Admin hands this password to a teammate out of band (no email delivery in
// Phase 1 — see CONTEXT.md). 18 random bytes -> 24 base64url chars, well
// above Supabase Auth's 6-char minimum.
export function generateTemporaryPassword(): string {
  return randomBytes(18).toString("base64url");
}

const InviteInputSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  roleId: z.string(),
  departmentId: z.string(),
  teamId: z.string().optional(),
});

/** A factory, not a plain exported constant like project/task mutations —
 * this mutation needs `SupabaseAdminService`/`EmailService` (real
 * NestJS-injectable dependencies), which a plain `resolve(input, ctx, tx)`
 * function has no way to receive. `UsersRegistrar` (a real `@Injectable`)
 * builds this once at boot with its own injected instances and registers
 * the result. Also takes `TenantPrismaService` — the invite email needs
 * `Tenant.name`/`workspaceId`, a platform-root table unreachable via the
 * resolver's own tenant-scoped `tx` (same reasoning as
 * `createUpdateBrandingMutation` in `settings.mutations.ts`). */
export function createUserInviteMutation(
  supabaseAdmin: SupabaseAdminService,
  emailService: EmailService,
  tenantPrisma: TenantPrismaService,
): MutationDefinition<z.infer<typeof InviteInputSchema>> {
  return {
    name: "user.invite",
    inputSchema: InviteInputSchema,
    // Distinct from `user:manage` (org placement/roster) — only Company
    // Admin has this by default; it's the one permission the future
    // delegation stage grants to HR Manager, deliberately kept narrow so
    // there's a single thing to delegate rather than a bundle.
    requiredPermission: "user:invite",
    async resolve(input, ctx, tx) {
      const role = await tx.role.findFirst({ where: { id: input.roleId, tenantId: ctx.tenantId } });
      if (!role) throw new BadRequestException(`No role "${input.roleId}" in this tenant`);

      // Has no practical effect while only Company Admin holds
      // `user:invite` (Admin bypasses this check entirely) — but it's what
      // makes a future delegated `user:invite` grant safe by construction:
      // without it, a delegated inviter could hand out Company Admin.
      if (!(await isRoleAssignableBy(tx, ctx.tenantId, ctx.userId, role.id))) {
        throw new ForbiddenException(`Not allowed to assign role "${role.label}"`);
      }

      await validateDepartmentAndTeam(tx, ctx.tenantId, input.departmentId, input.teamId);

      // Checked before ever touching Supabase — this is the common case
      // (re-inviting someone already on the roster), and it gets a specific,
      // actionable message instead of falling through to the generic
      // "email already registered" case supabaseAdmin.createUser handles for
      // a collision with some *other* tenant's account.
      const existing = await tx.user.findFirst({ where: { tenantId: ctx.tenantId, email: input.email, deletedAt: null } });
      if (existing) throw new BadRequestException("This user has already been invited to this workspace");

      // Go-Live — the seat ceiling. Deliberately checked AFTER the
      // already-invited check above, so re-inviting an existing member gets
      // its specific message rather than a misleading "you're out of seats",
      // and BEFORE any Supabase Auth account is created, so a blocked invite
      // never leaves an orphaned auth user behind.
      await assertSeatAvailable(tx, tenantPrisma, ctx.tenantId);

      const tenant = await tenantPrisma.root.tenant.findUnique({ where: { id: ctx.tenantId } });
      if (!tenant) throw new BadRequestException(`No tenant "${ctx.tenantId}"`);

      // Whoever is actually calling this mutation — surfaced in the invite
      // email (both the `From` display name and the body) as "Name (Role)"
      // so the recipient sees the real person and their standing (Company
      // Admin, HR Manager, ...) rather than a generic company-branded
      // sender. Formatted once, here, rather than in EmailService, so
      // there's a single source of truth for the label shared by both.
      const inviter = await tx.user.findFirst({ where: { id: ctx.userId, tenantId: ctx.tenantId } });
      const inviterRoleAssignment = await tx.roleAssignment.findFirst({
        where: { tenantId: ctx.tenantId, userId: ctx.userId },
        include: { role: true },
      });
      const inviterLabel = inviter
        ? `${inviter.displayName} (${inviterRoleAssignment?.role.label ?? "Admin"})`
        : "A workspace admin";

      const temporaryPassword = generateTemporaryPassword();
      const authUser = await supabaseAdmin.createUser(input.email, temporaryPassword);

      try {
        const user = await tx.user.create({
          data: {
            tenantId: ctx.tenantId,
            authUserId: authUser.id,
            email: input.email,
            displayName: input.displayName,
            departmentId: input.departmentId,
            teamId: input.teamId ?? null,
            mustChangePassword: true,
          },
        });
        await tx.roleAssignment.create({ data: { tenantId: ctx.tenantId, userId: user.id, roleId: role.id } });
        // Audit Logs (module 6 of 6) — user lifecycle is one of the bounded
        // ~15-20 high-value call sites.
        await logAudit(tx, ctx, {
          action: "user.invite",
          resource: "user",
          resourceId: user.id,
          after: { email: user.email, displayName: user.displayName, roleId: role.id, departmentId: input.departmentId },
        });

        // Sent inside the request, after the transaction's writes are queued
        // but the account is already usable regardless of delivery outcome —
        // see EmailService.sendInviteEmail's doc comment for why this never
        // throws or rolls back the invite.
        const emailSent = await emailService.sendInviteEmail({
          to: input.email,
          employeeName: input.displayName,
          companyName: tenant.name,
          invitedByName: inviterLabel,
          workspaceId: tenant.workspaceId ?? "",
          temporaryPassword,
          loginUrl: `${process.env.APP_BASE_URL}/login`,
        });

        // Only handed back to the Admin's browser when delivery failed —
        // when the email went out, the invitee is its sole recipient, so the
        // API response shouldn't carry the plaintext credential at all.
        return { id: user.id, email: user.email, emailSent, temporaryPassword: emailSent ? undefined : temporaryPassword };
      } catch (err) {
        // Same all-or-nothing rollback as AuthService.signup — an orphaned
        // Supabase auth user with no matching `User` row is worse than a
        // failed invite. Logged (not swallowed) if the cleanup itself fails —
        // see AuthService.signup's matching comment for why this matters:
        // silent failure here permanently blocks the invited email with no
        // trace of why.
        await supabaseAdmin.deleteUser(authUser.id).catch((cleanupErr) => {
          logger.error(
            `Invite for "${input.email}" failed and rollback of its Supabase Auth user (${authUser.id}) also failed — ` +
              `this email is now orphaned and will block future invites/signups until that auth user is deleted manually: ` +
              `${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`,
          );
        });
        throw err;
      }
    },
  };
}

const ChangeRoleInputSchema = z.object({
  userId: z.string(),
  roleId: z.string(),
});

// Promote/demote an *existing* user — distinct from `user.invite`, which
// only ever sets a role at brand-new-user creation time. Plain constant, no
// injected service needed (unlike user.invite above).
export const userChangeRoleMutation: MutationDefinition<z.infer<typeof ChangeRoleInputSchema>> = {
  name: "user.changeRole",
  inputSchema: ChangeRoleInputSchema,
  requiredPermission: "role:assign",
  async resolve(input, ctx, tx) {
    if (input.userId === ctx.userId) {
      throw new ForbiddenException("Cannot change your own role");
    }

    const user = await tx.user.findFirst({ where: { id: input.userId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!user) throw new NotFoundException(`No user "${input.userId}"`);

    const role = await tx.role.findFirst({ where: { id: input.roleId, tenantId: ctx.tenantId } });
    if (!role) throw new BadRequestException(`No role "${input.roleId}" in this tenant`);

    if (!(await isRoleAssignableBy(tx, ctx.tenantId, ctx.userId, role.id))) {
      throw new ForbiddenException(`Not allowed to assign role "${role.label}"`);
    }

    // Fetched purely for the audit trail's "before" value — role/permission
    // changes are exactly the kind of high-value event this module exists
    // for, worth one extra read here.
    const previousAssignment = await tx.roleAssignment.findFirst({ where: { tenantId: ctx.tenantId, userId: input.userId } });

    // Single-role-per-user, matching how user.invite only ever creates one —
    // a promotion/demotion replaces what someone IS, not adds a second role.
    await tx.roleAssignment.deleteMany({ where: { tenantId: ctx.tenantId, userId: input.userId } });
    await tx.roleAssignment.create({ data: { tenantId: ctx.tenantId, userId: input.userId, roleId: role.id } });

    await logAudit(tx, ctx, {
      action: "user.changeRole",
      resource: "user",
      resourceId: input.userId,
      before: { roleId: previousAssignment?.roleId ?? null },
      after: { roleId: role.id },
    });

    return { success: true };
  },
};

const AssignDepartmentInputSchema = z.object({
  userId: z.string(),
  departmentId: z.string(),
  teamId: z.string().optional(),
});

// Mutates the User row's own fields (org placement) — lives with the other
// user.* mutations rather than in the HR module, same reasoning as
// user.invite. A plain constant (no injected service needed here), unlike
// user.invite above.
export const userAssignDepartmentMutation: MutationDefinition<z.infer<typeof AssignDepartmentInputSchema>> = {
  name: "user.assignDepartment",
  inputSchema: AssignDepartmentInputSchema,
  requiredPermission: "user:manage",
  async resolve(input, ctx, tx) {
    // Department Head's `user:manage:own` constrains the *destination*: they
    // can place someone into their own department, but not into a different
    // one. Deliberately doesn't also require the target's *current*
    // department to already match — over-restricting risks blocking a
    // legitimate first-time placement of someone with no department yet.
    const scope = ctx.effective.has("user", "manage");
    if (scope === "own" && input.departmentId !== ctx.userDepartmentId) {
      throw new ForbiddenException("Not allowed to assign users into a different department");
    }

    const user = await tx.user.findFirst({ where: { id: input.userId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!user) throw new NotFoundException(`No user "${input.userId}"`);

    await validateDepartmentAndTeam(tx, ctx.tenantId, input.departmentId, input.teamId);

    const updated = await tx.user.update({
      where: { id: input.userId },
      data: { departmentId: input.departmentId, teamId: input.teamId ?? null },
    });

    await logAudit(tx, ctx, {
      action: "user.assignDepartment",
      resource: "user",
      resourceId: input.userId,
      before: { departmentId: user.departmentId, teamId: user.teamId },
      after: { departmentId: updated.departmentId, teamId: updated.teamId },
    });

    return updated;
  },
};

const SetManagerInputSchema = z.object({
  userId: z.string(),
  managerId: z.string().nullable(),
});

// Sets the reports-to relationship (ORG_HIERARCHY.md §9) — deliberately
// independent of department/team placement and never silently derived from
// either; a separate, explicit mutation rather than folded into
// user.assignDepartment. Same "own" scope treatment as that mutation
// (constrains the target user, not the manager being assigned).
export const userSetManagerMutation: MutationDefinition<z.infer<typeof SetManagerInputSchema>> = {
  name: "user.setManager",
  inputSchema: SetManagerInputSchema,
  requiredPermission: "user:manage",
  async resolve(input, ctx, tx) {
    const user = await tx.user.findFirst({ where: { id: input.userId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!user) throw new NotFoundException(`No user "${input.userId}"`);

    const scope = ctx.effective.has("user", "manage");
    if (scope === "own" && user.departmentId !== ctx.userDepartmentId) {
      throw new ForbiddenException("Not allowed to set the manager for a user outside your own department");
    }

    if (input.managerId) {
      if (input.managerId === input.userId) throw new BadRequestException("A user cannot be their own manager");
      const manager = await tx.user.findFirst({ where: { id: input.managerId, tenantId: ctx.tenantId, deletedAt: null } });
      if (!manager) throw new BadRequestException(`No user "${input.managerId}" in this tenant`);
    }

    const updated = await tx.user.update({ where: { id: input.userId }, data: { managerId: input.managerId } });

    await logAudit(tx, ctx, {
      action: "user.setManager",
      resource: "user",
      resourceId: input.userId,
      before: { managerId: user.managerId },
      after: { managerId: updated.managerId },
    });

    return updated;
  },
};
