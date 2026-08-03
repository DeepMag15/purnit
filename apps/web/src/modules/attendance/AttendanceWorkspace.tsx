"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { CommonRenderProps } from "../../sdui/registry";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceQuery, dataSourceQueryKey } from "../../sdui/use-data-binding";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Badge } from "../../ui/Badge";
import { useToast } from "../../ui/Toast";

export const AttendanceWorkspaceSchema = z.object({});
type Props = z.infer<typeof AttendanceWorkspaceSchema>;

interface AttendanceRecord {
  id: string;
  userId: string;
  date: string;
  status: string;
  note: string | null;
  markedById: string;
}

interface RosterUser {
  id: string;
  displayName: string;
  departmentId: string | null;
}

// Fixed frontend-only vocabulary, same treatment as TaskList's STATUSES.
const ATTENDANCE_STATUSES = [
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "half_day", label: "Half day" },
  { value: "absent", label: "Absent" },
];
const ATTENDANCE_STATUS_TONE: Record<string, "success" | "warning" | "info" | "danger"> = {
  present: "success",
  late: "warning",
  half_day: "info",
  absent: "danger",
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function toDateKey(d: Date | string): string {
  return startOfDay(new Date(d)).toDateString();
}

/**
 * Core Workspace Modules, Phase 3, Submodule 2: Attendance — a
 * blueprint-registered composite, mirrors CalendarWorkspace's "manages its
 * own data via useDataSourceQuery" shape. The self-mark widget is always
 * rendered (attendance:create:own is a universal floor, see seed.ts's
 * role.intern). The team roster + correction view only renders for actors
 * whose role name implies attendance:read/update beyond "own" — same
 * client-side role-name-sniffing precedent as CalendarWorkspace's
 * canBroadcast, never a fresh permission lookup.
 */
export function AttendanceWorkspace({ actions }: Props & CommonRenderProps) {
  const { user, tenant, callMutation } = useRenderContext();
  const queryClient = useQueryClient();
  const toast = useToast();

  const canCorrect = actions?.some((a) => a.kind === "mutation" && a.mutation === "attendance.correct") ?? false;
  const canViewTeam = ["Department Head", "Executive", "HR Manager", "Company Admin"].some((r) => user.roles.includes(r));

  const today = useMemo(() => startOfDay(new Date()), []);
  const todayParams = { userId: user.id, from: today.toISOString(), to: today.toISOString() };
  const { data: todayData, isPending: todayPending } = useDataSourceQuery<{ roster: RosterUser[]; records: AttendanceRecord[] }>(
    "attendance.list",
    todayParams,
  );
  const todayRecord = todayData?.records?.[0] ?? null;

  const [note, setNote] = useState("");
  const [marking, setMarking] = useState(false);

  function invalidateToday() {
    queryClient.invalidateQueries({ queryKey: dataSourceQueryKey("attendance.list", todayParams, tenant.id, user.id) });
  }

  async function handleMark(status: string) {
    setMarking(true);
    try {
      await callMutation("attendance.mark", { status, ...(note.trim() ? { note: note.trim() } : {}) });
      toast.show("Attendance marked");
      setNote("");
      invalidateToday();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't mark attendance", "danger");
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="My attendance" />
        <CardBody className="flex flex-col gap-3">
          {todayRecord && (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              Today marked as <Badge tone={ATTENDANCE_STATUS_TONE[todayRecord.status] ?? "neutral"}>{todayRecord.status.replace("_", " ")}</Badge>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {ATTENDANCE_STATUSES.map((s) => (
              <Button
                key={s.value}
                size="sm"
                variant={todayRecord?.status === s.value ? "primary" : "secondary"}
                onClick={() => handleMark(s.value)}
                disabled={marking || todayPending}
              >
                {s.label}
              </Button>
            ))}
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" className="max-w-sm" />
        </CardBody>
      </Card>

      {canViewTeam && <TeamAttendance canCorrect={canCorrect} onCorrected={invalidateToday} />}
    </div>
  );
}

function TeamAttendance({ canCorrect, onCorrected }: { canCorrect: boolean; onCorrected: () => void }) {
  const { user, tenant, callMutation } = useRenderContext();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const params = { from: selectedDate.toISOString(), to: selectedDate.toISOString() };
  const { data, isPending } = useDataSourceQuery<{ roster: RosterUser[]; records: AttendanceRecord[] }>("attendance.roster", params);

  const roster = data?.roster ?? [];
  const recordsByUser = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of data?.records ?? []) {
      if (toDateKey(r.date) === toDateKey(selectedDate)) map.set(r.userId, r);
    }
    return map;
  }, [data, selectedDate]);

  function invalidateRoster() {
    queryClient.invalidateQueries({ queryKey: dataSourceQueryKey("attendance.roster", params, tenant.id, user.id) });
  }

  return (
    <Card>
      <CardHeader
        title="Team attendance"
        action={
          <input
            type="date"
            value={selectedDate.toISOString().slice(0, 10)}
            onChange={(e) => setSelectedDate(startOfDay(new Date(e.target.value)))}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text"
          />
        }
      />
      <CardBody className="flex flex-col gap-2">
        {isPending && <div className="text-sm text-text-muted">Loading…</div>}
        {!isPending && roster.length === 0 && <div className="text-sm text-text-muted">No team members found.</div>}
        {roster.map((rosterUser) => (
          <RosterRow
            key={rosterUser.id}
            rosterUser={rosterUser}
            record={recordsByUser.get(rosterUser.id) ?? null}
            canCorrect={canCorrect}
            onCorrect={async (status, note) => {
              try {
                await callMutation("attendance.correct", { userId: rosterUser.id, date: selectedDate.toISOString(), status, ...(note ? { note } : {}) });
                toast.show(`Updated ${rosterUser.displayName}'s attendance`);
                invalidateRoster();
                onCorrected();
              } catch (err) {
                toast.show(err instanceof Error ? err.message : "Couldn't correct attendance", "danger");
              }
            }}
          />
        ))}
      </CardBody>
    </Card>
  );
}

function RosterRow({
  rosterUser,
  record,
  canCorrect,
  onCorrect,
}: {
  rosterUser: RosterUser;
  record: AttendanceRecord | null;
  canCorrect: boolean;
  onCorrect: (status: string, note: string) => Promise<void>;
}) {
  const [status, setStatus] = useState(record?.status ?? "present");
  const [note, setNote] = useState(record?.note ?? "");
  const [saving, setSaving] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm text-text">{rosterUser.displayName}</span>
      {!canCorrect && (record ? <Badge tone={ATTENDANCE_STATUS_TONE[record.status] ?? "neutral"}>{record.status.replace("_", " ")}</Badge> : <Badge>Not marked</Badge>)}
      {canCorrect && (
        <>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-32 text-xs">
            {ATTENDANCE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" className="h-8 w-40 text-xs" />
          <Button
            size="sm"
            variant="secondary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onCorrect(status, note);
              setSaving(false);
            }}
          >
            Save
          </Button>
          {record?.note && <span className="text-xs text-text-muted">{record.note}</span>}
        </>
      )}
    </div>
  );
}
