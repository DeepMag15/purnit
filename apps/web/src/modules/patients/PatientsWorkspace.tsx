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

// Healthcare Domain, Phase A — the platform's first non-IT blueprint
// composite. Mirrors TaskList.tsx's exact shape (inline create form above a
// list, presence-gated controls via `actions`, inline status/assignment
// dropdowns) rather than inventing a new UI pattern.
export const PatientsWorkspaceSchema = z.object({ title: z.string().optional() });
type Props = z.infer<typeof PatientsWorkspaceSchema>;

interface PatientRow {
  id: string;
  name: string;
  dateOfBirth: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  status: string;
  assignedDoctorId: string | null;
  assignedDoctorName: string | null;
  chartProjectId: string;
}

interface DoctorOption {
  id: string;
  displayName: string;
}

// Free-text `status` column, no DB-level enum (see patient.prisma) — same
// fixed-frontend-vocabulary treatment as TaskList.tsx's own STATUSES.
const STATUSES = ["active", "admitted", "discharged"];
const STATUS_TONE: Record<string, "neutral" | "info" | "success"> = { active: "neutral", admitted: "info", discharged: "success" };

export function PatientsWorkspace({ title, bind, actions }: Props & CommonRenderProps) {
  const { data, loading, error, refetch } = useDataBinding(bind);
  const { callMutation } = useRenderContext();
  const toast = useToast();

  // Presence-gated, same pattern as TaskList: the register/status/assign
  // controls only render if the corresponding action survived permission
  // pruning — the manifest already reflects what this user may do.
  const canRegister = actions?.some((a) => a.kind === "mutation" && a.mutation === "patient.register") ?? false;
  const canUpdateStatus = actions?.some((a) => a.kind === "mutation" && a.mutation === "patient.updateStatus") ?? false;
  const canAssignDoctor = actions?.some((a) => a.kind === "mutation" && a.mutation === "patient.assignDoctor") ?? false;

  const { data: doctorsData } = useDataSourceQuery<DoctorOption[]>("patients.doctorOptions", {}, { enabled: canRegister || canAssignDoctor });
  const doctors = Array.isArray(doctorsData) ? doctorsData : [];

  const [newName, setNewName] = useState("");
  const [newDob, setNewDob] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newDoctorId, setNewDoctorId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleRegister() {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await callMutation("patient.register", {
        name: newName.trim(),
        ...(newDob ? { dateOfBirth: newDob } : {}),
        ...(newPhone ? { contactPhone: newPhone } : {}),
        ...(newEmail ? { contactEmail: newEmail } : {}),
        ...(newDoctorId ? { assignedDoctorId: newDoctorId } : {}),
      });
      toast.show(`Patient "${newName.trim()}" registered`);
      setNewName("");
      setNewDob("");
      setNewPhone("");
      setNewEmail("");
      setNewDoctorId("");
      refetch();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Couldn't register patient");
    } finally {
      setCreating(false);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await callMutation("patient.updateStatus", { id, status });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update patient status", "danger");
    }
  }

  async function handleAssignDoctor(id: string, doctorId: string) {
    try {
      await callMutation("patient.assignDoctor", { id, doctorId });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't assign doctor", "danger");
    }
  }

  const rows = Array.isArray(data) ? (data as PatientRow[]) : [];

  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="flex flex-col gap-3">
        {canRegister && (
          <div className="flex flex-wrap gap-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Patient name" className="flex-1" />
            <Input type="date" value={newDob} onChange={(e) => setNewDob(e.target.value)} className="w-40" />
            <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone" className="w-36" />
            <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email" className="w-44" />
            <Select value={newDoctorId} onChange={(e) => setNewDoctorId(e.target.value)}>
              <option value="">Assign doctor…</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.displayName}
                </option>
              ))}
            </Select>
            <Button onClick={handleRegister} disabled={creating || !newName.trim()}>
              {creating ? "Registering…" : "Register Patient"}
            </Button>
          </div>
        )}
        {createError && <Alert tone="danger">{createError}</Alert>}

        {loading && <SkeletonRows />}
        {error && <Alert tone="danger">Couldn&apos;t load patients: {error}</Alert>}
        {!loading && !error && rows.length === 0 && <EmptyStateView message="No patients registered yet." />}
        {!loading && !error && rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm text-text">{p.name}</span>
                    {p.dateOfBirth && <span className="text-xs text-text-muted">{new Date(p.dateOfBirth).toLocaleDateString()}</span>}
                    {p.assignedDoctorName && <Badge tone="accent">Dr. {p.assignedDoctorName}</Badge>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canAssignDoctor && (
                      <Select value={p.assignedDoctorId ?? ""} onChange={(e) => handleAssignDoctor(p.id, e.target.value)} className="h-8 text-xs">
                        <option value="">Unassigned</option>
                        {doctors.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.displayName}
                          </option>
                        ))}
                      </Select>
                    )}
                    {canUpdateStatus ? (
                      <Select value={p.status} onChange={(e) => handleStatusChange(p.id, e.target.value)} className="h-8 text-xs">
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge tone={STATUS_TONE[p.status] ?? "neutral"}>{p.status}</Badge>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-text-muted">
                  {p.contactPhone && <span>{p.contactPhone}</span>}
                  {p.contactEmail && <span>{p.contactEmail}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
