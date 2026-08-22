"use client";

import { z } from "zod";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { Avatar } from "../../ui/Avatar";

// `title` is optional, same pattern ProjectBoard already established — most
// existing usage (page.tasks) renders with none, PageHeader falls back to
// "Tasks".
export const TaskListSchema = z.object({ title: z.string().optional() });
type Props = z.infer<typeof TaskListSchema>;

interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  projectId: string;
  assigneeId: string | null;
  dueDate: string | null;
}

interface MemberOption {
  id: string;
  displayName: string;
}

interface ProjectOption {
  id: string;
  name: string;
  members: MemberOption[];
}

// Free-text `status` column, no DB-level enum (see tasks.prisma) — this is
// this UI's own fixed vocabulary, not an enforced constraint. Reused
// directly as KanbanBoard's `columns` prop (Frontend Structural Redesign,
// Phase 1) — unlike Project.status (free-form, no fixed set), Task.status
// already has one, so the Board view always shows all three columns rather
// than deriving them from whatever's currently present in the data.
const STATUSES = ["todo", "in_progress", "done"];
const STATUS_TONE: Record<string, "neutral" | "info" | "success"> = { todo: "neutral", in_progress: "info", done: "success" };
// Same free-text-vocabulary treatment as STATUS_TONE — Task.priority has no
// DB-level enum either (see tasks.prisma).
const PRIORITY_TONE: Record<string, "danger" | "warning" | "neutral"> = { high: "danger", medium: "warning", low: "neutral" };

// Calendar & Scheduling (Core Workspace Phase 3) — fixed frontend-only
// vocabulary, same treatment as STATUSES/PRIORITY_TONE. Only offered once a
// due date is actually chosen (see the create form below).
const REMINDER_PRESETS = [
  { value: "15", label: "15 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];

const VIEWS: ViewOption[] = [
  { id: "board", label: "Board", icon: "view_kanban" },
  { id: "table", label: "Table", icon: "table_rows" },
  { id: "list", label: "List", icon: "view_list" },
];

/**
 * Frontend Structural Redesign, Phase 1 — mirrors `ProjectBoard.tsx`'s own
 * Phase 0 shape exactly: `PageHeader` + `ViewSwitcher` (Board/Table/List,
 * all bound to the same `tasks.list` data), `KanbanBoard@1` (columns from
 * the existing fixed `STATUSES` vocabulary, wired to the already-existing
 * `task.updateStatus` — no `seed.ts` change needed, unlike Projects'
 * Kanban), `Table@3`, and a `Dialog`-based create form replacing the old
 * inline row. The per-row Comments toggle, reassign `Dropdown`, and status
 * `Select` are all removed — `TaskDetail.tsx` (Phase 0) already has a
 * Comments tab, and both status-change and reassign move there too (Phase
 * 1's own `TaskDetail` extension) for the same "list rows show state, the
 * detail page is where you change it" consistency Projects already
 * established. Board-view dragging is the one exception, same as Projects.
 */
export function TaskList({ title, bind, actions }: Props & CommonRenderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data, loading, error, refetch } = useDataBinding(bind);
  const { callMutation } = useRenderContext();
  const [view, setView] = useState("board");
  const [createOpen, setCreateOpen] = useState(false);

  const canCreate = actions?.some((a) => a.kind === "mutation" && a.mutation === "task.create") ?? false;

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedAssigneeId, setSelectedAssigneeId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newReminderMinutes, setNewReminderMinutes] = useState("");
  const { pending: creating, error: createError, run: runCreate, clearError } = useAsyncAction();
  const { fieldErrors, validate, clearFieldError } = useFormValidation<{ title: string; projectId: string }>({
    title: required("Task title is required"),
    projectId: required("Choose a project"),
  });

  // A task needs a project to belong to — fetched directly (not via `bind`)
  // since it's this composite's own UI need, not the node's bound data.
  const { data: projectsData } = useDataSourceQuery<ProjectOption[]>("projects.list", {}, { enabled: canCreate });
  const projects = Array.isArray(projectsData) ? projectsData : [];

  useEffect(() => {
    if (Array.isArray(projectsData)) setSelectedProjectId((current) => current || projectsData[0]?.id || "");
  }, [projectsData]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const assigneeOptions = selectedProject?.members ?? [];

  useEffect(() => {
    setSelectedAssigneeId((current) => (assigneeOptions.some((m) => m.id === current) ? current : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-derive when the selected project itself changes.
  }, [selectedProjectId]);

  function openCreate() {
    setNewTitle("");
    setNewDueDate("");
    setNewReminderMinutes("");
    clearError();
    clearFieldError("title");
    clearFieldError("projectId");
    setCreateOpen(true);
  }

  // Frontend Redesign, Phase 01 — the dashboard's Quick Actions/AI widgets
  // and the header/Command Palette's quick-create menu all link here with
  // `?compose=1` rather than duplicating this module's own create form.
  // Runs once; the param is stripped immediately after so a refresh or
  // back-navigation doesn't reopen the dialog.
  useEffect(() => {
    if (searchParams.get("compose") === "1" && canCreate) {
      openCreate();
      router.replace("/workspace/page.tasks");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once intent; openCreate/canCreate are recreated every render but their identity isn't what this effect should react to.
  }, [searchParams]);

  async function handleCreate() {
    if (!validate({ title: newTitle, projectId: selectedProjectId })) return;
    await runCreate(async () => {
      await callMutation("task.create", {
        projectId: selectedProjectId,
        title: newTitle.trim(),
        ...(selectedAssigneeId ? { assigneeId: selectedAssigneeId } : {}),
        ...(newDueDate ? { dueDate: newDueDate } : {}),
        ...(newDueDate && newReminderMinutes ? { reminderMinutesBefore: Number(newReminderMinutes) } : {}),
      });
      setCreateOpen(false);
      refetch();
    });
  }

  function openDetail(taskId: string) {
    router.push(`/workspace/tasks/${taskId}`);
  }

  const rows = Array.isArray(data) ? (data as TaskRow[]) : [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={title ?? "Tasks"}
        description="Track and manage your team's work items."
        actions={
          canCreate && (
            <Button onClick={openCreate}>
              <Icon name="add" size={14} />
              New Task
            </Button>
          )
        }
        viewSwitcher={<ViewSwitcher views={VIEWS} activeId={view} onChange={setView} />}
      />

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Task">
        <div className="flex flex-col gap-3">
          <Select
            label="Project"
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            error={fieldErrors.projectId}
          >
            {projects.length === 0 && <option value="">No projects yet</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            label="Assignee"
            value={selectedAssigneeId}
            onChange={(e) => setSelectedAssigneeId(e.target.value)}
            disabled={assigneeOptions.length === 0}
          >
            <option value="">{assigneeOptions.length === 0 ? "No members on this project yet" : "Assign to… (defaults to you)"}</option>
            {assigneeOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </Select>
          <Input
            label="Title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            error={fieldErrors.title}
            autoFocus
          />
          <Input
            label="Due date"
            type="date"
            value={newDueDate}
            onChange={(e) => {
              setNewDueDate(e.target.value);
              if (!e.target.value) setNewReminderMinutes("");
            }}
          />
          <Select label="Reminder" value={newReminderMinutes} onChange={(e) => setNewReminderMinutes(e.target.value)} disabled={!newDueDate}>
            <option value="">No reminder</option>
            {REMINDER_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
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
      {error && <Alert tone="danger">Couldn&apos;t load tasks: {error}</Alert>}
      {!loading && !error && rows.length === 0 && <EmptyStateView message="No tasks yet." />}

      {!loading && !error && rows.length > 0 && view === "board" && (
        <KanbanBoard
          nodeId="tasks-board-kanban"
          groupKey="status"
          labelKey="title"
          columns={STATUSES}
          updateMutation="task.updateStatus"
          updateValueKey="status"
          bind={bind}
          actions={actions}
          renderChild={() => null}
        />
      )}

      {!loading && !error && rows.length > 0 && view === "table" && (
        <Table3
          nodeId="tasks-table"
          columns={["title", "status", "priority"]}
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
          {rows.map((task) => {
            const taskProject = projects.find((p) => p.id === task.projectId);
            const assignee = taskProject?.members.find((m) => m.id === task.assigneeId);
            return (
              <li
                key={task.id}
                onClick={() => openDetail(task.id)}
                className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-text">{task.title}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={PRIORITY_TONE[task.priority] ?? "neutral"}>{task.priority}</Badge>
                    {task.dueDate && (
                      <Badge tone={new Date(task.dueDate) < new Date() && task.status !== "done" ? "danger" : "neutral"}>
                        {new Date(task.dueDate).toLocaleDateString()}
                      </Badge>
                    )}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge tone={STATUS_TONE[task.status] ?? "neutral"}>{task.status}</Badge>
                  {assignee && <Avatar name={assignee.displayName} size="sm" />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
