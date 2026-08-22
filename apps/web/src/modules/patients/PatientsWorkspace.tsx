"use client";

import { z } from "zod";
import { useState } from "react";
import { Icon } from "../../ui/Icon";
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
import { DocumentsPanel } from "../documents/DocumentsPanel";

// Healthcare Domain, Phase A — the platform's first non-IT blueprint
// composite. Mirrors TaskList.tsx's exact shape (inline create form above a
// list, presence-gated controls, inline status/assignment dropdowns) rather
// than inventing a new UI pattern.
//
// Frontend Redesign Phase 05 — a dedicated route, replacing the generic
// `/workspace/page.patients` catch-all. `bind`/`actions` (the old
// Renderer-supplied data binding + mutation-presence list) are gone;
// `patients.list` is now fetched directly (identical query — the old bind
// was `{source: "patients.list", params: {}}`, no dynamic params), and
// `patients.capabilities` (new, additive, read-only) replaces `actions`.
export const PatientsWorkspaceSchema = z.object({ title: z.string().optional() });

interface PatientsCapabilities {
  canRegisterPatient: boolean;
  canUpdatePatient: boolean;
  canCreateDocuments: boolean;
  canUpdateDocuments: boolean;
  canDeleteDocuments: boolean;
}

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
  chartVisible: boolean;
}

interface PatientDocumentRow {
  id: string;
  name: string;
  approvalStatus: string;
}

// Healthcare Domain, Phase D. A separate component (not inline in the
// PatientRow map) so its own `useDataSourceQuery` call obeys the Rules of
// Hooks — mounted only while a chart-visible row is expanded, never called
// conditionally inside the variable-length row map itself.
function PatientChartSection({
  patient,
  canCreateDocuments,
  canUpdateDocuments,
  canDeleteDocuments,
  aiAvailable,
  openAiPanel,
}: {
  patient: PatientRow;
  canCreateDocuments: boolean;
  canUpdateDocuments: boolean;
  canDeleteDocuments: boolean;
  aiAvailable: boolean;
  openAiPanel: (preset?: string, context?: unknown) => void;
}) {
  // Same query key DocumentsPanel fetches internally below — deduplicated by
  // the existing TanStack Query cache layer (CONTEXT.md §48), not a second
  // network request.
  const { data } = useDataSourceQuery<PatientDocumentRow[]>("documents.list", { projectId: patient.chartProjectId });
  const documents = Array.isArray(data) ? data : [];

  function summarizeNotes() {
    const lines = [
      `Patient: ${patient.name}`,
      patient.dateOfBirth ? `DOB: ${new Date(patient.dateOfBirth).toLocaleDateString()}` : null,
      `Status: ${patient.status}`,
      patient.assignedDoctorName ? `Assigned doctor: Dr. ${patient.assignedDoctorName}` : null,
      documents.length > 0
        ? `Documents on file: ${documents.map((d) => `${d.name} (${d.approvalStatus})`).join(", ")}`
        : "No documents on file yet.",
    ].filter((line): line is string => !!line);
    openAiPanel("patients.summarizeNotes", `Summarize this patient's record. Do not suggest a diagnosis or treatment.\n\n${lines.join("\n")}`);
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {aiAvailable && (
        <Button size="sm" variant="secondary" onClick={summarizeNotes}>
          Summarize Patient Notes
        </Button>
      )}
      <DocumentsPanel projectId={patient.chartProjectId} canCreate={canCreateDocuments} canUpdate={canUpdateDocuments} canDelete={canDeleteDocuments} />
    </div>
  );
}

interface DoctorOption {
  id: string;
  displayName: string;
}

// Free-text `status` column, no DB-level enum (see patient.prisma) — same
// fixed-frontend-vocabulary treatment as TaskList.tsx's own STATUSES.
const STATUSES = ["active", "admitted", "discharged"];
const STATUS_TONE: Record<string, "neutral" | "info" | "success"> = { active: "neutral", admitted: "info", discharged: "success" };

export function PatientsWorkspace() {
  const { data, isPending, error, refetch } = useDataSourceQuery<PatientRow[]>("patients.list");
  const { callMutation, aiAvailable, openAiPanel } = useRenderContext();
  const toast = useToast();

  const { data: caps } = useDataSourceQuery<PatientsCapabilities>("patients.capabilities");
  const canRegister = caps?.canRegisterPatient ?? false;
  const canUpdateStatus = caps?.canUpdatePatient ?? false;
  const canAssignDoctor = caps?.canUpdatePatient ?? false;
  const canCreateDocuments = caps?.canCreateDocuments ?? false;
  const canUpdateDocuments = caps?.canUpdateDocuments ?? false;
  const canDeleteDocuments = caps?.canDeleteDocuments ?? false;

  // Chart-visible-gated expand toggle — same shape as ProjectBoard.tsx's
  // expandedDocumentProjectIds. Only rendered for rows the server already
  // marked chartVisible (patient:read does not imply project:read — see
  // patients.data-sources.ts's withChartVisibility doc comment).
  const [expandedPatientIds, setExpandedPatientIds] = useState<Set<string>>(new Set());
  function toggleChart(id: string) {
    setExpandedPatientIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  const rows = Array.isArray(data) ? data : [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Patients" />
      <Card>
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

        {isPending && <SkeletonRows />}
        {error && <Alert tone="danger">Couldn&apos;t load patients: {error.message}</Alert>}
        {!isPending && !error && rows.length === 0 && <EmptyStateView message="No patients registered yet." />}
        {!isPending && !error && rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm text-text">{p.name}</span>
                    {p.dateOfBirth && <span className="text-xs text-text-muted">{new Date(p.dateOfBirth).toLocaleDateString()}</span>}
                    {p.assignedDoctorName && <Badge tone="accent">Dr. {p.assignedDoctorName}</Badge>}
                    {p.chartVisible && (
                      <button
                        type="button"
                        onClick={() => toggleChart(p.id)}
                        title="Medical Record"
                        className="text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
                      >
                        <Icon name="description" size={14} />
                      </button>
                    )}
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
                {p.chartVisible && expandedPatientIds.has(p.id) && (
                  <PatientChartSection
                    patient={p}
                    canCreateDocuments={canCreateDocuments}
                    canUpdateDocuments={canUpdateDocuments}
                    canDeleteDocuments={canDeleteDocuments}
                    aiAvailable={aiAvailable}
                    openAiPanel={openAiPanel}
                  />
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
