import { BadRequestException, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import type { BlueprintRoleDef, DepartmentTypeDef } from "@purnit/manifest-schema";
import { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import { SupabaseAdminService } from "./supabase-admin.service";
import { generateUniqueWorkspaceId } from "./workspace-id";
import { materializeBlueprintRoles, materializeDepartmentTypeLabels } from "./materialize-roles";
import type { SignupInput } from "./signup.schema";
import { resolvePlanSelection } from "./resolve-plan-selection";
import { DEFAULT_DASHBOARD_WIDGET_KEYS, autoLayout } from "../modules/analytics/dashboard-defaults";


@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  async signup(input: SignupInput) {
    const blueprint = await this.tenantPrisma.root.blueprint.findFirst({
      where: { industry: input.industry },
      orderBy: { version: "desc" },
    });
    if (!blueprint) {
      throw new BadRequestException(`No blueprint seeded for industry "${input.industry}"`);
    }
    const blueprintDef = blueprint.definition as unknown as { roles: BlueprintRoleDef[]; departmentTypes: DepartmentTypeDef[] };
    const blueprintRoles = blueprintDef.roles;
    const adminRoleDef = blueprintRoles.find((r) => r.id === "role.admin");
    if (!adminRoleDef) {
      throw new Error(`Blueprint "${input.industry}@${blueprint.version}" has no role.admin`);
    }

    // Stripe Billing — every new tenant starts on the seeded Free plan,
    // making the entitlement pipeline actually fire for real (previously
    // `planId` was written nowhere, ever, so entitlement filtering was a
    // permanent no-op for every tenant). A missing Free plan row falls back
    // to `null` (today's "no plan = everything entitled" behavior) rather
    // than blocking signup — a reseed always recreates it, so this should
    // never actually happen, but signup must never hard-fail on it.
    const freePlan = await this.tenantPrisma.root.plan.findFirst({ where: { key: "free" } });

    // Go-Live, Phase 03 — the plan chosen in the signup wizard. Looked up
    // here, decided in `resolvePlanSelection` (a pure function, so the
    // "never trust what a public endpoint was sent" rules it enforces are
    // directly testable). A `planKey` that isn't a real, public, self-serve
    // tier resolves to Free rather than erroring.
    const requestedPlan =
      input.planKey && input.planKey !== "free"
        ? await this.tenantPrisma.root.plan.findUnique({ where: { key: input.planKey }, include: { prices: true } })
        : null;
    const selection = resolvePlanSelection(input, freePlan, requestedPlan);

    const authUser = await this.supabaseAdmin.createUser(input.email, input.password);
    const workspaceId = await generateUniqueWorkspaceId(this.tenantPrisma, input.companyName);

    try {
      return await this.tenantPrisma.client.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: input.companyName,
            workspaceId,
            industry: input.industry,
            blueprintVersion: blueprint.version,
            planId: selection.planId,
            status: "active",
            // Go-Live, Phase 03 — the chosen shape, recorded up front so the
            // workspace is immediately consistent with what the wizard
            // quoted. `subscriptionStatus` is deliberately NOT "active" for
            // a paid selection: nothing has been paid yet, and only the
            // signed Stripe webhook is ever trusted to write that.
            seatsPurchased: selection.seats,
            billingInterval: selection.interval,
            subscriptionStatus: selection.subscriptionStatus,
          },
        });

        await tx.$executeRawUnsafe("SELECT set_config('app.tenant_id', $1, true)", tenant.id);

        const rolesByBlueprintId = await materializeBlueprintRoles(tx, tenant.id, blueprintRoles);
        await materializeDepartmentTypeLabels(tx, tenant.id, blueprintDef.departmentTypes ?? [], rolesByBlueprintId);
        const adminRole = rolesByBlueprintId.get("role.admin")!;

        // Analytics Phase D/E — one role-level DashboardLayout default per
        // in-scope role, seeded here rather than via seed.ts's static
        // blueprint JSON: DashboardLayout.roleId is a real, per-tenant
        // materialized Role.id (only known now, post-materializeBlueprintRoles),
        // never a blueprint-level id. A role not present in this blueprint
        // is simply skipped, not an error. One batched createMany, not N
        // sequential creates — materialize-roles.ts's own doc comment
        // records a real prior P2028 timeout from exactly that mistake
        // inside this same signup transaction.
        await tx.dashboardLayout.createMany({
          data: DEFAULT_DASHBOARD_WIDGET_KEYS.filter((e) => !e.industry || e.industry === input.industry).flatMap(({ blueprintRoleId, keys }) => {
            const role = rolesByBlueprintId.get(blueprintRoleId);
            return role ? [{ tenantId: tenant.id, roleId: role.id, dashboardKey: "analytics", widgets: autoLayout(keys) }] : [];
          }),
        });

        const user = await tx.user.create({
          data: {
            tenantId: tenant.id,
            authUserId: authUser.id,
            email: input.email,
            displayName: input.displayName,
          },
        });

        await tx.roleAssignment.create({
          data: { tenantId: tenant.id, userId: user.id, roleId: adminRole.id },
        });

        await tx.tenantConfig.create({
          data: {
            tenantId: tenant.id,
            version: 1,
            blueprintRef: `${input.industry.toLowerCase()}@${blueprint.version}`,
            overrides: {},
            isActive: true,
          },
        });

        return {
          tenantId: tenant.id,
          userId: user.id,
          workspaceId: tenant.workspaceId,
          // Go-Live, Phase 03 — what the wizard should do next. Returned
          // rather than inferred client-side so the browser never has to
          // reason about whether Stripe is configured or whether the plan it
          // asked for was actually honoured.
          plan: selection.planKey,
          billingInterval: selection.interval,
          seats: selection.seats,
          /** True only for a paid plan on a Stripe-configured deployment.
           * The wizard sends the user to Checkout when this is set, and
           * straight into the workspace when it isn't. */
          checkoutRequired: selection.checkoutRequired,
        };
      });
    } catch (err) {
      // Signup must be all-or-nothing across Supabase Auth + our Postgres.
      // If this cleanup itself fails, the Supabase Auth user survives with
      // no matching tenant/user row anywhere — Supabase's global email
      // uniqueness then silently blocks that email from ever signing up
      // again, with nothing in our own data to explain why. Logged (not
      // swallowed) so that failure mode is at least visible instead of
      // surfacing later as an unexplained "email already registered."
      await this.supabaseAdmin.deleteUser(authUser.id).catch((cleanupErr) => {
        this.logger.error(
          `Signup for "${input.email}" failed and rollback of its Supabase Auth user (${authUser.id}) also failed — ` +
            `this email is now orphaned and will block future signups until that auth user is deleted manually: ` +
            `${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`,
        );
      });
      throw err;
    }
  }

  /**
   * Pre-flight login check, called before the frontend ever attempts
   * `supabase.auth.signInWithPassword` — confirms `email` genuinely belongs
   * to the tenant identified by `workspaceId`. Deliberately does not
   * distinguish "no such workspace" from "right workspace, wrong email" in
   * its failure — a single generic rejection avoids letting this endpoint
   * be used to enumerate valid workspace IDs or emails. This does not
   * change how `tenant_id` ends up in the JWT (still derived purely from
   * `auth_user_id` by the custom-access-token-hook, unchanged) — it's a
   * confirmation layer in front of login, not a new identity model.
   *
   * `Tenant` has no RLS (a platform-root table, no `tenant_id` column —
   * `.root` is correct there), but `User` DOES have RLS requiring
   * `app.tenant_id` to be set (see `tenant_isolation` policy on `users`,
   * migration `20260714145938_rls_and_app_role`). Querying it via `.root`
   * with no tenant context set would silently match zero rows *always* —
   * caught live during verification, not by inspection. `tenantPrisma.run`
   * is required here, not `.root`.
   */
  async verifyWorkspace(workspaceId: string, email: string): Promise<void> {
    const tenant = await this.tenantPrisma.root.tenant.findUnique({ where: { workspaceId } });
    const user = tenant
      ? await this.tenantPrisma.run(tenant.id, (tx) => tx.user.findFirst({ where: { tenantId: tenant.id, email, deletedAt: null } }))
      : null;
    if (!tenant || !user) {
      throw new UnauthorizedException("That email isn't part of this workspace");
    }
  }

  /**
   * Bookkeeping only — clears `User.mustChangePassword`. The actual
   * credential change already happened via `supabase.auth.updateUser(...)`
   * on the client before this is ever called; Supabase Auth is the sole
   * holder of the real password, our DB only tracks whether the mandatory
   * first-login flow has been completed. See CONTEXT.md onboarding section
   * for why this is an acceptable non-cryptographic gate: the caller
   * already owns the account, so self-clearing this flag isn't a privilege
   * escalation, only a (self-defeating, if skipped) UX shortcut.
   */
  async completeFirstLogin(tenantId: string, userId: string): Promise<void> {
    await this.tenantPrisma.run(tenantId, (tx) => tx.user.update({ where: { id: userId }, data: { mustChangePassword: false } }));
  }
}
