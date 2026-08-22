"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceQuery, dataSourceQueryKey } from "../../sdui/use-data-binding";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { SkeletonRows } from "../../ui/Skeleton";
import { useToast } from "../../ui/Toast";
import { cn } from "../../ui/utils";

interface ConversationRow {
  id: string;
  title: string | null;
  updatedAt: string;
}

interface ToolCallInfo {
  proposalId: string;
  mutationName: string;
  input: unknown;
  status: "pending" | "executed";
}

interface MessageRow {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  toolCall: ToolCallInfo | null;
}

const AUTO_SEND_PRESETS: Record<string, string> = {
  "documents.summarize": "Summarize this document.",
};

/**
 * The global AI Assistant panel — a plain shell-mounted component, not
 * blueprint-registered, same "not in the SDUI registry" precedent as
 * NotificationBell/CommandPalette. `preset`/`context` (Phase B's first real
 * consumer: `"documents.summarize"`/`"documents.qa"` with
 * `{sourceType: "document", sourceId}`) are threaded into the created
 * conversation's `contextRef`, which the backend uses to narrow retrieval
 * to that one document — one retrieval code path, no per-preset backend
 * branching. `"documents.summarize"` additionally auto-sends a first
 * message so opening it is a single click, not a click then a typed
 * question.
 *
 * Analytics Phase H generalized the auto-send mechanism: a *string*
 * `context` (rather than the `{sourceType, sourceId}` object shape) is
 * treated as the literal first message to auto-send, instead of looking up
 * a fixed per-preset literal in `AUTO_SEND_PRESETS` — "Ask AI about this
 * dashboard" builds that string client-side from the dashboard's own
 * already-fetched widget values (`AnalyticsDashboard.tsx`'s
 * `formatWidgetsForAi`), no new backend mutation/data source needed. A
 * string `context` is never forwarded as `contextRef` (it isn't a retrieval
 * scope, would fail that mutation's own Zod validation) — see `sendMessage`
 * below. `documents.summarize`/`documents.qa` are unaffected: their
 * `context` is always an object, so they keep resolving through
 * `AUTO_SEND_PRESETS` exactly as before.
 *
 * No polling: unlike Chat, `aiMessage.send` is a single synchronous
 * mutation that returns the assistant's reply directly — there's no
 * background job for a poll to catch up with, and a personal AI
 * conversation has no second party who could update it concurrently.
 *
 * Phase D (tool-calling): an assistant message can carry a `toolCall`
 * (present only while the model proposed calling one of a curated,
 * server-side allowlisted mutation on the user's behalf) — rendered with a
 * Confirm button while `status === "pending"`, nothing once `"executed"`.
 * Confirming never executes anything client-side; it calls
 * `aiToolCall.confirm` (which does, after re-checking the user's current
 * permissions server-side) then chains `aiToolCall.reply` for the model's
 * natural-language wrap-up. A `"tool"`-role message is a deterministic,
 * non-LLM result summary — rendered as a small centered system-event
 * bubble, distinct from both chat bubbles.
 */
export function AiPanel({
  open,
  onClose,
  preset,
  context,
}: {
  open: boolean;
  onClose: () => void;
  preset?: string;
  context?: unknown;
}) {
  const { user, tenant, callMutation } = useRenderContext();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmingProposalId, setConfirmingProposalId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const autoSentForRef = useRef<string | null>(null);

  const { data: conversationsData, isPending: conversationsPending } = useDataSourceQuery<ConversationRow[]>("aiConversations.list", {}, { enabled: open });
  const conversations = Array.isArray(conversationsData) ? conversationsData : [];

  const { data: messagesData, isPending: messagesPending } = useDataSourceQuery<MessageRow[]>(
    "aiConversation.messages",
    { conversationId: activeConversationId ?? "" },
    { enabled: open && !!activeConversationId },
  );
  const messages = Array.isArray(messagesData) ? [...messagesData].reverse() : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  function invalidateMessages(conversationId: string) {
    queryClient.invalidateQueries({ queryKey: dataSourceQueryKey("aiConversation.messages", { conversationId }, tenant.id, user.id) });
  }

  function invalidateConversations() {
    queryClient.invalidateQueries({ queryKey: dataSourceQueryKey("aiConversations.list", {}, tenant.id, user.id) });
  }

  async function sendMessage(content: string, opts?: { forceNewConversation?: boolean }) {
    if (!content || sending) return;
    setSending(true);
    try {
      // `forceNewConversation` exists because the auto-send effect below
      // calls `setActiveConversationId(null)` and this in the same tick —
      // the state update hasn't landed yet, so `activeConversationId` here
      // would otherwise still read the *previous* render's (stale) value.
      let conversationId = opts?.forceNewConversation ? null : activeConversationId;
      if (!conversationId) {
        // preset/contextRef only matter at creation time — once a
        // conversation exists, every later send just reuses its id, so a
        // manually-typed follow-up naturally stays scoped the same way. A
        // string context (Phase H's dynamic auto-send content) is never a
        // real {sourceType, sourceId} retrieval scope — never forwarded as
        // contextRef, which would fail that mutation's own Zod validation.
        const created = (await callMutation("aiConversation.create", {
          preset,
          contextRef: typeof context === "string" ? undefined : context,
        })) as { id: string };
        conversationId = created.id;
        setActiveConversationId(conversationId);
      }
      await callMutation("aiMessage.send", { conversationId, content });
      invalidateMessages(conversationId);
      invalidateConversations();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't send message", "danger");
    } finally {
      setSending(false);
    }
  }

  async function handleSend() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    await sendMessage(content);
  }

  function handleNewConversation() {
    setActiveConversationId(null);
  }

  // Phase D — a pending tool-call bubble's Confirm button. Chains
  // aiToolCall.reply automatically after confirm succeeds (a UI-level
  // chain, not a combined backend mutation) — if the reply fails, the
  // already-persisted deterministic "tool" message still shows the action
  // happened, so this is never left ambiguous about whether something ran.
  async function handleConfirmToolCall(proposalId: string) {
    if (!activeConversationId || confirmingProposalId) return;
    setConfirmingProposalId(proposalId);
    try {
      await callMutation("aiToolCall.confirm", { proposalId });
      invalidateMessages(activeConversationId);
      try {
        await callMutation("aiToolCall.reply", { proposalId });
      } catch {
        toast.show("Action completed, but the assistant's reply failed — refresh to try again", "danger");
      }
      invalidateMessages(activeConversationId);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't confirm this action", "danger");
    } finally {
      setConfirmingProposalId(null);
    }
  }

  async function handleArchive(e: React.MouseEvent, conversationId: string) {
    e.stopPropagation();
    try {
      await callMutation("aiConversation.archive", { id: conversationId });
      if (activeConversationId === conversationId) setActiveConversationId(null);
      invalidateConversations();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't archive conversation", "danger");
    }
  }

  // Opening with a preset always starts a fresh, scoped conversation — a
  // different document's "Ask AI"/"Summarize" click must not continue
  // whatever conversation happened to be active. "documents.summarize"
  // additionally auto-sends its first message, so it's a single click
  // rather than a click then a typed question. Keyed on preset+context
  // together (not just preset) so re-triggering the same preset for a
  // different document re-fires.
  useEffect(() => {
    if (!open || !preset) return;
    const autoSendKey = `${preset}:${JSON.stringify(context ?? null)}`;
    if (autoSentForRef.current === autoSendKey) return;
    autoSentForRef.current = autoSendKey;
    setActiveConversationId(null);
    setDraft("");
    // A string context IS the content to auto-send (Phase H) — otherwise
    // fall back to a fixed per-preset literal, unchanged from before.
    const autoSendContent = typeof context === "string" ? context : AUTO_SEND_PRESETS[preset];
    if (autoSendContent) void sendMessage(autoSendContent, { forceNewConversation: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sendMessage closes over activeConversationId/sending by design; re-running per keystroke would defeat the "only once per preset+context" guard above.
  }, [open, preset, context]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-2xl bg-surface shadow-xl">
        <div className="hidden w-56 shrink-0 flex-col border-r border-border p-2 sm:flex">
          <Button size="sm" variant="secondary" onClick={handleNewConversation} className="mb-2">
            <Icon name="add" size={14} />
            New chat
          </Button>
          <div className="flex-1 overflow-y-auto">
            {conversationsPending && <SkeletonRows rows={3} />}
            {!conversationsPending &&
              conversations.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "group flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover",
                    c.id === activeConversationId && "bg-surface-hover",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActiveConversationId(c.id)}
                    className={cn("min-w-0 flex-1 truncate text-left text-xs", c.id === activeConversationId ? "text-text" : "text-text-muted")}
                  >
                    {c.title ?? "New conversation"}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleArchive(e, c.id)}
                    title="Archive conversation"
                    className="shrink-0 text-text-muted opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 hover:text-danger"
                  >
                    <Icon name="archive" size={13} />
                  </button>
                </div>
              ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 items-center justify-between border-b border-border px-4">
            <div className="flex items-center gap-2 text-sm font-medium text-text">
              <Icon name="auto_awesome" size={16} />
              Ask AI
            </div>
            <button type="button" onClick={onClose} className="text-text-muted hover:text-text">
              <Icon name="close" size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {activeConversationId && messagesPending && <SkeletonRows rows={3} />}
            {(!activeConversationId || (!messagesPending && messages.length === 0)) && (
              <div className="flex h-full items-center justify-center text-center text-sm text-text-muted">
                Ask me anything — I can have general conversations, answer questions using your workspace&apos;s data, and propose
                actions like creating a task or approving a leave request (you&apos;ll always confirm before anything runs).
              </div>
            )}
            <div className="flex flex-col gap-3">
              {messages.map((m, i) => {
                if (m.role === "tool") {
                  return (
                    <div key={m.id} className="flex justify-center">
                      <div className="max-w-[85%] rounded-md bg-surface-hover px-3 py-1.5 text-xs text-text-muted">{m.content}</div>
                    </div>
                  );
                }
                const isNewest = i === messages.length - 1;
                return (
                  <div key={m.id} className={cn("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
                    <div
                      className={cn(
                        "max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                        m.role === "user" ? "bg-accent text-accent-fg" : "border border-border bg-surface text-text",
                      )}
                    >
                      {m.content}
                    </div>
                    {m.toolCall && m.toolCall.status === "pending" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className={cn("mt-1.5", !isNewest && "opacity-60")}
                        disabled={confirmingProposalId === m.toolCall.proposalId}
                        onClick={() => handleConfirmToolCall(m.toolCall!.proposalId)}
                      >
                        {confirmingProposalId === m.toolCall.proposalId ? "Confirming…" : "Confirm"}
                      </Button>
                    )}
                  </div>
                );
              })}
              {sending && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-muted">Thinking…</div>
                </div>
              )}
            </div>
            <div ref={messagesEndRef} />
          </div>

          <div className="flex items-end gap-2 border-t border-border p-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask a question…"
              rows={2}
              disabled={sending}
              className="w-full flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent"
            />
            <Button size="sm" onClick={handleSend} disabled={sending || !draft.trim()}>
              <Icon name="send" size={14} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
