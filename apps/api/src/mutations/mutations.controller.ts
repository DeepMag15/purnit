import { Body, Controller, ForbiddenException, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../tenancy/jwt-auth.guard";
import { CurrentUserService } from "../tenancy/current-user.service";
import { assertPasswordChanged } from "../tenancy/assert-password-changed";
import { TenantContextService } from "../tenancy/tenant-context.service";
import { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import { PermissionResolverService } from "../rbac/permission-resolver.service";
import { MutationRegistry, type MutationContext } from "./mutation-registry.service";

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
    const input = def.inputSchema.parse(body ?? {});

    // Originally built for Meetings' Daily.co room creation (now unused —
    // self-hosted Jitsi, its replacement, has no equivalent step) — kept as
    // general infrastructure. See the note on MutationDefinition.preResolve.
    // Runs (and, on failure, rolls back) outside the DB transaction entirely.
    const pre = await def.preResolve?.(input, { tenantId, authUserId });
    try {
      return await this.tenantPrisma.run(tenantId, async (tx) => {
        const user = await this.currentUser.getWithTx(tx, tenantId, authUserId);
        assertPasswordChanged(user);
        const effective = await this.permissionResolver.resolveEffectivePermissionsWithTx(tx, tenantId, user.id);

        if (def.requiredPermission) {
          const [resource, action] = def.requiredPermission.split(":");
          if (effective.has(resource!, action!) === null) {
            throw new ForbiddenException(`Missing permission "${def.requiredPermission}"`);
          }
        }

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
