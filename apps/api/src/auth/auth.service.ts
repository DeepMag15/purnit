import { BadRequestException, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import type { BlueprintRoleDef, DepartmentTypeDef } from "@antigravity/manifest-schema";
import { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import { SupabaseAdminService } from "./supabase-admin.service";
import { generateUniqueWorkspaceId } from "./workspace-id";
import { materializeBlueprintRoles, materializeDepartmentTypeLabels } from "./materialize-roles";
import type { SignupInput } from "./signup.schema";
import type { WidgetLayoutEntry } from "../modules/analytics/dashboard-layout.types";

// Analytics Phase E — initial widget order per role's default dashboard.
// Purely a display preference — never grants visibility a role's real
// permissions wouldn't already permit; a widget a role can't see is simply
// absent from analytics.dashboard's response regardless of where this list
// would have placed it. Deliberately NOT exhaustive (18+ real widgets exist
// across every module by this phase) — just each role's own "headline"
// scalar metrics, prioritized first; every other permitted widget the list
// doesn't name is auto-appended by autoLayout below (or, client-side, by
// AnalyticsDashboard.tsx's own identical fallback for any widget key absent
// from a *saved* layout — same "graceful, never an error" principle).
// Company Admin/Executive/HR Manager lead with the two Phase D leaderboards
// (the permission-controlled widgets they hold by default); everyone else
// leads with the metrics most of their day-to-day work lives in.
// Phase F (Cross-Module Composites + Executive Attention) — prepended the
// 4 new executive-attention widget keys to the roles where they're actually
// relevant, so a freshly-provisioned tenant's default layout puts them near
// the top. Existing tenants are unaffected — no backfill, same Phase D/E
// precedent ("a missing/stale template is a low-stakes cosmetic fallback,
// not worth a migration for"). Pure ordering nicety, not an authorization
// mechanism — a role whose list doesn't name a key still sees that widget
// (auto-appended by AnalyticsDashboard.tsx's mergeLayout) if their own real
// permissions grant it; not listing a key here only means it isn't
// front-and-center by default.
const DEFAULT_DASHBOARD_WIDGET_KEYS: { blueprintRoleId: string; keys: string[] }[] = [
  {
    blueprintRoleId: "role.admin",
    keys: [
      "projects.atRisk",
      "tasks.overloadedEmployees",
      "employeeProductivityScore",
      "documents.pendingApprovals",
      "department.performanceLeaderboard",
      "tasks.productivityLeaderboard",
      "ai.usageSummary",
      "tasks.openCount",
      "tasks.completionRate",
      "attendance.rateThisMonth",
      "projects.activeCount",
      "meetings.heldThisWeek",
    ],
  },
  {
    blueprintRoleId: "role.executive",
    keys: [
      "projects.atRisk",
      "employeeProductivityScore",
      "department.performanceLeaderboard",
      "tasks.productivityLeaderboard",
      "projects.activeCount",
      "tasks.completionRate",
      "attendance.rateThisMonth",
      "meetings.heldThisWeek",
    ],
  },
  {
    blueprintRoleId: "role.hr-manager",
    keys: ["employeeProductivityScore", "department.performanceLeaderboard", "tasks.productivityLeaderboard", "attendance.rateThisMonth", "tasks.openCount", "meetings.heldThisWeek"],
  },
  { blueprintRoleId: "role.department-head", keys: ["tasks.openCount", "tasks.completionRate", "attendance.rateThisMonth", "projects.activeCount", "meetings.heldThisWeek"] },
  { blueprintRoleId: "role.project-manager", keys: ["projects.atRisk", "tasks.openCount", "projects.activeCount", "meetings.heldThisWeek", "attendance.rateThisMonth"] },
  { blueprintRoleId: "role.member", keys: ["tasks.openCount", "attendance.rateThisMonth", "meetings.heldThisWeek"] },
  // Healthcare Domain, Phase C. role.admin (Hospital Administrator) shares
  // the entry above across industries — untouched here; the 5 new metrics
  // still auto-append below it for a Healthcare admin (see
  // AnalyticsDashboard.tsx's mergeLayout), just not specially curated.
  {
    blueprintRoleId: "role.doctor",
    keys: ["patients.totalCount", "appointments.todayCount", "patients.statusBreakdown", "tasks.openCount", "attendance.rateThisMonth"],
  },
  {
    blueprintRoleId: "role.nurse",
    keys: ["appointments.todayCount", "patients.totalCount", "patients.statusBreakdown", "tasks.openCount", "attendance.rateThisMonth"],
  },
  {
    blueprintRoleId: "role.receptionist",
    keys: ["appointments.todayCount", "patients.totalCount", "appointments.completedCount", "doctors.activeCount"],
  },
];

/** A simple flowing 12-column grid — 2 widgets per row, `w: 6, h: 4` each.
 * The same small algorithm AnalyticsDashboard.tsx independently implements
 * for its own "no saved layout" client-side fallback — not extracted into a
 * shared package for one small function, deliberately duplicated cheaply on
 * both sides of the runtime boundary. */
function autoLayout(keys: string[]): WidgetLayoutEntry[] {
  return keys.map((key, i) => ({ key, visible: true, x: (i % 2) * 6, y: Math.floor(i / 2) * 4, w: 6, h: 4 }));
}

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
            status: "active",
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
          data: DEFAULT_DASHBOARD_WIDGET_KEYS.flatMap(({ blueprintRoleId, keys }) => {
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

        return { tenantId: tenant.id, userId: user.id, workspaceId: tenant.workspaceId };
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
