"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceQuery, dataSourceQueryKey } from "../../sdui/use-data-binding";
import { Card, CardBody } from "../../ui/Card";
import { PageHeader } from "../../ui/PageHeader";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Badge } from "../../ui/Badge";
import { StatusDot } from "../../ui/StatusDot";
import { Dropdown } from "../../ui/Dropdown";
import { Icon } from "../../ui/Icon";
import { SkeletonRows } from "../../ui/Skeleton";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { JitsiCallFrame } from "./JitsiCallFrame";

export const MeetingsWorkspaceSchema = z.object({});

interface MeetingsCapabilities {
  canSchedule: boolean;
}

interface ParticipantRef {
  id: string;
  displayName: string;
}

interface MeetingRow {
  id: string;
  title: string;
  description: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  organizerId: string;
  organizerName: string | null;
  cancelledAt: string | null;
  videoRoomName: string;
  participants: ParticipantRef[];
  isOrganizer: boolean;
  isParticipant: boolean;
}

interface UserOption {
  id: string;
  displayName: string;
}

interface ActiveCall {
  roomName: string;
  token: string;
}

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay = start.toDateString() === end.toDateString();
  const dateFmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  return sameDay
    ? `${start.toLocaleDateString(undefined, dateFmt)} · ${start.toLocaleTimeString(undefined, timeFmt)}–${end.toLocaleTimeString(undefined, timeFmt)}`
    : `${start.toLocaleString(undefined, { ...dateFmt, ...timeFmt })} – ${end.toLocaleString(undefined, { ...dateFmt, ...timeFmt })}`;
}

/**
 * Core Workspace Modules, Phase 1, Submodule 3: Meetings.
 *
 * Frontend Redesign, Phase 02 — moved off the SDUI Renderer onto a
 * dedicated route (`/workspace/meetings`). Zero-prop now — `canSchedule`
 * comes from the new `meetings.capabilities` data source instead of the
 * `actions` prop the Renderer used to inject (pure parity fix, `canSchedule`
 * was already correctly derived before). Join/Cancel/participant management
 * stay data-driven off each row's `isOrganizer`/`isParticipant` flags, same
 * precedent as `ChatWorkspace`'s creator-only archive button — those
 * mutations carry no `requiredPermission` to prune on either way.
 */
export function MeetingsWorkspace() {
  const { user, tenant, callMutation } = useRenderContext();
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: caps, isPending: capsPending } = useDataSourceQuery<MeetingsCapabilities>("meetings.capabilities");
  const canSchedule = caps?.canSchedule ?? false;

  const { data: meetingsData, isPending: meetingsPending } = useDataSourceQuery<MeetingRow[]>("meetings.list");
  const meetings = Array.isArray(meetingsData) ? meetingsData : [];
  const isPending = capsPending || meetingsPending;

  // The fix for a real gap found while building this: `users.list` (reused
  // by ProjectBoard's member picker) is gated on `user:manage`, which
  // Lead/Manager tiers never hold even though they DO hold `meeting:create` —
  // reusing it here would leave the very tiers this feature targets unable
  // to invite anyone. `meetings.inviteCandidates` is gated on `meeting:create`
  // instead (see meetings.data-sources.ts's doc comment).
  const { data: candidatesData } = useDataSourceQuery<UserOption[]>("meetings.inviteCandidates", {}, { enabled: canSchedule });
  const candidates = Array.isArray(candidatesData) ? candidatesData : [];

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(() => toLocalInputValue(new Date(Date.now() + 15 * 60_000)));
  const [end, setEnd] = useState(() => toLocalInputValue(new Date(Date.now() + 45 * 60_000)));
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [scheduling, setScheduling] = useState(false);
  const [startingNow, setStartingNow] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);

  function invalidateMeetings() {
    queryClient.invalidateQueries({ queryKey: dataSourceQueryKey("meetings.list", {}, tenant.id, user.id) });
  }

  function toggleParticipant(id: string) {
    setParticipantIds((current) => (current.includes(id) ? current.filter((p) => p !== id) : [...current, id]));
  }

  async function handleSchedule() {
    if (!title.trim()) return;
    setScheduling(true);
    try {
      await callMutation("meeting.create", {
        title: title.trim(),
        scheduledStart: new Date(start).toISOString(),
        scheduledEnd: new Date(end).toISOString(),
        participantIds,
      });
      toast.show(`Meeting "${title.trim()}" scheduled`);
      setTitle("");
      setParticipantIds([]);
      setShowForm(false);
      invalidateMeetings();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't schedule meeting", "danger");
    } finally {
      setScheduling(false);
    }
  }

  async function handleJoin(meetingId: string) {
    setJoiningId(meetingId);
    try {
      const info = (await callMutation("meeting.getJoinInfo", { meetingId })) as { roomName: string; token: string };
      setActiveCall({ roomName: info.roomName, token: info.token });
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't join meeting", "danger");
    } finally {
      setJoiningId(null);
    }
  }

  // "Start now" is deliberately not a separate backend mechanism — same
  // meeting.create call as scheduling, just with scheduledStart = now and a
  // default 30-minute window, immediately followed by joining it.
  async function handleStartNow() {
    setStartingNow(true);
    try {
      const now = new Date();
      const meeting = (await callMutation("meeting.create", {
        title: "Quick meeting",
        scheduledStart: now.toISOString(),
        scheduledEnd: new Date(now.getTime() + 30 * 60_000).toISOString(),
        participantIds: [],
      })) as MeetingRow;
      invalidateMeetings();
      await handleJoin(meeting.id);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't start meeting", "danger");
    } finally {
      setStartingNow(false);
    }
  }

  async function handleCancel(id: string) {
    try {
      await callMutation("meeting.cancel", { id });
      invalidateMeetings();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't cancel meeting", "danger");
    }
  }

  async function handleToggleExistingParticipant(meetingId: string, userId: string, isMember: boolean) {
    try {
      await callMutation(isMember ? "meeting.removeParticipant" : "meeting.addParticipant", { meetingId, userId });
      invalidateMeetings();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update participants", "danger");
    }
  }

  function handleLeaveCall() {
    setActiveCall(null);
    invalidateMeetings();
  }

  if (activeCall) {
    return (
      <div className="fixed inset-0 z-50 bg-bg">
        <JitsiCallFrame roomName={activeCall.roomName} token={activeCall.token} onLeave={handleLeaveCall} />
      </div>
    );
  }

  const nowMs = Date.now();
  const upcoming = meetings
    .filter((m) => !m.cancelledAt && new Date(m.scheduledEnd).getTime() >= nowMs)
    .sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime());
  const past = meetings
    .filter((m) => m.cancelledAt || new Date(m.scheduledEnd).getTime() < nowMs)
    .sort((a, b) => new Date(b.scheduledStart).getTime() - new Date(a.scheduledStart).getTime());

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Meetings"
        actions={
          canSchedule && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={handleStartNow} disabled={startingNow}>
                <Icon name="videocam" size={14} />
                {startingNow ? "Starting…" : "Start now"}
              </Button>
              <Button size="sm" onClick={() => setShowForm((v) => !v)}>
                <Icon name="add" size={14} />
                Schedule
              </Button>
            </div>
          )
        }
      />

      {showForm && canSchedule && (
        <Card>
          <CardBody className="flex flex-col gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title" />
            <div className="flex gap-2">
              <label className="flex-1 text-xs text-text-muted">
                Start
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text"
                />
              </label>
              <label className="flex-1 text-xs text-text-muted">
                End
                <input
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text"
                />
              </label>
            </div>
            <Dropdown
              trigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className="inline-flex w-fit items-center gap-1 rounded-full border border-border px-2 py-1 text-xs text-text-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
                >
                  <Icon name="group" size={12} />
                  {participantIds.length > 0 ? `${participantIds.length} invited` : "Invite participants"}
                </button>
              )}
            >
              {() => (
                <div className="max-h-56 w-56 overflow-y-auto py-1">
                  {candidates.length === 0 && <div className="px-3 py-2 text-xs text-text-muted">No other tenant members found.</div>}
                  {candidates
                    .filter((c) => c.id !== user.id)
                    .map((c) => (
                      <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-text transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover">
                        <input type="checkbox" checked={participantIds.includes(c.id)} onChange={() => toggleParticipant(c.id)} className="accent-accent" />
                        {c.displayName}
                      </label>
                    ))}
                </div>
              )}
            </Dropdown>
            <Button size="sm" onClick={handleSchedule} disabled={scheduling || !title.trim()} className="w-fit">
              {scheduling ? "Scheduling…" : "Schedule meeting"}
            </Button>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="flex flex-col gap-4">
          {isPending && <SkeletonRows />}

          {!isPending && (
            <>
              <div>
                <div className="mb-2 text-xs font-medium text-text-muted">Upcoming</div>
                {upcoming.length === 0 && (
                  <EmptyStateView
                    icon="event"
                    message="No upcoming meetings."
                    action={canSchedule ? { label: "Schedule one", onClick: () => setShowForm(true) } : undefined}
                  />
                )}
                <div className="flex flex-col gap-2">
                  {upcoming.map((m) => (
                    <MeetingRowView
                      key={m.id}
                      meeting={m}
                      candidates={candidates}
                      joining={joiningId === m.id}
                      onJoin={() => handleJoin(m.id)}
                      onCancel={() => handleCancel(m.id)}
                      onToggleParticipant={(userId, isMember) => handleToggleExistingParticipant(m.id, userId, isMember)}
                    />
                  ))}
                </div>
              </div>

              {past.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-medium text-text-muted">Past</div>
                  <div className="flex flex-col gap-2">
                    {past.map((m) => (
                      <MeetingRowView
                        key={m.id}
                        meeting={m}
                        candidates={candidates}
                        joining={false}
                        onJoin={() => handleJoin(m.id)}
                        onCancel={() => handleCancel(m.id)}
                        onToggleParticipant={(userId, isMember) => handleToggleExistingParticipant(m.id, userId, isMember)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function MeetingRowView({
  meeting,
  candidates,
  joining,
  onJoin,
  onCancel,
  onToggleParticipant,
}: {
  meeting: MeetingRow;
  candidates: UserOption[];
  joining: boolean;
  onJoin: () => void;
  onCancel: () => void;
  onToggleParticipant: (userId: string, isMember: boolean) => void;
}) {
  const isPast = new Date(meeting.scheduledEnd).getTime() < Date.now();
  const canJoin = !meeting.cancelledAt && meeting.isParticipant;
  const canManage = meeting.isOrganizer && !meeting.cancelledAt;

  return (
    <div className="rounded-md border border-border bg-surface p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-text">{meeting.title}</span>
            {meeting.cancelledAt && (
              <span className="flex items-center gap-1 text-xs font-medium text-danger">
                <StatusDot tone="danger" />
                Cancelled
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-text-muted">{formatRange(meeting.scheduledStart, meeting.scheduledEnd)}</div>
          {meeting.organizerName && <div className="mt-0.5 text-xs text-text-muted">Organized by {meeting.organizerName}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canJoin && (
            <Button size="sm" onClick={onJoin} disabled={joining}>
              <Icon name="videocam" size={13} />
              {joining ? "Joining…" : "Join"}
            </Button>
          )}
          {canManage && !isPast && (
            <button type="button" onClick={onCancel} className="text-xs text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-danger">
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {meeting.participants.map((p) => (
          <Badge key={p.id}>{p.displayName}</Badge>
        ))}
        {canManage && (
          <Dropdown
            align="start"
            trigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-text-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
              >
                <Icon name="group" size={11} />
                Manage
              </button>
            )}
          >
            {() => (
              <div className="max-h-56 w-56 overflow-y-auto py-1">
                {candidates.length === 0 && <div className="px-3 py-2 text-xs text-text-muted">No other tenant members found.</div>}
                {candidates
                  .filter((c) => c.id !== meeting.organizerId)
                  .map((c) => {
                    const isMember = meeting.participants.some((p) => p.id === c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-text transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover">
                        <input type="checkbox" checked={isMember} onChange={() => onToggleParticipant(c.id, isMember)} className="accent-accent" />
                        {c.displayName}
                      </label>
                    );
                  })}
              </div>
            )}
          </Dropdown>
        )}
      </div>
    </div>
  );
}
