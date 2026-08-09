-- Phase E: DashboardLayout.sections (an ordered module-section-name array,
-- Phase D) is superseded by widgets (an ordered per-widget {key, visible,
-- x, y, w, h} array, Phase E) — same column, reshaped in place, per that
-- column's own doc comment already flagging this as Phase E's job.
ALTER TABLE dashboard_layouts RENAME COLUMN sections TO widgets;

-- Existing rows hold the old string[] shape and are meaningless once the
-- column's contents change shape. Same "no backfill, a missing row is a
-- graceful cosmetic fallback" principle Phase D itself already established
-- for a tenant with zero rows — not a correctness issue worth a data
-- migration for. AuthService.signup's own seeding only ever runs for
-- brand-new tenants; a tenant that already existed before this migration
-- simply has zero DashboardLayout rows afterward.
DELETE FROM dashboard_layouts;

-- "At most one active row per key" — the DB enforces this, not application
-- logic alone, same precedent as tenant_configs_one_active_per_tenant
-- (migration 20260714145938_rls_and_app_role). Two separate partial indexes
-- since a row is keyed by exactly one of user_id/role_id, never both, and a
-- single compound unique index can't express "ignore whichever side is
-- null" on its own.
CREATE UNIQUE INDEX dashboard_layouts_one_active_per_user
  ON dashboard_layouts (tenant_id, user_id, dashboard_key) WHERE is_active = true AND user_id IS NOT NULL;
CREATE UNIQUE INDEX dashboard_layouts_one_active_per_role
  ON dashboard_layouts (tenant_id, role_id, dashboard_key) WHERE is_active = true AND role_id IS NOT NULL;
