"use client";

import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../ui/Icon";
import type { DataBinding } from "@purnit/manifest-schema";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { useAsyncAction } from "../../sdui/use-async-action";
import { useFormValidation } from "../../sdui/use-form-validation";
import { required } from "../../sdui/validators";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { KanbanBoard } from "../../sdui/primitives/KanbanBoard";
import { Table3 } from "../../sdui/primitives/Table";
import { PageHeader } from "../../ui/PageHeader";
import { ViewSwitcher, type ViewOption } from "../../ui/ViewSwitcher";
import { Dialog } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { Badge } from "../../ui/Badge";

export const StudentsWorkspaceSchema = z.object({ title: z.string().optional() });

interface StudentRow {
  id: string;
  name: string;
  status: string;
  contactEmail: string | null;
  activeEnrollmentCount: number;
}

const VIEWS: ViewOption[] = [
  { id: "board", label: "Board", icon: "view_kanban" },
  { id: "table", label: "Table", icon: "table_rows" },
  { id: "list", label: "List", icon: "view_list" },
];

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  active: "accent",
  graduated: "success",
  withdrawn: "neutral",
};

/**
 * Education Domain, Phase A — mirrors `ProjectBoard.tsx`'s exact shape
 * (Frontend Structural Redesign, Pattern B). Row click on Table/List
 * navigates to the new `/workspace/students/[id]` detail page; the Board
 * view's columns are derived from whatever statuses are actually present
 * (Student.status is free-text, no fixed enum, same treatment as
 * Project.status).
 *
 * Frontend Redesign Phase 05 — a dedicated route, replacing the generic
 * `/workspace/page.students` catch-all. `bind`/`actions` are gone;
 * `students.list` is fetched directly, `students.capabilities` (new,
 * additive, read-only) replaces `actions`. `KanbanBoard`/`Table3` below
 * still need a `bind`-shaped object and `actions` array (they call
 * `useDataBinding`/gate on `actions?.some(...)` internally) — a local
 * literal `bind` (identical shape to the old Renderer-supplied one, no
 * dynamic params either had) and a synthetic `actions` array built from the
 * real capability flag reproduce them unchanged.
 */
export function StudentsWorkspace() {
  const router = useRouter();
  const bind: DataBinding = { source: "students.list", params: {} };
  const { data, isPending, error, refetch } = useDataSourceQuery<StudentRow[]>("students.list");
  const { callMutation } = useRenderContext();
  const [view, setView] = useState("board");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDob, setNewDob] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const { pending: creating, error: createError, run: runCreate, clearError } = useAsyncAction();
  const { fieldErrors, validate, clearFieldError } = useFormValidation<{ name: string }>({ name: required("Student name is required") });

  const { data: caps } = useDataSourceQuery<{ canCreate: boolean; canUpdateStatus: boolean }>("students.capabilities");
  const canCreate = caps?.canCreate ?? false;
  const actions = caps?.canUpdateStatus ? [{ kind: "mutation" as const, mutation: "student.updateStatus", input: { const: null } }] : [];

  const rows = Array.isArray(data) ? data : [];
  const statusColumns = [...new Set(rows.map((s) => s.status))];

  function openCreate() {
    setNewName("");
    setNewDob("");
    setNewPhone("");
    setNewEmail("");
    clearError();
    clearFieldError("name");
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!validate({ name: newName })) return;
    await runCreate(async () => {
      await callMutation("student.register", {
        name: newName.trim(),
        ...(newDob ? { dateOfBirth: newDob } : {}),
        ...(newPhone ? { contactPhone: newPhone } : {}),
        ...(newEmail ? { contactEmail: newEmail } : {}),
      });
      setCreateOpen(false);
      refetch();
    });
  }

  function openDetail(studentId: string) {
    router.push(`/workspace/students/${studentId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Students"
        description="Manage your school's student records."
        actions={
          canCreate && (
            <Button onClick={openCreate}>
              <Icon name="add" size={14} />
              Register Student
            </Button>
          )
        }
        viewSwitcher={<ViewSwitcher views={VIEWS} activeId={view} onChange={setView} />}
      />

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Register Student">
        <div className="flex flex-col gap-3">
          <Input
            label="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            error={fieldErrors.name}
            autoFocus
          />
          <Input label="Date of birth" type="date" value={newDob} onChange={(e) => setNewDob(e.target.value)} />
          <Input label="Contact phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          <Input label="Contact email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          {createError && <Alert tone="danger">{createError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Registering…" : "Register"}
            </Button>
          </div>
        </div>
      </Dialog>

      {isPending && <SkeletonRows />}
      {error && <Alert tone="danger">Couldn&apos;t load students: {error.message}</Alert>}
      {!isPending && !error && rows.length === 0 && <EmptyStateView message="No students yet." />}

      {!isPending && !error && rows.length > 0 && view === "board" && (
        <KanbanBoard
          nodeId="students-board-kanban"
          groupKey="status"
          labelKey="name"
          columns={statusColumns}
          updateMutation="student.updateStatus"
          updateValueKey="status"
          bind={bind}
          actions={actions}
          renderChild={() => null}
        />
      )}

      {!isPending && !error && rows.length > 0 && view === "table" && (
        <Table3
          nodeId="students-table"
          columns={["name", "status", "contactEmail"]}
          sortable
          filterable
          pageSize={20}
          bind={bind}
          actions={[]}
          onRowClick={(row) => openDetail(String(row.id))}
          renderChild={() => null}
        />
      )}

      {!isPending && !error && rows.length > 0 && view === "list" && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {rows.map((student) => (
            <li
              key={student.id}
              onClick={() => openDetail(student.id)}
              className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-text">{student.name}</span>
                <span className="shrink-0">
                  <Badge tone={STATUS_TONE[student.status] ?? "neutral"}>{student.status}</Badge>
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {student.contactEmail && <span className="hidden text-xs text-text-muted sm:inline">{student.contactEmail}</span>}
                <span className="text-xs text-text-muted">{student.activeEnrollmentCount} enrolled</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
