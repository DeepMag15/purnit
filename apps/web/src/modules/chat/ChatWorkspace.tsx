"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { CommonRenderProps } from "../../sdui/registry";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceQuery, dataSourceQueryKey } from "../../sdui/use-data-binding";
import { useRealtimeMessages } from "../../sdui/use-realtime";
import { Card, CardHeader } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Badge } from "../../ui/Badge";
import { Input } from "../../ui/Input";
import { Dropdown, DropdownItem } from "../../ui/Dropdown";
import { Icon } from "../../ui/Icon";
import { SkeletonRows } from "../../ui/Skeleton";
import { useToast } from "../../ui/Toast";
import { cn } from "../../ui/utils";

export const ChatWorkspaceSchema = z.object({});
type Props = z.infer<typeof ChatWorkspaceSchema>;

interface ConversationRow {
  id: string;
  type: "channel" | "dm";
  name: string | null;
  isPrivate: boolean;
  createdById: string;
  otherMember: { id: string; displayName: string } | null;
  memberCount: number;
  unreadCount: number;
  lastMessageAt: string | null;
}

interface ChannelOption {
  id: string;
  name: string | null;
}

interface MessageRow {
  id: string;
  conversationId: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

interface UserOption {
  id: string;
  displayName: string;
}

function conversationLabel(c: ConversationRow): string {
  if (c.type === "dm") return c.otherMember?.displayName ?? "Direct message";
  return c.name ?? "Untitled channel";
}

/**
 * Phase 1, Submodule 2: Channels & Direct Messages — a blueprint-registered
 * composite (unlike `CommentThread`, which is a plain shared component: a
 * whole chat workspace is a real top-level page, not a per-row expansion).
 * Manages its own data via `useDataSourceQuery` rather than a node `bind`,
 * same precedent as `OrgStructure` — the conversation rail, message thread,
 * and "browse channels" list are three independent, UI-driven fetches no
 * static `bind` could express in one shape.
 */
export function ChatWorkspace({ actions }: Props & CommonRenderProps) {
  const { user, tenant, callMutation, callDataSource } = useRenderContext();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showBrowse, setShowBrowse] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelPrivate, setNewChannelPrivate] = useState(false);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [messageBody, setMessageBody] = useState("");
  const [selectedMentions, setSelectedMentions] = useState<UserOption[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const canSend = actions?.some((a) => a.kind === "mutation" && a.mutation === "message.send") ?? true;

  const { data: conversationsData, isPending: conversationsPending } = useDataSourceQuery<ConversationRow[]>("conversations.list");
  const conversations = Array.isArray(conversationsData) ? conversationsData : [];

  const { data: usersData } = useDataSourceQuery<UserOption[]>("users.list");
  const users = Array.isArray(usersData) ? usersData : [];
  const displayNameById = useMemo(() => new Map(users.map((u) => [u.id, u.displayName])), [users]);
  const dmCandidates = users.filter((u) => u.id !== user.id);

  const { data: browseData, isPending: browsePending } = useDataSourceQuery<ChannelOption[]>("channels.list", {}, { enabled: showBrowse });
  const browsableChannels = Array.isArray(browseData) ? browseData : [];

  const { data: messagesData, isPending: messagesPending } = useDataSourceQuery<MessageRow[]>(
    "messages.list",
    selectedId ? { conversationId: selectedId } : {},
    // `refetchInterval` is the actual delivery guarantee for new messages —
    // see `useRealtimeMessages`'s doc comment for why the Realtime push path
    // can't be relied on alone in this environment (verified live: INSERT
    // events aren't delivered by this project's Realtime service, DELETE
    // events are — an external, disclosed limitation, not an app bug). This
    // short poll is what actually keeps an open thread current; Realtime
    // stays wired up as a best-effort accelerator for if/when that's fixed.
    { enabled: !!selectedId, refetchInterval: selectedId ? 4000 : undefined },
  );
  const messages = Array.isArray(messagesData) ? messagesData : [];

  useRealtimeMessages(selectedId, displayNameById);

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;

  function invalidateConversations() {
    queryClient.invalidateQueries({ queryKey: dataSourceQueryKey("conversations.list", {}, tenant.id, user.id) });
  }

  function selectConversation(id: string) {
    setSelectedId(id);
    setMessageBody("");
    setSelectedMentions([]);
    callMutation("conversation.markRead", { conversationId: id })
      .then(invalidateConversations)
      .catch(() => {
        // Best-effort — an unread badge staying stale for one tick isn't worth surfacing an error for.
      });
  }

  async function handleCreateChannel() {
    if (!newChannelName.trim()) return;
    setCreatingChannel(true);
    try {
      const created = (await callMutation("conversation.createChannel", {
        name: newChannelName.trim(),
        isPrivate: newChannelPrivate,
      })) as ConversationRow;
      setNewChannelName("");
      setNewChannelPrivate(false);
      setShowNewChannel(false);
      invalidateConversations();
      setSelectedId(created.id);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't create channel", "danger");
    } finally {
      setCreatingChannel(false);
    }
  }

  async function handleJoinChannel(channelId: string) {
    try {
      await callMutation("conversation.addMember", { conversationId: channelId, userId: user.id });
      invalidateConversations();
      queryClient.invalidateQueries({ queryKey: dataSourceQueryKey("channels.list", {}, tenant.id, user.id) });
      setSelectedId(channelId);
      setShowBrowse(false);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't join channel", "danger");
    }
  }

  async function handleStartDm(otherUserId: string) {
    try {
      const conversation = (await callMutation("conversation.createDm", { otherUserId })) as ConversationRow;
      invalidateConversations();
      setSelectedId(conversation.id);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't start direct message", "danger");
    }
  }

  async function handleArchive(conversationId: string) {
    try {
      await callMutation("conversation.archive", { conversationId });
      invalidateConversations();
      if (selectedId === conversationId) setSelectedId(null);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't archive conversation", "danger");
    }
  }

  function addMention(candidate: UserOption) {
    if (selectedMentions.some((m) => m.id === candidate.id)) return;
    setSelectedMentions((current) => [...current, candidate]);
    setMessageBody((current) => `${current}${current.trim() ? " " : ""}@${candidate.displayName} `);
  }

  function removeMention(id: string) {
    setSelectedMentions((current) => current.filter((m) => m.id !== id));
  }

  async function handleSend() {
    if (!selectedId || !messageBody.trim()) return;
    setSending(true);
    try {
      const sent = (await callMutation("message.send", {
        conversationId: selectedId,
        body: messageBody.trim(),
        mentionedUserIds: selectedMentions.map((m) => m.id),
      })) as MessageRow;

      const key = dataSourceQueryKey("messages.list", { conversationId: selectedId }, tenant.id, user.id);
      queryClient.setQueryData(key, (old: unknown) => {
        const current = Array.isArray(old) ? (old as MessageRow[]) : [];
        if (current.some((m) => m.id === sent.id)) return current;
        return [...current, { ...sent, authorName: user.displayName }];
      });
      setMessageBody("");
      setSelectedMentions([]);
      invalidateConversations();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't send message", "danger");
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteMessage(id: string) {
    if (!selectedId) return;
    try {
      await callMutation("message.delete", { id });
      const key = dataSourceQueryKey("messages.list", { conversationId: selectedId }, tenant.id, user.id);
      queryClient.setQueryData(key, (old: unknown) => (Array.isArray(old) ? (old as MessageRow[]).filter((m) => m.id !== id) : old));
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't delete message", "danger");
    }
  }

  async function handleLoadOlder() {
    const oldest = messages[0];
    if (!selectedId || !oldest) return;
    setLoadingOlder(true);
    try {
      const older = (await callDataSource("messages.list", { conversationId: selectedId, before: oldest.createdAt })) as MessageRow[];
      if (Array.isArray(older) && older.length > 0) {
        const key = dataSourceQueryKey("messages.list", { conversationId: selectedId }, tenant.id, user.id);
        queryClient.setQueryData(key, (old: unknown) => {
          const current = Array.isArray(old) ? (old as MessageRow[]) : [];
          const existingIds = new Set(current.map((m) => m.id));
          return [...older.filter((m) => !existingIds.has(m.id)), ...current];
        });
      }
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't load older messages", "danger");
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-160px)] gap-4">
      <Card className="flex w-72 shrink-0 flex-col overflow-hidden">
        <CardHeader
          title="Conversations"
          action={
            <div className="flex gap-1">
              <button
                type="button"
                title="Browse channels"
                onClick={() => setShowBrowse((v) => !v)}
                className={cn("rounded-md p-1 text-text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text", showBrowse && "text-accent")}
              >
                <Icon name="search" size={16} />
              </button>
              <Dropdown
                trigger={({ toggle }) => (
                  <button type="button" onClick={toggle} title="New direct message" className="rounded-md p-1 text-text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text">
                    <Icon name="person_add" size={16} />
                  </button>
                )}
              >
                {({ close }) => (
                  <div className="max-h-56 w-52 overflow-y-auto py-1">
                    {dmCandidates.length === 0 && <p className="px-3 py-1.5 text-xs text-text-muted">No other members yet.</p>}
                    {dmCandidates.map((u) => (
                      <DropdownItem
                        key={u.id}
                        onClick={() => {
                          close();
                          handleStartDm(u.id);
                        }}
                      >
                        {u.displayName}
                      </DropdownItem>
                    ))}
                  </div>
                )}
              </Dropdown>
              {canSend && (
                <button
                  type="button"
                  title="New channel"
                  onClick={() => setShowNewChannel((v) => !v)}
                  className="rounded-md p-1 text-text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
                >
                  <Icon name="add" size={16} />
                </button>
              )}
            </div>
          }
        />

        {showNewChannel && (
          <div className="flex flex-col gap-2 border-b border-border p-3">
            <Input value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} placeholder="Channel name" />
            <label className="flex items-center gap-2 text-xs text-text-muted">
              <input type="checkbox" checked={newChannelPrivate} onChange={(e) => setNewChannelPrivate(e.target.checked)} />
              Private
            </label>
            <Button size="sm" onClick={handleCreateChannel} disabled={creatingChannel || !newChannelName.trim()}>
              {creatingChannel ? "Creating…" : "Create channel"}
            </Button>
          </div>
        )}

        {showBrowse && (
          <div className="border-b border-border p-2">
            {browsePending && <SkeletonRows rows={2} />}
            {!browsePending && browsableChannels.length === 0 && <p className="px-2 py-1 text-xs text-text-muted">No public channels to join.</p>}
            {!browsePending &&
              browsableChannels.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleJoinChannel(c.id)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-text transition-colors duration-150 hover:bg-surface-hover"
                >
                  <span className="truncate">{c.name}</span>
                  <span className="text-xs text-accent">Join</span>
                </button>
              ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {conversationsPending && (
            <div className="p-3">
              <SkeletonRows rows={4} />
            </div>
          )}
          {!conversationsPending && conversations.length === 0 && (
            <p className="p-3 text-sm text-text-muted">No conversations yet — start a DM or create a channel.</p>
          )}
          {!conversationsPending &&
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectConversation(c.id)}
                className={cn(
                  "flex w-full items-center gap-2 border-b border-border/60 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-hover",
                  selectedId === c.id && "bg-accent/10",
                )}
              >
                <Icon name={c.type === "dm" ? "person" : c.isPrivate ? "lock" : "tag"} size={15} className="shrink-0 text-text-muted" />
                <span className={cn("min-w-0 flex-1 truncate text-sm text-text", c.unreadCount > 0 && "font-semibold")}>{conversationLabel(c)}</span>
                {c.unreadCount > 0 && (
                  <span className="shrink-0">
                    <Badge tone="accent">{c.unreadCount > 99 ? "99+" : c.unreadCount}</Badge>
                  </span>
                )}
              </button>
            ))}
        </div>
      </Card>

      <Card className="flex flex-1 flex-col overflow-hidden">
        {!selectedConversation && <div className="flex flex-1 items-center justify-center text-sm text-text-muted">Select a conversation to start chatting.</div>}

        {selectedConversation && (
          <>
            <CardHeader
              title={conversationLabel(selectedConversation)}
              action={
                selectedConversation.createdById === user.id && (
                  <button
                    type="button"
                    title="Archive conversation"
                    onClick={() => handleArchive(selectedConversation.id)}
                    className="rounded-md p-1 text-text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-danger"
                  >
                    <Icon name="archive" size={16} />
                  </button>
                )
              }
            />

            <div className="flex-1 overflow-y-auto p-4">
              {messages.length > 0 && (
                <div className="mb-3 flex justify-center">
                  <Button size="sm" variant="secondary" onClick={handleLoadOlder} disabled={loadingOlder}>
                    {loadingOlder ? "Loading…" : "Load older messages"}
                  </Button>
                </div>
              )}
              {messagesPending && <SkeletonRows rows={4} />}
              {!messagesPending && messages.length === 0 && <p className="text-sm text-text-muted">No messages yet — say hello.</p>}
              <ul className="flex flex-col gap-3">
                {messages.map((m) => (
                  <li key={m.id} className="group flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-text">{m.authorName}</span>{" "}
                      <span className="text-xs text-text-muted">{new Date(m.createdAt).toLocaleString()}</span>
                      <p className="whitespace-pre-wrap break-words text-sm text-text">{m.body}</p>
                    </div>
                    {m.authorId === user.id && (
                      <button
                        type="button"
                        onClick={() => handleDeleteMessage(m.id)}
                        className="shrink-0 text-text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-danger"
                        title="Delete message"
                      >
                        <Icon name="delete" size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {canSend && (
              <div className="border-t border-border p-3">
                {selectedMentions.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {selectedMentions.map((m) => (
                      <Badge key={m.id} tone="accent">
                        @{m.displayName}
                        <button type="button" onClick={() => removeMention(m.id)} className="ml-1">
                          <Icon name="close" size={10} />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={messageBody}
                    onChange={(e) => setMessageBody(e.target.value)}
                    placeholder="Write a message…"
                    rows={2}
                    className={cn(
                      "flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent",
                    )}
                  />
                  <div className="flex flex-col gap-1">
                    <Dropdown
                      trigger={({ toggle }) => (
                        <button
                          type="button"
                          onClick={toggle}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs text-text-muted transition-colors duration-150 hover:bg-surface-hover"
                        >
                          <Icon name="alternate_email" size={12} />
                          Mention
                        </button>
                      )}
                    >
                      {({ close }) => (
                        <div className="max-h-56 w-52 overflow-y-auto py-1">
                          {users
                            .filter((u) => u.id !== user.id)
                            .map((u) => (
                              <DropdownItem
                                key={u.id}
                                onClick={() => {
                                  close();
                                  addMention(u);
                                }}
                              >
                                {u.displayName}
                              </DropdownItem>
                            ))}
                        </div>
                      )}
                    </Dropdown>
                    <Button onClick={handleSend} disabled={sending || !messageBody.trim()} className="whitespace-nowrap">
                      {sending ? "Sending…" : "Send"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
