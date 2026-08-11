"use client";

import { z } from "zod";
import { useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../ui/Icon";
import type { CommonRenderProps } from "../../sdui/registry";
import { useDataBinding } from "../../sdui/use-data-binding";
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
import { Avatar } from "../../ui/Avatar";

export const ProjectBoardSchema = z.object({ title: z.string().optional() });
type Props = z.infer<typeof ProjectBoardSchema>;

interface MemberRef {
  id: string;
  displayName: string;
}

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  owner: string | null;
  members: MemberRef[];
}

const VIEWS: ViewOption[] = [
  { id: "board", label: "Board", icon: "view_kanban" },
  { id: "table", label: "Table", icon: "table_rows" },
  { id: "list", label: "List", icon: "view_list" },
];

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  active: "accent",
  completed: "success",
  "on-hold": "warning",
  archived: "neutral",
};

/**
 * Frontend Structural Redesign, Phase 0 — the first fully-redesigned module,
 * proving the whole new pattern end-to-end before it's copied to every
 * other module. Replaces the old single static, non-draggable
 * grouped-columns view with a real `PageHeader` + `ViewSwitcher`
 * (Board/Table/List, all bound to the exact same `projects.list` data —
 * finally adopting `KanbanBoard@1`/`Table@3`, both previously demo-only on
 * the Analytics page). Row click on Table/List navigates to the new
 * `/workspace/projects/[id]` detail page, which now owns member management,
 * Comments, and Documents — all removed from the list rows themselves for a
 * cleaner, less cluttered surface, per the approved redesign's own
 * information-hierarchy goal. `project.create`/`project.update`/
 * `project.delete` mutations are unchanged; only how they're triggered
 * changed (a Dialog instead of an inline toggle-form).
 */
export function ProjectBoard({ title, bind, actions }: Props & CommonRenderProps) {
  const router = useRouter();
  const { data, loading, error, refetch } = useDataBinding(bind);
  const { callMutation } = useRenderContext();
  const [view, setView] = useState("board");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const { pending: creating, error: createError, run: runCreate, clearError } = useAsyncAction();
  const { fieldErrors, validate, clearFieldError } = useFormValidation<{ name: string }>({ name: required("Project name is required") });

  const canCreate = actions?.some((a) => a.kind === "mutation" && a.mutation === "project.create") ?? false;
  const canDelete = actions?.some((a) => a.kind === "mutation" && a.mutation === "project.delete") ?? false;

  const rows = Array.isArray(data) ? (data as ProjectRow[]) : [];
  const statusColumns = [...new Set(rows.map((p) => p.status))];

  function openCreate() {
    setNewName("");
    clearError();
    clearFieldError("name");
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!validate({ name: newName })) return;
    await runCreate(async () => {
      await callMutation("project.create", { name: newName.trim() });
      setCreateOpen(false);
      refetch();
    });
  }

  async function handleDelete(e: MouseEvent, projectId: string) {
    e.stopPropagation();
    await callMutation("project.delete", { id: projectId });
    refetch();
  }

  function openDetail(projectId: string) {
    router.push(`/workspace/projects/${projectId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={title ?? "Projects"}
        description="Track and organize your team's work."
        actions={
          canCreate && (
            <Button onClick={openCreate}>
              <Icon name="add" size={14} />
              New Project
            </Button>
          )
        }
        viewSwitcher={<ViewSwitcher views={VIEWS} activeId={view} onChange={setView} />}
      />

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Project">
        <div className="flex flex-col gap-3">
          <Input
            label="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            error={fieldErrors.name}
            autoFocus
          />
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
      {error && <Alert tone="danger">Couldn&apos;t load projects: {error}</Alert>}
      {!loading && !error && rows.length === 0 && <EmptyStateView message="No projects yet." />}

      {!loading && !error && rows.length > 0 && view === "board" && (
        <KanbanBoard
          nodeId="projects-board-kanban"
          groupKey="status"
          labelKey="name"
          columns={statusColumns}
          updateMutation="project.update"
          updateValueKey="status"
          bind={bind}
          actions={actions}
          renderChild={() => null}
        />
      )}

      {!loading && !error && rows.length > 0 && view === "table" && (
        <Table3
          nodeId="projects-table"
          columns={["name", "status", "owner"]}
          sortable
          filterable
          pageSize={20}
          bind={bind}
          actions={canDelete ? [{ kind: "mutation", mutation: "project.delete", input: { ref: "row.id" } }] : []}
          onRowClick={(row) => openDetail(String(row.id))}
          renderChild={() => null}
        />
      )}

      {!loading && !error && rows.length > 0 && view === "list" && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {rows.map((project) => (
            <li
              key={project.id}
              onClick={() => openDetail(project.id)}
              className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-text">{project.name}</span>
                <Badge tone={STATUS_TONE[project.status] ?? "neutral"}>{project.status}</Badge>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {project.owner && <span className="hidden text-xs text-text-muted sm:inline">{project.owner}</span>}
                <div className="flex -space-x-1.5">
                  {project.members.slice(0, 3).map((m) => (
                    <Avatar key={m.id} name={m.displayName} size="sm" className="ring-2 ring-surface" />
                  ))}
                  {project.members.length > 3 && (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-hover text-[10px] font-medium text-text-muted ring-2 ring-surface">
                      +{project.members.length - 3}
                    </span>
                  )}
                </div>
                {canDelete && (
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, project.id)}
                    className="text-xs text-text-muted transition-colors duration-150 hover:text-danger"
                  >
                    <Icon name="delete" size={16} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
