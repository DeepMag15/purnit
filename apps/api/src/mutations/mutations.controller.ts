import { BadRequestException, Body, Controller, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";
import { JwtAuthGuard } from "../tenancy/jwt-auth.guard";
import { CurrentUserService } from "../tenancy/current-user.service";
import { assertPasswordChanged } from "../tenancy/assert-password-changed";
import { TenantContextService } from "../tenancy/tenant-context.service";
import { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import { PermissionResolverService } from "../rbac/permission-resolver.service";
import { MutationRegistry, checkRequiredPermission, type MutationContext } from "./mutation-registry.service";

@Controller("api/mutations")
@UseGuards(JwtAuthGuard)
export class MutationsController {
  constructor(
    private readonly registry: MutationRegistry,
    private readonly currentUser: CurrentUserService,
    private readonly tenantContext: TenantContextService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  @Post(":mutation")
  async resolve(@Param("mutation") mutation: string, @Body() body: unknown) {
    const def = this.registry.get(mutation);
    if (!def) {
      throw new NotFoundException(`Mutation "${mutation}" is not registered`);
    }

    // Performance-audit consolidation (CONTEXT.md §47) — see the matching
    // comment in DataSourcesController; identical shape, same reasoning.
    // Mutations that also do external I/O inside their own `def.resolve()`
    // (e.g. `user.invite`'s Resend call) are unaffected — this only removes
    // the two *extra* transactions that used to run before it.
    const { tenantId, authUserId } = this.tenantContext.getOrThrow();

    // Parsing never touches `tx` — safe to do before preResolve/the transaction.
    // ⚠️ Pre-existing gap found and fixed during Calendar & Scheduling's own
    // live verification (unrelated to Calendar itself, same class as the
    // ERR_HTTP_HEADERS_SENT fix during Announcements' verification,
    // CONTEXT.md §54): this used to be a bare `.parse()` call, so EVERY
    // mutation across the whole app returned a raw 500 on invalid input
    // instead of a 400 — only auth.controller.ts caught ZodError. Mirrors
    // that controller's exact catch/rethrow shape.
    let input;
    try {
      input = def.inputSchema.parse(body ?? {});
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.issues);
      }
      throw err;
    }

    // ⚠️ `preResolve` runs outside the transaction below, and therefore
    // *before* the `checkRequiredPermission` inside it. That ordering was
    // harmless when this hook was unused, but 10 mutations declare one today
    // and every one does real external work there: the billing set changes
    // Stripe subscriptions and mints billing-portal sessions,
    // `tenant.closeWorkspace` cancels the subscription, the AI set calls the
    // provider. Without this pre-flight an authenticated user holding none of
    // those permissions reaches all of it.
    //
    // Found by Stage E's write sweep, not by reading: an Education Teacher
    // (22 permissions, no `billing:manage`) got `billing.cancelSubscription`
    // as far as "No active subscription" — the guard *inside* preResolve, one
    // line above a live `stripe.cancelSubscriptionAtPeriodEnd` call. Nothing
    // fired only because Stripe is unconfigured in local dev; in production
    // any signed-in user could have cancelled their company's subscription.
    //
    // Authorize first, in its own short transaction. This runs only for the
    // mutations that actually declare `preResolve`, so the single-transaction
    // consolidation (CONTEXT.md §47) still holds for the other 124. The
    // check inside the main transaction stays as the authoritative one.
    if (def.preResolve) {
      await this.tenantPrisma.run(tenantId, async (tx) => {
        const user = await this.currentUser.getWithTx(tx, tenantId, authUserId);
        assertPasswordChanged(user);
        const effective = await this.permissionResolver.resolveEffectivePermissionsWithTx(tx, tenantId, user.id);
        checkRequiredPermission(def, effective);
      });
    }

    // Runs (and, on failure, rolls back) outside the DB transaction entirely.
    // See the note on MutationDefinition.preResolve.
    const pre = await def.preResolve?.(input, { tenantId, authUserId });
    try {
      return await this.tenantPrisma.run(tenantId, async (tx) => {
        const user = await this.currentUser.getWithTx(tx, tenantId, authUserId);
        assertPasswordChanged(user);
        const effective = await this.permissionResolver.resolveEffectivePermissionsWithTx(tx, tenantId, user.id);

        checkRequiredPermission(def, effective);

        const ctx: MutationContext = {
          tenantId,
          userId: user.id,
          userDepartmentId: user.departmentId,
          effective,
        };
        return def.resolve(input, ctx, tx, pre);
      });
    } catch (err) {
      if (def.rollbackPreResolve) {
        await def.rollbackPreResolve(pre).catch((rollbackErr) => {
          console.error(`rollbackPreResolve failed for mutation "${mutation}":`, rollbackErr);
        });
      }
      throw err;
    }
  }
}
