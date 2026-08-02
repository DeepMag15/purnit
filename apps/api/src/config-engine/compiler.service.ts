import { Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  MANIFEST_SCHEMA_VERSION,
  WorkspaceManifestSchema,
  UINodeSchema,
  type BlueprintDefinition,
  type TenantConfigOverrides,
  type UINode,
  type WorkspaceManifest,
} from "@antigravity/manifest-schema";
import { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import { PermissionResolverService } from "../rbac/permission-resolver.service";
import { AiProviderService } from "../ai/provider/ai-provider.service";
import type { EffectivePermissions } from "../rbac/permission-collapse";
import { applyOverrides } from "./override-applier";
import { filterByEntitlements } from "./entitlement-filter";
import { pruneByPermissions } from "./permission-pruner";
import type { Tenant, TenantConfig } from "../generated/prisma/client";

export interface CompilerUser {
  id: string;
  displayName: string;
}

export interface WorkspaceIdentity {
  tenant: Tenant;
  tenantConfigRow: TenantConfig | null;
  effective: EffectivePermissions;
  etag: string;
  user: CompilerUser;
}

@Injectable()
export class ConfigEngineService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  /**
   * The cheap half of the pipeline: tenant + active tenant-config row +
   * resolved permissions — everything the `etag` (ARCHITECTURE.md §6.7:
   * `hash(tenantConfigVersion, blueprintVersion, permissionsHash)`) depends
   * on, without touching blueprint JSON or doing any pruning. Callers use
   * this to answer `If-None-Match` with a 304 before paying for the
   * expensive half (`resolvePrunedBlueprint`) at all.
   *
   * `blueprintVersion` alone is NOT enough to detect blueprint changes — it's
   * a version *number* (e.g. "1"), not a content hash, and Phase 1's normal
   * workflow (fixing `prisma/seed.ts` and re-running it) edits an existing
   * version's content in place rather than publishing a new version number.
   * A real bug shipped because of this: the etag stayed identical across
   * three separate blueprint content fixes (Stages 7/8/9), so browsers kept
   * serving a `304`-cached, stale page — in one case, a page from *before* an
   * action even existed in the blueprint. Fixed by including the blueprint
   * row's `updatedAt` (bumped automatically by `@updatedAt` on every content
   * edit) in the etag input. Selected alone, not the full `definition` JSON,
   * to keep this half of the pipeline cheap.
   *
   * Same fix applied to `Tenant.updatedAt`: the Settings module (Phase 2)
   * made `Tenant.branding` genuinely mutable post-creation for the first
   * time — caught live, the exact same staleness bug recurred (an accent
   * color change didn't change the etag, so a browser would keep serving
   * the old color via 304). `tenant` is already fetched above for
   * `blueprintVersion`, so this is free — no extra query.
   */
  private async resolveIdentity(tenantId: string, user: CompilerUser): Promise<WorkspaceIdentity> {
    const tenant = await this.tenantPrisma.root.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException(`No tenant "${tenantId}"`);

    // Performance-audit consolidation (CONTEXT.md §47): the tenant-config
    // lookup and the permission resolution used to be two separate `.run()`
    // transactions — each its own ~600ms BEGIN/set_config/COMMIT round-trip
    // against the real remote DB. Now one transaction, two sequential
    // awaits sharing it — same queries, same result, run alongside the
    // (already-parallel, root-client, no-transaction) blueprint-meta lookup.
    const [identityFromTx, blueprintMeta] = await Promise.all([
      this.tenantPrisma.run(tenantId, async (tx) => {
        const tenantConfigRow = await tx.tenantConfig.findFirst({ where: { tenantId, isActive: true } });
        const effective = await this.permissionResolver.resolveEffectivePermissionsWithTx(tx, tenantId, user.id);
        return { tenantConfigRow, effective };
      }),
      this.tenantPrisma.root.blueprint.findUnique({
        where: { industry_version: { industry: tenant.industry, version: tenant.blueprintVersion } },
        select: { updatedAt: true },
      }),
    ]);
    const { tenantConfigRow, effective } = identityFromTx;

    const etag = createHash("sha256")
      .update(
        `${tenant.blueprintVersion}:${blueprintMeta?.updatedAt.getTime() ?? 0}:${tenantConfigRow?.version ?? 0}:${tenant.updatedAt.getTime()}:${effective.permissionsHash}`,
      )
      .digest("hex")
      .slice(0, 32);

    return { tenant, tenantConfigRow, effective, etag, user };
  }

  /**
   * Blueprint (L1) -> Tenant Config overrides (L2) -> Entitlements (L3), per
   * ARCHITECTURE.md §6.4 — everything before Layer 4's permission pruning.
   * Deliberately stops here, not at a pruned result: both real callers below
   * only ever need *one* page pruned (performance pass 2, CONTEXT.md §48),
   * and `compileWorkspace` needs this unpruned form first anyway, to read
   * `dashboards.default` before it knows which page that even is.
   *
   * `attachDataSourceRefs` from the architecture's pipeline is elided: our
   * blueprint bindings already reference data-source names directly
   * (`bind: { source: "projects.list" }`), so there's nothing to attach at
   * compile time — resolving/authorizing what a source name means happens at
   * fetch time (`POST /api/data/:source`, stubbed this stage, real in Stage 8).
   */
  private async resolveEntitledBlueprint(identity: WorkspaceIdentity): Promise<BlueprintDefinition> {
    const { tenant, tenantConfigRow } = identity;

    const blueprintRow = await this.tenantPrisma.root.blueprint.findUnique({
      where: { industry_version: { industry: tenant.industry, version: tenant.blueprintVersion } },
    });
    if (!blueprintRow) {
      throw new NotFoundException(`No blueprint for ${tenant.industry}@${tenant.blueprintVersion}`);
    }
    const blueprint = blueprintRow.definition as unknown as BlueprintDefinition;

    const overrides = (tenantConfigRow?.overrides as unknown as TenantConfigOverrides) ?? {};
    const resolved = applyOverrides(blueprint, overrides);

    const entitledModules = tenant.planId
      ? ((await this.tenantPrisma.root.plan.findUnique({ where: { id: tenant.planId } }))
          ?.entitlements as string[] | undefined) ?? null
      : null;
    return filterByEntitlements(resolved, entitledModules);
  }

  /**
   * The one identity resolution per request. Performance-audit
   * consolidation (CONTEXT.md §47): `WorkspaceController` used to call
   * `getEtag()` for its cheap pre-check, then — on a cache-miss —
   * `compileWorkspace`/`compilePage` internally called `resolveIdentity`
   * *again*, redoing the same transactions and queries. Callers now resolve
   * identity once, check the etag themselves, and pass the same
   * `WorkspaceIdentity` into `compileWorkspace`/`compilePage` on a miss.
   */
  async getIdentity(tenantId: string, user: CompilerUser): Promise<WorkspaceIdentity> {
    return this.resolveIdentity(tenantId, user);
  }

  /** `GET /api/workspace/bootstrap` — full manifest: nav, default dashboard page, etc. */
  async compileWorkspace(identity: WorkspaceIdentity): Promise<WorkspaceManifest> {
    const { tenant, effective, etag, user } = identity;
    const tenantId = tenant.id;
    const entitled = await this.resolveEntitledBlueprint(identity);
    // Performance pass 2 (CONTEXT.md §48): only the one page this request
    // actually needs (the default dashboard) gets pruned — `dashboards`
    // itself passes through pruning untouched, so it's safe to read before
    // pruning even runs.
    const defaultPageId = entitled.dashboards.default;
    const pruned = pruneByPermissions(entitled, effective, defaultPageId);

    // Performance-audit consolidation (CONTEXT.md §47): these were two
    // separate `.run()` transactions — now one, two sequential awaits.
    const { roleLabels, flagRows } = await this.tenantPrisma.run(tenantId, async (tx) => {
      const assignments = await tx.roleAssignment.findMany({ where: { userId: user.id }, include: { role: true } });
      const flagRows = await tx.featureFlag.findMany({ where: { tenantId } });
      return { roleLabels: [...new Set(assignments.map((r) => r.role.label))], flagRows };
    });
    const featureFlags = Object.fromEntries(flagRows.map((f) => [f.key, f.enabled]));

    const page = pruned.pages[defaultPageId];
    if (!page) throw new Error(`Default dashboard page "${defaultPageId}" not found after pruning`);

    const manifest: WorkspaceManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        workspaceId: tenant.workspaceId,
        industry: tenant.industry,
        branding: tenant.branding as Record<string, unknown>,
        profile: tenant.profile as Record<string, unknown>,
      },
      user: { id: user.id, displayName: user.displayName, roles: roleLabels, permissionsHash: effective.permissionsHash },
      navigation: pruned.navigation,
      page,
      featureFlags,
      aiAvailable: AiProviderService.isConfigured(),
      meta: { compiledAt: new Date().toISOString(), etag },
    };

    // The one runtime guarantee this stage adds: every compiled manifest is
    // validated against the shared contract before it ever leaves this
    // service. A malformed manifest fails loudly here, not silently at a
    // client that has no way to know what shape to expect.
    return WorkspaceManifestSchema.parse(manifest);
  }

  /**
   * `GET /api/workspace/pages/:pageId` — a single page's tree, lazily fetched
   * on navigation. Returns `null` if the page doesn't exist *or* was pruned
   * away for this user — the caller 404s either way. Never distinguishing
   * "doesn't exist" from "you can't see it" is the same prune-not-hide
   * invariant as the manifest itself, applied to direct page fetches too.
   */
  async compilePage(identity: WorkspaceIdentity, pageId: string): Promise<{ page: UINode; etag: string } | null> {
    const entitled = await this.resolveEntitledBlueprint(identity);
    const pruned = pruneByPermissions(entitled, identity.effective, pageId);
    const page = pruned.pages[pageId];
    if (!page) return null;
    return { page: UINodeSchema.parse(page), etag: identity.etag };
  }
}
