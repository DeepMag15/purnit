import type { TenantPrismaService } from "../tenancy/tenant-prisma.service";

/** Lowercase, `[a-z0-9-]` only, hyphens collapsed/trimmed. Pure and
 * unit-tested directly — same "extract branching logic" convention as
 * `projectsWhere`/`mergeNavigationLabelPatch`. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Probes `-2`, `-3`, … suffixes against existing `workspaceId`s until a
 * free one is found. A simple pre-check loop, not a distributed-safe
 * retry — Phase 1-appropriate given real signup concurrency is near zero;
 * the `@unique` index on `Tenant.workspaceId` still turns a genuine race
 * into a hard DB error rather than silently duplicating. */
export async function generateUniqueWorkspaceId(tenantPrisma: TenantPrismaService, companyName: string): Promise<string> {
  const base = slugify(companyName) || "workspace";
  let candidate = base;
  let suffix = 2;
  while (await tenantPrisma.root.tenant.findUnique({ where: { workspaceId: candidate } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}
