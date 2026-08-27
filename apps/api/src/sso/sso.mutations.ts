import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition } from "../mutations/mutation-registry.service";
import { logAudit } from "../audit/log-audit";

const ConfigureInputSchema = z.object({
  enabled: z.boolean(),
  displayName: z.string().trim().min(1).max(100).optional(),
  defaultRoleId: z.string().optional(),
  requireEmailVerified: z.boolean().optional(),
});

/**
 * Admin-only Enterprise SSO config write. `idpAlias` is system-generated
 * ("idp-<tenantId>") the first time this is called for a tenant and never
 * regenerated on update — see sso.prisma's own doc comment on why an
 * admin-typed alias would be a real cross-tenant confusion risk (Identity
 * Brokering aliases live in one shared Keycloak realm and are globally
 * reachable via ?kc_idp_hint=<alias>). Fields left undefined in `input`
 * (Prisma's own semantics, not custom logic here) leave the existing value
 * untouched on update — e.g. toggling `enabled` alone doesn't require
 * resending `displayName`/`defaultRoleId`.
 */
export const ssoConfigureMutation: MutationDefinition<z.infer<typeof ConfigureInputSchema>> = {
  name: "sso.configure",
  inputSchema: ConfigureInputSchema,
  requiredPermission: "sso:manage",
  async resolve(input, ctx, tx) {
    if (input.defaultRoleId) {
      const role = await tx.role.findFirst({ where: { id: input.defaultRoleId, tenantId: ctx.tenantId } });
      if (!role) throw new BadRequestException(`No role "${input.defaultRoleId}" in this tenant`);
    }

    const existing = await tx.ssoConfig.findUnique({ where: { tenantId: ctx.tenantId } });
    const idpAlias = existing?.idpAlias ?? `idp-${ctx.tenantId}`;

    const config = await tx.ssoConfig.upsert({
      where: { tenantId: ctx.tenantId },
      create: {
        tenantId: ctx.tenantId,
        enabled: input.enabled,
        idpAlias,
        displayName: input.displayName,
        defaultRoleId: input.defaultRoleId,
        requireEmailVerified: input.requireEmailVerified ?? true,
      },
      update: {
        enabled: input.enabled,
        displayName: input.displayName,
        defaultRoleId: input.defaultRoleId,
        requireEmailVerified: input.requireEmailVerified,
      },
    });

    // Enterprise SSO config is exactly the class of security-adjacent
    // change logAudit exists for — same treatment as user.invite/role changes.
    await logAudit(tx, ctx, {
      action: "sso.configure",
      resource: "ssoConfig",
      resourceId: config.id,
      before: existing ? { enabled: existing.enabled, defaultRoleId: existing.defaultRoleId } : undefined,
      after: { enabled: config.enabled, defaultRoleId: config.defaultRoleId },
    });

    return config;
  },
};
