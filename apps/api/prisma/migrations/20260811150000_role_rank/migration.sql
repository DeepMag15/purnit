-- Role display ordering. `roles.list`/`roles.listDetailed` previously
-- sorted by `created_at asc` — since a role is always materialized after
-- whatever it `extends`, `role.intern` (the root of that chain, nothing
-- extends it) was always the first Role row created for a tenant, and
-- `role.admin` always last, so every role list showed Intern first and
-- Company Admin last: inverted from the real authority hierarchy.

-- AlterTable
ALTER TABLE "roles" ADD COLUMN "rank" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing tenants' roles into correct authority order in one
-- step, with no per-tenant/per-blueprint logic needed: reversing the
-- existing (buggy) created_at order is exactly the fix, since Company
-- Admin was always created last and role.intern always first. Custom
-- roles (source_blueprint_role_id IS NULL) are sorted after every
-- blueprint role regardless of their own created_at, matching the
-- "new custom roles append at the end" behavior role.createCustom
-- adopts going forward — without this, a custom role created more
-- recently than role.admin would otherwise backfill to rank 0, above
-- Company Admin.
UPDATE "roles" r SET "rank" = sub.rn - 1
FROM (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY tenant_id
    ORDER BY (source_blueprint_role_id IS NULL) ASC, created_at DESC
  ) AS rn
  FROM "roles"
) sub
WHERE r.id = sub.id;

-- CreateIndex
CREATE INDEX "roles_tenant_id_rank_idx" ON "roles"("tenant_id", "rank");
