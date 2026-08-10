"use client";

import { z } from "zod";
import { useState } from "react";
import type { CommonRenderProps } from "../../sdui/registry";
import { useDataBinding, useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { Badge } from "../../ui/Badge";
import { useToast } from "../../ui/Toast";

// Healthcare Domain, Phase A. Mirrors TaskList.tsx/PatientsWorkspace.tsx's
// same shape — inline booking form above a list, presence-gated controls.
export const AppointmentsWorkspaceSchema = z.object({ title: z.string().optional() });
type Props = z.infer<typeof AppointmentsWorkspaceSchema>;

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

export function AppointmentsWorkspace({ title, bind, actions }: Props & CommonRenderProps) {
  const { data, loading, error, refetch } = useDataBinding(bind);
  const { callMutation } = useRenderContext();
  const toast = useToast();

  const canCreate = actions?.some((a) => a.kind === "mutation" && a.mutation === "appointment.create") ?? false;
  const canUpdateStatus = actions?.some((a) => a.kind === "mutation" && a.mutation === "appointment.updateStatus") ?? false;

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

  const rows = Array.isArray(data) ? (data as AppointmentRow[]) : [];

  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="flex flex-col gap-3">
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

        {loading && <SkeletonRows />}
        {error && <Alert tone="danger">Couldn&apos;t load appointments: {error}</Alert>}
        {!loading && !error && rows.length === 0 && <EmptyStateView message="No appointments booked yet." />}
        {!loading && !error && rows.length > 0 && (
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
  );
}
