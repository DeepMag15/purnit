-- `comments`, `comment_mentions`, and `department_type_role_labels` were
-- never given the standard `tenant_isolation` RLS policy when they were
-- created (confirmed by grepping every prior migration for
-- "ENABLE ROW LEVEL SECURITY" — only 20260714145938_rls_and_app_role and
-- 20260715163523_project_members have it). App-layer scoping already
-- filters every query by tenant_id explicitly, so there's no live
-- vulnerability, but this closes a silent drift from ARCHITECTURE.md
-- §8.2's "every module table carries tenant_id + RLS" invariant before
-- three more new tables (Phase 1, Submodule 2: Channels & DMs) join them.
-- Same policy shape as every existing tenant_isolation policy — see
-- 20260714145938_rls_and_app_role/migration.sql for the NULLIF/fail-closed
-- rationale.

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE comment_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_mentions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comment_mentions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE department_type_role_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_type_role_labels FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON department_type_role_labels
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
