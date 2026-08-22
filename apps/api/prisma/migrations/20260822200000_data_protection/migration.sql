-- Go-Live, Phase 05: data protection.
--
-- Adds workspace closure to `tenants`. Account deletion needs no schema
-- change — `users.deleted_at` already exists and was simply never written by
-- anything.

ALTER TABLE "tenants" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- The retention job sweeps for rows whose deleted_at has passed the window.
-- Without this it would scan every tenant on every run; trivial today, but
-- the job runs forever and the table only grows.
CREATE INDEX "tenants_deleted_at_idx" ON "tenants"("deleted_at");

-- Same reasoning for users: the purge sweeps soft-deleted people per tenant,
-- and `user.invite`'s "already invited?" check filters on deleted_at too.
CREATE INDEX "users_tenant_id_deleted_at_idx" ON "users"("tenant_id", "deleted_at");
