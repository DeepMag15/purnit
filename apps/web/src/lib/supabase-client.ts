import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client, used for signing in (Supabase Auth issues
 * the JWT directly — the API never brokers login, only signup
 * orchestration; see AuthService.signup on the backend and ARCHITECTURE.md
 * §5.1) and for direct-to-Storage uploads (e.g. logo upload — see
 * WorkspaceSettings.tsx). The anon/publishable key is safe to expose to the
 * browser by design.
 *
 * Lazily constructed on first real use, not at module-import time — Vitest
 * doesn't load `apps/web/.env` (only Next.js does, via `next.config.ts`),
 * so eagerly reading `process.env.NEXT_PUBLIC_SUPABASE_URL` at import time
 * crashes any test that transitively imports this module through
 * `registerAllComponents()`, even one that never actually calls Supabase.
 * A `Proxy` keeps the existing `supabase.auth.x`/`supabase.storage.x`
 * call-site ergonomics unchanged.
 */
let client: SupabaseClient | undefined;

function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  }
  return client;
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return Reflect.get(getClient(), prop as keyof SupabaseClient);
  },
});
