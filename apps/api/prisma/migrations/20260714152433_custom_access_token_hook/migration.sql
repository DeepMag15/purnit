-- Supabase Auth "Custom Access Token" hook: stamps `tenant_id` and a
-- `permissions_hash` claim onto every JWT Supabase mints/refreshes for a user,
-- so the API can authorize requests without an extra DB round-trip per request
-- (see ARCHITECTURE.md §5.1, CONTEXT.md §9).
--
-- Enabling this hook is a one-time manual step in the Supabase Dashboard
-- (Authentication -> Hooks -> Custom Access Token) — Supabase does not expose
-- this via SQL/RLS-reachable config, only the Management API (needs an
-- account-level personal access token we don't have) or the Dashboard.
--
-- SECURITY DEFINER, owned by the migration role (which has BYPASSRLS): the
-- `users`/`role_assignments` tables have FORCE ROW LEVEL SECURITY, and the
-- Auth service invokes this function as `supabase_auth_admin`, which has no
-- `app.tenant_id` session var and no BYPASSRLS — without SECURITY DEFINER the
-- lookup below would silently return zero rows and login would never get a
-- tenant_id claim.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  claims jsonb;
  v_user_id uuid;
  v_tenant_id uuid;
  v_permissions_hash text;
begin
  select u.id, u.tenant_id
    into v_user_id, v_tenant_id
  from users u
  where u.auth_user_id = (event->>'user_id')::uuid;

  claims := event->'claims';

  if v_tenant_id is not null then
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant_id::text));

    -- Placeholder cache-busting hash: changes whenever the user's role
    -- assignments change. Stage 3's Permission Resolver defines the
    -- canonical resolved-permission hash used at manifest-compile time;
    -- this only has to invalidate consistently, not match it byte-for-byte.
    select md5(coalesce(string_agg(ra.role_id::text, ',' order by ra.role_id), ''))
      into v_permissions_hash
    from role_assignments ra
    where ra.user_id = v_user_id;

    claims := jsonb_set(claims, '{permissions_hash}', to_jsonb(coalesce(v_permissions_hash, '')));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
