-- Real bug caught during this submodule's own live verification: the
-- `conversation_members` realtime_membership policy (added in
-- 20260721163820_chat_conversations_messages) queried `conversation_members`
-- from inside its own USING clause's EXISTS subquery — Postgres detects
-- that as infinite recursion ("infinite recursion detected in policy for
-- relation conversation_members", 42P17) the moment anything touches the
-- table, including a plain insert. `conversations`/`messages`' own policies
-- were fine (a different table referencing conversation_members isn't
-- self-recursive) — only conversation_members' policy on itself was broken.
--
-- Fix: the standard Postgres/Supabase pattern for exactly this — a
-- SECURITY DEFINER helper function whose internal query bypasses RLS
-- (same technique already used by custom_access_token_hook), so checking
-- "is this user a member of this conversation" from within
-- conversation_members' own policy no longer re-triggers that policy.

DROP POLICY realtime_membership ON conversations;
DROP POLICY realtime_membership ON conversation_members;
DROP POLICY realtime_membership ON messages;

CREATE FUNCTION is_conversation_member(p_conversation_id uuid, p_auth_uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = p_conversation_id AND u.auth_user_id = p_auth_uid
  );
$$;

REVOKE ALL ON FUNCTION is_conversation_member(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION is_conversation_member(uuid, uuid) TO authenticated, app_runtime;

CREATE POLICY realtime_membership ON conversations
  USING ((auth.jwt() ->> 'tenant_id')::uuid = tenant_id AND is_conversation_member(id, auth.uid()));

CREATE POLICY realtime_membership ON conversation_members
  USING ((auth.jwt() ->> 'tenant_id')::uuid = tenant_id AND is_conversation_member(conversation_id, auth.uid()));

CREATE POLICY realtime_membership ON messages
  USING ((auth.jwt() ->> 'tenant_id')::uuid = tenant_id AND is_conversation_member(conversation_id, auth.uid()));
