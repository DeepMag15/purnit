"use client";

import { z } from "zod";
import { useState } from "react";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { PageHeader } from "../../ui/PageHeader";
import { Card, CardBody } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { Badge } from "../../ui/Badge";
import { useToast } from "../../ui/Toast";

// Healthcare Domain, Phase A. Mirrors TaskList.tsx/PatientsWorkspace.tsx's
// same shape — inline booking form above a list, presence-gated controls.
//
// Frontend Redesign Phase 05 — a dedicated route, replacing the generic
// `/workspace/page.appointments` catch-all. `bind`/`actions` are gone;
// `appointments.list` is fetched directly (identical query — the old bind
// had no dynamic params), `appointments.capabilities` (new, additive,
// read-only) replaces `actions`.
export const AppointmentsWorkspaceSchema = z.object({ title: z.string().optional() });

interface AppointmentsCapabilities {
  canCreate: boolean;
  canUpdateStatus: boolean;
}

interface AppointmentRow {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
  notes: string | null;
}

interface PatientOption {
  id: string;
  name: string;
}

interface DoctorOption {
  id: string;
  displayName: string;
}

// Free-text `status` column, no DB-level enum (see appointment.prisma).
const STATUSES = ["scheduled", "completed", "cancelled", "no-show"];
const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "danger"> = {
  scheduled: "info",
  completed: "success",
  cancelled: "danger",
  "no-show": "neutral",
};

// Healthcare Domain, Phase D. Mirrors AnalyticsDashboard.tsx's own
// formatWidgetsForAi/"Ask AI about this dashboard" pattern exactly — the
// already-fetched `rows`, formatted client-side, zero new fetch or backend
// surface. Explicitly instructs against diagnosis/treatment suggestions in
// the prompt text itself, not just as an unread backend policy.
function formatAppointmentsForAi(rows: AppointmentRow[]): string {
  const lines = rows.map(
    (a) => `- ${a.patientName} with Dr. ${a.doctorName}, ${new Date(a.scheduledStart).toLocaleString()} (${a.status})${a.notes ? ` — ${a.notes}` : ""}`,
  );
  return `Here are the currently visible appointments. Summarize what stands out (busy periods, cancellations, no-shows) — do not suggest a diagnosis or treatment for any patient.\n\n${lines.join("\n")}`;
}

export function AppointmentsWorkspace() {
  const { data, isPending, error, refetch } = useDataSourceQuery<AppointmentRow[]>("appointments.list");
  const { callMutation, aiAvailable, openAiPanel } = useRenderContext();
  const toast = useToast();

  const { data: caps } = useDataSourceQuery<AppointmentsCapabilities>("appointments.capabilities");
  const canCreate = caps?.canCreate ?? false;
  const canUpdateStatus = caps?.canUpdateStatus ?? false;

  const { data: patientsData } = useDataSourceQuery<PatientOption[]>("patients.list", {}, { enabled: canCreate });
  const patients = Array.isArray(patientsData) ? patientsData : [];
  const { data: doctorsData } = useDataSourceQuery<DoctorOption[]>("patients.doctorOptions", {}, { enabled: canCreate });
  const doctors = Array.isArray(doctorsData) ? doctorsData : [];

  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreate() {
    if (!patientId || !doctorId || !start || !end) return;
    setCreating(true);
    setCreateError(null);
    try {
      await callMutation("appointment.create", {
        patientId,
        doctorId,
        scheduledStart: new Date(start).toISOString(),
        scheduledEnd: new Date(end).toISOString(),
        ...(notes ? { notes } : {}),
      });
      toast.show("Appointment booked");
      setPatientId("");
      setDoctorId("");
      setStart("");
      setEnd("");
      setNotes("");
      refetch();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Couldn't book appointment");
    } finally {
      setCreating(false);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await callMutation("appointment.updateStatus", { id, status });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update appointment status", "danger");
    }
  }

  const rows = Array.isArray(data) ? data : [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Appointments" />
      <Card>
        <CardBody className="flex flex-col gap-3">
        {aiAvailable && rows.length > 0 && (
          <div>
            <Button size="sm" variant="secondary" onClick={() => openAiPanel("appointments.summarize", formatAppointmentsForAi(rows))}>
              Summarize Appointments
            </Button>
          </div>
        )}
        {canCreate && (
          <div className="flex flex-wrap gap-2">
            <Select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              <option value="">Select patient…</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">Select doctor…</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.displayName}
                </option>
              ))}
            </Select>
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="w-52" />
            <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="w-52" />
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="flex-1" />
            <Button onClick={handleCreate} disabled={creating || !patientId || !doctorId || !start || !end}>
              {creating ? "Booking…" : "Book Appointment"}
            </Button>
          </div>
        )}
        {createError && <Alert tone="danger">{createError}</Alert>}

        {isPending && <SkeletonRows />}
        {error && <Alert tone="danger">Couldn&apos;t load appointments: {error.message}</Alert>}
        {!isPending && !error && rows.length === 0 && <EmptyStateView message="No appointments booked yet." />}
        {!isPending && !error && rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-text">{a.patientName}</span>
                    <span className="text-xs text-text-muted">with Dr. {a.doctorName}</span>
                  </div>
                  <span className="text-xs text-text-muted">
                    {new Date(a.scheduledStart).toLocaleString()} – {new Date(a.scheduledEnd).toLocaleTimeString()}
                  </span>
                </div>
                {canUpdateStatus ? (
                  <Select value={a.status} onChange={(e) => handleStatusChange(a.id, e.target.value)} className="h-8 text-xs">
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{a.status}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
        </CardBody>
      </Card>
    </div>
  );
}
