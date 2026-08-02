"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase-client";
import { getAccessToken } from "../lib/session";
import { useRenderContext } from "./render-context";
import { dataSourceQueryKey } from "./use-data-binding";

interface RealtimeMessageRow {
  id: string;
  conversation_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

interface MessageListRow {
  id: string;
  conversationId: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

/**
 * Subscribes to Supabase Realtime's `postgres_changes` for new messages in
 * one conversation (Phase 1, Submodule 2: Channels & Direct Messages) and
 * patches the `messages.list` query cache directly on INSERT — the same
 * additive `queryKey` mechanism optimistic UI already uses (CONTEXT.md §48)
 * — rather than a full refetch.
 *
 * ⚠️ Best-effort only, not the delivery guarantee — confirmed live, via a
 * bare Node client with a fresh JWT, fully-open RLS, and a 100s+ wait,
 * that this Supabase project's Realtime service delivers `DELETE`
 * `postgres_changes` events correctly but never delivers `INSERT` events, on
 * either `messages` or `conversation_members`. Every layer under this app's
 * own control (publication membership, grants, RLS, replica identity,
 * `wal_level`) was verified correct; this is an external, disclosed
 * limitation of the managed Realtime service in this environment, not an
 * app bug. `ChatWorkspace`'s `messages.list` query therefore also polls
 * (`refetchInterval`) — that poll is the actual guarantee new messages show
 * up; this subscription is wired up so delivery becomes instant for free if
 * that limitation is ever resolved, without being load-bearing today.
 *
 * Requires `supabase.realtime.setAuth(accessToken)`: Realtime evaluates RLS
 * against the browser's own JWT-authenticated connection, which never sets
 * our app's `app.tenant_id` session GUC (that's set only by
 * `TenantPrismaService`, per-request, on our own backend's connection) — see
 * the `realtime_membership` policy added alongside the chat migration for
 * why a second, JWT-based policy exists on these tables at all. Re-sets auth
 * on `TOKEN_REFRESHED` too, since Supabase's own client already auto-
 * refreshes the underlying session in the background regardless of what
 * this app's own `antigravity.accessToken` copy says.
 *
 * `displayNameById` resolves the author of a just-arrived row without a
 * second fetch — the raw Realtime payload is the bare `messages` row, no
 * joined author name, so this reuses whatever name map the caller already
 * has (ChatWorkspace builds it once from `users.list`, a data source other
 * composites already call — no new fetch introduced).
 *
 * Read via a ref, not a subscribing effect dependency — a real bug caught
 * during this submodule's own live verification: `displayNameById` is a
 * `useMemo`'d `Map`, and TanStack Query's default `refetchOnWindowFocus`
 * gave it a new reference on every refetch (e.g. switching focus between
 * browser windows/tabs), which tore down and re-established this
 * subscription in a loop — narrow enough gaps between unsubscribe and
 * resubscribe that a message sent during one was reliably missed. The
 * subscription itself must depend only on stable identifiers.
 */
export function useRealtimeMessages(conversationId: string | null, displayNameById: Map<string, string>) {
  const { user, tenant } = useRenderContext();
  const queryClient = useQueryClient();
  const displayNameByIdRef = useRef(displayNameById);
  displayNameByIdRef.current = displayNameById;

  useEffect(() => {
    if (!conversationId) return;

    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    async function subscribe() {
      const token = getAccessToken();
      if (token) await supabase.realtime.setAuth(token);
      if (cancelled) return;

      channel = supabase
        .channel(`messages:${conversationId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            const row = payload.new as RealtimeMessageRow;
            const key = dataSourceQueryKey("messages.list", { conversationId }, tenant.id, user.id);
            queryClient.setQueryData(key, (old: unknown) => {
              const list = Array.isArray(old) ? (old as MessageListRow[]) : [];
              if (list.some((m) => m.id === row.id)) return list;
              return [
                ...list,
                {
                  id: row.id,
                  conversationId: row.conversation_id,
                  body: row.body,
                  authorId: row.author_id,
                  authorName: displayNameByIdRef.current.get(row.author_id) ?? (row.author_id === user.id ? user.displayName : "Unknown"),
                  createdAt: row.created_at,
                },
              ];
            });
          },
        )
        .subscribe();
    }

    subscribe();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient, tenant.id, user.id, user.displayName]);
}
