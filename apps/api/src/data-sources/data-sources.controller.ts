import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { z, ZodError } from "zod";
import { JwtAuthGuard } from "../tenancy/jwt-auth.guard";
import { CurrentUserService } from "../tenancy/current-user.service";
import { assertPasswordChanged } from "../tenancy/assert-password-changed";
import { TenantContextService } from "../tenancy/tenant-context.service";
import { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import { PermissionResolverService } from "../rbac/permission-resolver.service";
import { DataSourceRegistry, type DataSourceContext } from "./data-source-registry.service";

const BatchRequestSchema = z.object({
  requests: z.array(z.object({ source: z.string(), params: z.unknown().optional() })).max(20),
});

/** ⚠️ Pre-existing gap found and fixed during Calendar & Scheduling's own
 * live verification (unrelated to Calendar itself, same class as the
 * ERR_HTTP_HEADERS_SENT fix during Announcements' verification, CONTEXT.md
 * §54): every one of this controller's `.parse()` calls used to be bare, so
 * invalid input returned a raw 500 instead of a 400 — only auth.controller.ts
 * caught ZodError anywhere in the app. Shared here since this controller has
 * three call sites, unlike mutations.controller.ts's one. */
function parseOrBadRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException(err.issues);
    }
    throw err;
  }
}

@Controller("api/data")
@UseGuards(JwtAuthGuard)
export class DataSourcesController {
  constructor(
    private readonly registry: DataSourceRegistry,
    private readonly currentUser: CurrentUserService,
    private readonly tenantContext: TenantContextService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  /**
   * Performance pass 2 (CONTEXT.md §48): a page like `page.hr` needs several
   * data sources at once (`departments.list`, `teams.list`, `users.list`,
   * `departmentTypes.list`) — each via `/api/data/:source` is its own HTTP
   * round trip *and* its own transaction. This does the identical
   * lookup/permission-check/resolve per request, but as sequential awaits
   * inside **one** transaction (same consolidation pattern as the single-
   * source route below), and one HTTP response. A per-item failure (unknown
   * source, missing permission) returns `{ error }` for that item only —
   * it doesn't fail the whole batch, matching how a caller would experience
   * firing these individually today (one denied source doesn't block the
   * others). **Must be declared before `:source` below** — otherwise Nest's
   * router would match `POST /api/data/batch` as `:source = "batch"`.
   */
  @Post("batch")
  @HttpCode(200)
  async resolveBatch(@Body() body: unknown) {
    const { requests } = parseOrBadRequest(BatchRequestSchema, body);
    const { tenantId, authUserId } = this.tenantContext.getOrThrow();

    const results = await this.tenantPrisma.run(tenantId, async (tx) => {
      const user = await this.currentUser.getWithTx(tx, tenantId, authUserId);
      assertPasswordChanged(user);
      const effective = await this.permissionResolver.resolveEffectivePermissionsWithTx(tx, tenantId, user.id);

      const out: Array<{ data?: unknown; error?: string }> = [];
      for (const { source, params: rawParams } of requests) {
        const def = this.registry.get(source);
        if (!def) {
          out.push({ error: `Data source "${source}" is not registered` });
          continue;
        }
        if (def.requiredPermission) {
          const [resource, action] = def.requiredPermission.split(":");
          if (effective.has(resource!, action!) === null) {
            out.push({ error: `Missing permission "${def.requiredPermission}"` });
            continue;
          }
        }
        const params = parseOrBadRequest(def.paramsSchema, rawParams ?? {});
        const ctx: DataSourceContext = { tenantId, userId: user.id, userDepartmentId: user.departmentId, effective };
        out.push({ data: await def.resolve(params, ctx, tx) });
      }
      return out;
    });

    return { results };
  }

  @Post(":source")
  @HttpCode(200) // A data source is always a read — NestJS's @Post() default of 201 is wrong here.
  async resolve(@Param("source") source: string, @Body() body: unknown) {
    const def = this.registry.get(source);
    if (!def) {
      throw new NotFoundException(`Data source "${source}" is not registered`);
    }

    // Performance-audit consolidation (CONTEXT.md §47): this used to be 3
    // separate `.run()` transactions in a row (currentUser lookup, permission
    // resolution, the actual resolve) — each paying its own ~600ms
    // BEGIN/set_config/COMMIT round-trip tax against the real remote DB.
    // Same queries, same authorization logic, now sequential awaits sharing
    // one transaction instead.
    const { tenantId, authUserId } = this.tenantContext.getOrThrow();
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const user = await this.currentUser.getWithTx(tx, tenantId, authUserId);
      assertPasswordChanged(user);
      const effective = await this.permissionResolver.resolveEffectivePermissionsWithTx(tx, tenantId, user.id);

      if (def.requiredPermission) {
        const [resource, action] = def.requiredPermission.split(":");
        if (effective.has(resource!, action!) === null) {
          throw new ForbiddenException(`Missing permission "${def.requiredPermission}"`);
        }
      }

      const params = parseOrBadRequest(def.paramsSchema, body ?? {});
      const ctx: DataSourceContext = {
        tenantId,
        userId: user.id,
        userDepartmentId: user.departmentId,
        effective,
      };
      return def.resolve(params, ctx, tx);
    });
  }
}
