import type { TenantConfigOverrides } from "@purnit/manifest-schema";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

/**
 * A tenant's own AI completion-provider override, if one is set — read
 * directly, deliberately bypassing `compiler.service.ts`'s full
 * `resolveIdentity`/`applyOverrides`/etag machinery entirely. That pipeline
 * exists to compile a *blueprint* (nav/pages/roles) for the frontend
 * manifest; `ai.provider` never needs to reach the manifest or affect the
 * etag — it's an internal backend routing decision read fresh per AI call,
 * from both `aiMessage.send` and `aiToolCall.reply`'s own `preResolve`,
 * which only ever have a `tx` + `tenantId` in scope, not a full identity.
 */
export async function resolveTenantProviderOverride(tx: PrismaTx, tenantId: string): Promise<string | null> {
  const row = await tx.tenantConfig.findFirst({ where: { tenantId, isActive: true }, select: { overrides: true } });
  const overrides = row?.overrides as unknown as TenantConfigOverrides | undefined;
  return overrides?.ai?.provider ?? null;
}
