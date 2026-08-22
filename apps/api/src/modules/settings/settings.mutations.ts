import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { z } from "zod";
import type { TenantConfigOverrides } from "@purnit/manifest-schema";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import type { TenantPrismaService } from "../../tenancy/tenant-prisma.service";
import type { SupabaseAdminService } from "../../auth/supabase-admin.service";
import { slugify } from "../../auth/workspace-id";
import { logAudit } from "../../audit/log-audit";

/** Merges a single nav item's label into `overrides.navigation.patch`,
 * preserving every other item's existing patch and any existing
 * `remove`/`add` entries untouched. Pure and exported so the branching is
 * unit-testable directly — same convention as `projectsWhere`/
 * `notificationRecipientFor` rather than only exercising this through a
 * mocked Prisma transaction. */
export function mergeNavigationLabelPatch(
  overrides: TenantConfigOverrides,
  itemId: string,
  label: string,
): TenantConfigOverrides {
  const navigation = overrides.navigation ?? {};
  return {
    ...overrides,
    navigation: {
      ...navigation,
      patch: {
        ...navigation.patch,
        [itemId]: { ...navigation.patch?.[itemId], label },
      },
    },
  };
}

const UpdateBrandingInputSchema = z.object({
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i, "Must be a 6-digit hex color"),
  // Set once a logo upload completes (see createCreateLogoUploadUrlMutation
  // below) — the upload flow itself never calls this codebase's own API
  // with the file's bytes; it only persists the resulting public URL here,
  // the same way accentColor is persisted.
  logoUrl: z.string().url().optional(),
});

/** A factory, not a plain exported constant — `branding` lives on `Tenant`,
 * a platform-root table with no `tenant_id` column, so it isn't reachable
 * via the tenant-scoped `tx` a plain `resolve(input, ctx, tx)` receives.
 * Needs `TenantPrismaService.root` instead (same reasoning as
 * `AuthService.signup`'s `root.tenant.create`). Same factory pattern as
 * `createUserInviteMutation` in `users.mutations.ts` — built once by the
 * registrar with its own injected instance. */
export function createUpdateBrandingMutation(tenantPrisma: TenantPrismaService): MutationDefinition<z.infer<typeof UpdateBrandingInputSchema>> {
  return {
    name: "tenant.updateBranding",
    inputSchema: UpdateBrandingInputSchema,
    requiredPermission: "settings:manage",
    async resolve(input, ctx, tx) {
      const tenant = await tenantPrisma.root.tenant.findUnique({ where: { id: ctx.tenantId } });
      if (!tenant) throw new BadRequestException(`No tenant "${ctx.tenantId}"`);

      const branding = {
        ...(tenant.branding as Record<string, unknown>),
        accentColor: input.accentColor,
        // Only overwritten when actually provided — a plain accentColor-only
        // save (the common case) must never clobber an existing logoUrl.
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      };
      const updated = await tenantPrisma.root.tenant.update({ where: { id: ctx.tenantId }, data: { branding } });

      // Audit Logs (module 6 of 6) — `tx` here is the caller's ordinary
      // tenant-scoped transaction (same one every other mutation gets); it's
      // just unused by this resolver's own Tenant-row logic since `Tenant`
      // is a root table, unreachable via `tx` (see this mutation's own doc
      // comment above). `AuditLog` isn't a root table, so it's reachable
      // through `tx` exactly as normal.
      await logAudit(tx, ctx, { action: "tenant.updateBranding", resource: "tenant", resourceId: ctx.tenantId, before: tenant.branding, after: branding });

      return updated;
    },
  };
}

const UpdateWorkspaceIdInputSchema = z.object({ workspaceId: z.string().min(1) });

// Same factory reasoning as createUpdateBrandingMutation — workspaceId
// lives on `Tenant`, a root table, unreachable via the tenant-scoped `tx`.
//
// Slugifies the input server-side (same `slugify()` used at signup) rather
// than strictly validating-and-rejecting a raw format. An earlier version
// required the raw input to already be lowercase-kebab-case and rejected
// anything else with a 400 — a real, reported UX bug: typing anything with
// a capital letter or a space (exactly what a human would naturally type)
// silently failed with an easy-to-miss inline error, which looked from the
// outside like "the field isn't editable" or "changes aren't saving."
// Normalizing whatever was typed into a valid slug, the same way signup
// already does, means there is no format a user can type that fails.
export function createUpdateWorkspaceIdMutation(tenantPrisma: TenantPrismaService): MutationDefinition<z.infer<typeof UpdateWorkspaceIdInputSchema>> {
  return {
    name: "tenant.updateWorkspaceId",
    inputSchema: UpdateWorkspaceIdInputSchema,
    requiredPermission: "settings:manage",
    async resolve(input, ctx, tx) {
      const workspaceId = slugify(input.workspaceId);
      if (!workspaceId) throw new BadRequestException("Workspace ID can't be blank");

      const existing = await tenantPrisma.root.tenant.findUnique({ where: { workspaceId } });
      if (existing && existing.id !== ctx.tenantId) {
        throw new ConflictException(`Workspace ID "${workspaceId}" is already taken`);
      }

      const current = await tenantPrisma.root.tenant.findUnique({ where: { id: ctx.tenantId } });
      const updated = await tenantPrisma.root.tenant.update({ where: { id: ctx.tenantId }, data: { workspaceId } });

      await logAudit(tx, ctx, {
        action: "tenant.updateWorkspaceId",
        resource: "tenant",
        resourceId: ctx.tenantId,
        before: { workspaceId: current?.workspaceId ?? null },
        after: { workspaceId },
      });

      return updated;
    },
  };
}

const UpdateNavigationLabelInputSchema = z.object({
  itemId: z.string(),
  label: z.string().min(1),
});

// Plain constant, not a factory — TenantConfig is tenant-scoped and already
// reachable via `tx`, no injected service needed.
export const updateNavigationLabelMutation: MutationDefinition<z.infer<typeof UpdateNavigationLabelInputSchema>> = {
  name: "workspaceConfig.updateNavigationLabel",
  inputSchema: UpdateNavigationLabelInputSchema,
  requiredPermission: "settings:manage",
  async resolve(input, ctx, tx) {
    const current = await tx.tenantConfig.findFirst({ where: { tenantId: ctx.tenantId, isActive: true } });
    if (!current) throw new BadRequestException("No active tenant config to update");

    const merged = mergeNavigationLabelPatch(current.overrides as unknown as TenantConfigOverrides, input.itemId, input.label);

    // Invariant (see CONTEXT.md's Workspace-delivery-API note): a new
    // version is always inserted, the active row is never mutated in
    // place — the etag already hashes `TenantConfig.version` (Stage 6/9),
    // so this alone is what makes the change visible without any
    // additional cache-busting.
    await tx.tenantConfig.update({ where: { id: current.id }, data: { isActive: false } });
    const created = await tx.tenantConfig.create({
      data: {
        tenantId: ctx.tenantId,
        version: current.version + 1,
        blueprintRef: current.blueprintRef,
        overrides: merged as object,
        isActive: true,
      },
    });

    await logAudit(tx, ctx, {
      action: "workspaceConfig.updateNavigationLabel",
      resource: "workspaceConfig",
      resourceId: input.itemId,
      after: { label: input.label },
    });

    return created;
  },
};

/** Merges (or clears, on `null`) the tenant's own AI provider override,
 * preserving every other overrides key untouched — same pure, unit-testable
 * convention as `mergeNavigationLabelPatch` above. */
export function mergeAiProviderOverride(
  overrides: TenantConfigOverrides,
  provider: "anthropic" | "gemini" | "openai" | null,
): TenantConfigOverrides {
  const { ai: _ai, ...rest } = overrides;
  return provider === null ? rest : { ...rest, ai: { provider } };
}

const UpdateAiProviderInputSchema = z.object({ provider: z.enum(["anthropic", "gemini", "openai"]).nullable() });

// Plain constant, not a factory — same shape as updateNavigationLabelMutation
// above, TenantConfig is tenant-scoped and already reachable via `tx`.
export const updateAiProviderMutation: MutationDefinition<z.infer<typeof UpdateAiProviderInputSchema>> = {
  name: "workspaceConfig.updateAiProvider",
  inputSchema: UpdateAiProviderInputSchema,
  requiredPermission: "settings:manage",
  async resolve(input, ctx, tx) {
    const current = await tx.tenantConfig.findFirst({ where: { tenantId: ctx.tenantId, isActive: true } });
    if (!current) throw new BadRequestException("No active tenant config to update");

    const merged = mergeAiProviderOverride(current.overrides as unknown as TenantConfigOverrides, input.provider);

    // Same deactivate-then-recreate invariant as updateNavigationLabelMutation
    // above — a new version is always inserted, never mutated in place.
    await tx.tenantConfig.update({ where: { id: current.id }, data: { isActive: false } });
    const created = await tx.tenantConfig.create({
      data: {
        tenantId: ctx.tenantId,
        version: current.version + 1,
        blueprintRef: current.blueprintRef,
        overrides: merged as object,
        isActive: true,
      },
    });

    await logAudit(tx, ctx, {
      action: "workspaceConfig.updateAiProvider",
      resource: "workspaceConfig",
      resourceId: "ai.provider",
      after: { provider: input.provider },
    });

    return created;
  },
};

const BusinessHoursDaySchema = z.object({
  closed: z.boolean(),
  open: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm").optional(),
  close: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm").optional(),
});

const BusinessHoursSchema = z.object({
  monday: BusinessHoursDaySchema.optional(),
  tuesday: BusinessHoursDaySchema.optional(),
  wednesday: BusinessHoursDaySchema.optional(),
  thursday: BusinessHoursDaySchema.optional(),
  friday: BusinessHoursDaySchema.optional(),
  saturday: BusinessHoursDaySchema.optional(),
  sunday: BusinessHoursDaySchema.optional(),
});

// Every field optional — the input IS the "partial" shape directly, so a
// card can submit only its own slice (Company Info without touching
// businessHours, and vice versa) without a separate `.partial()` wrapper.
const UpdateProfileInputSchema = z.object({
  description: z.string().optional(),
  website: z.string().url().optional(),
  contactEmail: z.string().email().optional(),
  address: z.string().optional(),
  timezone: z.string().optional(),
  // Always saved as one whole-week object, not deep-merged per day — the
  // frontend's BusinessHoursCard submits all 7 days in a single save.
  businessHours: BusinessHoursSchema.optional(),
});

/** Pure, exported, unit-testable — same convention as
 * `mergeNavigationLabelPatch`. A plain shallow merge is correct here because
 * every top-level key (description/website/.../businessHours) is always
 * submitted whole by whichever card owns it; nothing needs a deeper merge. */
export function mergeTenantProfile(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  return { ...current, ...patch };
}

// Same factory reasoning as createUpdateBrandingMutation — `profile` lives
// on `Tenant`, a root table, unreachable via the tenant-scoped `tx`.
export function createUpdateProfileMutation(tenantPrisma: TenantPrismaService): MutationDefinition<z.infer<typeof UpdateProfileInputSchema>> {
  return {
    name: "tenant.updateProfile",
    inputSchema: UpdateProfileInputSchema,
    requiredPermission: "settings:manage",
    async resolve(input, ctx, tx) {
      const tenant = await tenantPrisma.root.tenant.findUnique({ where: { id: ctx.tenantId } });
      if (!tenant) throw new BadRequestException(`No tenant "${ctx.tenantId}"`);

      const profile = mergeTenantProfile(tenant.profile as Record<string, unknown>, input);
      // Same `as object` cast as `updateNavigationLabelMutation`'s `overrides`
      // above — Prisma's JSON input type isn't structurally satisfied by a
      // `Record<string, unknown>` (unknown values aren't provably
      // JSON-compatible to the type checker), even though the runtime value
      // always is.
      const updated = await tenantPrisma.root.tenant.update({ where: { id: ctx.tenantId }, data: { profile: profile as object } });

      await logAudit(tx, ctx, { action: "tenant.updateProfile", resource: "tenant", resourceId: ctx.tenantId, before: tenant.profile, after: profile });

      return updated;
    },
  };
}

const LOGO_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "svg"] as const;

/** Pure, exported, unit-testable — builds the Storage object path for a new
 * logo upload. A fresh `randomUUID()` per upload (never overwriting a fixed
 * path) means every logo change gets a brand-new public URL, so the browser
 * never needs a cache-busting query param — the accepted trade-off is that
 * a replaced logo's old file is never deleted from Storage, fine for a
 * small, rarely-changed, tenant-scoped asset. */
export function buildLogoUploadPath(tenantId: string, fileExt: string): string {
  const ext = fileExt.toLowerCase().replace(/^\./, "");
  if (!(LOGO_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new BadRequestException(`Unsupported file type ".${fileExt}" — use one of: ${LOGO_EXTENSIONS.join(", ")}`);
  }
  return `${tenantId}/${randomUUID()}.${ext}`;
}

const CreateLogoUploadUrlInputSchema = z.object({ fileExt: z.string().min(1) });

// Deliberately never touches the tenant-scoped `tx` — this mutation only
// asks Supabase Storage for a signed upload URL; the browser then uploads
// the file's bytes directly to Storage (never through our own API), and a
// separate, existing call (tenant.updateBranding, extended above with
// `logoUrl`) persists the result. Keeps this codebase's body-size limits
// untouched for the sake of one feature.
export function createCreateLogoUploadUrlMutation(
  supabaseAdmin: SupabaseAdminService,
): MutationDefinition<z.infer<typeof CreateLogoUploadUrlInputSchema>> {
  return {
    name: "tenant.createLogoUploadUrl",
    inputSchema: CreateLogoUploadUrlInputSchema,
    requiredPermission: "settings:manage",
    async resolve(input, ctx) {
      const path = buildLogoUploadPath(ctx.tenantId, input.fileExt);
      return supabaseAdmin.createLogoSignedUploadUrl(path);
    },
  };
}
