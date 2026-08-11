"use client";

import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../ui/Icon";
import type { CommonRenderProps } from "../../sdui/registry";
import { useDataBinding, useDataSourceQuery } from "../../sdui/use-data-binding";
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
import { Select } from "../../ui/Select";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { Badge } from "../../ui/Badge";

export const CoursesWorkspaceSchema = z.object({ title: z.string().optional() });
type Props = z.infer<typeof CoursesWorkspaceSchema>;

interface CourseRow {
  id: string;
  name: string;
  status: string;
  teacherId: string | null;
  teacherName: string | null;
  enrolledCount: number;
}

interface TeacherOption {
  id: string;
  displayName: string;
}

const VIEWS: ViewOption[] = [
  { id: "board", label: "Board", icon: "view_kanban" },
  { id: "table", label: "Table", icon: "table_rows" },
  { id: "list", label: "List", icon: "view_list" },
];

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  active: "accent",
  archived: "neutral",
};

/**
 * Education Domain, Phase A — mirrors `ProjectBoard.tsx`'s exact shape
 * (Frontend Structural Redesign, Pattern B). Row click on Table/List
 * navigates to the new `/workspace/courses/[id]` detail page.
 */
export function CoursesWorkspace({ title, bind, actions }: Props & CommonRenderProps) {
  const router = useRouter();
  const { data, loading, error, refetch } = useDataBinding(bind);
  const { callMutation } = useRenderContext();
  const [view, setView] = useState("board");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newTeacherId, setNewTeacherId] = useState("");
  const { pending: creating, error: createError, run: runCreate, clearError } = useAsyncAction();
  const { fieldErrors, validate, clearFieldError } = useFormValidation<{ name: string }>({ name: required("Course name is required") });

  const canCreate = actions?.some((a) => a.kind === "mutation" && a.mutation === "course.create") ?? false;

  // A course needs a teacher option list — fetched directly (not via `bind`)
  // since it's this composite's own UI need, not the node's bound data.
  const { data: teacherOptionsData } = useDataSourceQuery<TeacherOption[]>("courses.teacherOptions", {}, { enabled: canCreate });
  const teacherOptions = Array.isArray(teacherOptionsData) ? teacherOptionsData : [];

  const rows = Array.isArray(data) ? (data as CourseRow[]) : [];
  const statusColumns = [...new Set(rows.map((c) => c.status))];

  function openCreate() {
    setNewName("");
    setNewDescription("");
    setNewTeacherId("");
    clearError();
    clearFieldError("name");
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!validate({ name: newName })) return;
    await runCreate(async () => {
      await callMutation("course.create", {
        name: newName.trim(),
        ...(newDescription ? { description: newDescription } : {}),
        ...(newTeacherId ? { teacherId: newTeacherId } : {}),
      });
      setCreateOpen(false);
      refetch();
    });
  }

  function openDetail(courseId: string) {
    router.push(`/workspace/courses/${courseId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={title ?? "Courses"}
        description="Manage your school's courses and rosters."
        actions={
          canCreate && (
            <Button onClick={openCreate}>
              <Icon name="add" size={14} />
              New Course
            </Button>
          )
        }
        viewSwitcher={<ViewSwitcher views={VIEWS} activeId={view} onChange={setView} />}
      />

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Course">
        <div className="flex flex-col gap-3">
          <Input
            label="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            error={fieldErrors.name}
            autoFocus
          />
          <Input label="Description" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
          <Select label="Teacher" value={newTeacherId} onChange={(e) => setNewTeacherId(e.target.value)}>
            <option value="">Assign teacher… (optional)</option>
            {teacherOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName}
              </option>
            ))}
          </Select>
          {createError && <Alert tone="danger">{createError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </Dialog>

      {loading && <SkeletonRows />}
      {error && <Alert tone="danger">Couldn&apos;t load courses: {error}</Alert>}
      {!loading && !error && rows.length === 0 && <EmptyStateView message="No courses yet." />}

      {!loading && !error && rows.length > 0 && view === "board" && (
        <KanbanBoard
          nodeId="courses-board-kanban"
          groupKey="status"
          labelKey="name"
          columns={statusColumns}
          updateMutation="course.updateStatus"
          updateValueKey="status"
          bind={bind}
          actions={actions}
          renderChild={() => null}
        />
      )}

      {!loading && !error && rows.length > 0 && view === "table" && (
        <Table3
          nodeId="courses-table"
          columns={["name", "status", "teacherName"]}
          sortable
          filterable
          pageSize={20}
          bind={bind}
          actions={[]}
          onRowClick={(row) => openDetail(String(row.id))}
          renderChild={() => null}
        />
      )}

      {!loading && !error && rows.length > 0 && view === "list" && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {rows.map((course) => (
            <li
              key={course.id}
              onClick={() => openDetail(course.id)}
              className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-text">{course.name}</span>
                <span className="shrink-0">
                  <Badge tone={STATUS_TONE[course.status] ?? "neutral"}>{course.status}</Badge>
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {course.teacherName && <span className="hidden text-xs text-text-muted sm:inline">{course.teacherName}</span>}
                <span className="text-xs text-text-muted">{course.enrolledCount} enrolled</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
