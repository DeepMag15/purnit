import { z } from "zod";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "../../ui/Icon";
import type { CommonRenderProps } from "../../sdui/registry";
import { useDataBinding, useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { CommentThread } from "../comments/CommentThread";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { Badge } from "../../ui/Badge";
import { Dropdown } from "../../ui/Dropdown";
import { useToast } from "../../ui/Toast";

// `title` is optional, same pattern ProjectBoard already established — most
// existing usage (page.tasks) renders with none, CardHeader returns null.
export const TaskListSchema = z.object({ title: z.string().optional() });
type Props = z.infer<typeof TaskListSchema>;

interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  projectId: string;
  assigneeId: string | null;
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
// Phase 1's fixed vocabulary for the UI only, not an enforced constraint.
const STATUSES = ["todo", "in_progress", "done"];
const STATUS_TONE: Record<string, "neutral" | "info" | "success"> = { todo: "neutral", in_progress: "info", done: "success" };
// Same free-text-vocabulary treatment as STATUS_TONE — Task.priority has no
// DB-level enum either (see tasks.prisma).
const PRIORITY_TONE: Record<string, "danger" | "warning" | "neutral"> = { high: "danger", medium: "warning", low: "neutral" };

export function TaskList({ title, bind, actions }: Props & CommonRenderProps) {
  const { data, loading, error, refetch, queryKey } = useDataBinding(bind);
  const { callMutation } = useRenderContext();
  const queryClient = useQueryClient();
  const toast = useToast();

  // Presence-gated, same pattern as ProjectBoard: the create/update-status
  // controls only render if the corresponding action survived Stage 4's
  // permission pruning — the manifest already reflects what this user may
  // do, so there's no separate client-side permission check here.
  const canCreate = actions?.some((a) => a.kind === "mutation" && a.mutation === "task.create") ?? false;
  const canUpdateStatus = actions?.some((a) => a.kind === "mutation" && a.mutation === "task.updateStatus") ?? false;
  const canReassign = actions?.some((a) => a.kind === "mutation" && a.mutation === "task.reassign") ?? false;

  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedAssigneeId, setSelectedAssigneeId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // A task needs a project to belong to — fetched directly (not via `bind`)
  // since it's this composite's own UI need, not the node's data. Cached and
  // deduped against anything else on the page asking for `projects.list`
  // with the same params (CONTEXT.md §48). `projects.list` also carries each
  // project's `members` (see ProjectBoard's member-assignment UI), which the
  // assignee picker below (and the per-row reassign control) reads straight
  // off this same fetch — no second data source needed. No `project:read`
  // grant, or none exist yet, just leaves this empty — not an error state.
  const { data: projectsData } = useDataSourceQuery<ProjectOption[]>("projects.list", {}, { enabled: canCreate || canReassign });
  const projects = Array.isArray(projectsData) ? projectsData : [];

  useEffect(() => {
    if (Array.isArray(projectsData)) setSelectedProjectId((current) => current || projectsData[0]?.id || "");
  }, [projectsData]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const assigneeOptions = selectedProject?.members ?? [];

  // Reset the assignee whenever the selected project changes (or its
  // member list resolves) so a stale pick from a different project can
  // never be silently sent along.
  useEffect(() => {
    setSelectedAssigneeId((current) => (assigneeOptions.some((m) => m.id === current) ? current : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-derive when the selected project itself changes.
  }, [selectedProjectId]);

  async function handleCreate() {
    if (!newTitle.trim() || !selectedProjectId) return;
    setCreating(true);
    setCreateError(null);
    try {
      await callMutation("task.create", {
        projectId: selectedProjectId,
        title: newTitle.trim(),
        ...(selectedAssigneeId ? { assigneeId: selectedAssigneeId } : {}),
      });
      toast.show(`Task "${newTitle.trim()}" created`);
      setNewTitle("");
      refetch();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Couldn't create task");
    } finally {
      setCreating(false);
    }
  }

  // Optimistic UI (performance pass 2, CONTEXT.md §48) — representative,
  // not applied to every mutation in this codebase. Patches the cached rows
  // immediately (the status dropdown reflects the change with zero visible
  // delay) rather than waiting on the round trip; rolls back to the
  // pre-mutation snapshot if the server rejects it, then reconciles for
  // real via `refetch()` either way.
  async function handleStatusChange(taskId: string, status: string) {
    const previous = queryClient.getQueryData<TaskRow[]>(queryKey);
    queryClient.setQueryData<TaskRow[]>(queryKey, (rows) => rows?.map((t) => (t.id === taskId ? { ...t, status } : t)));
    try {
      await callMutation("task.updateStatus", { id: taskId, status });
    } catch (err) {
      queryClient.setQueryData(queryKey, previous);
      toast.show(err instanceof Error ? err.message : "Couldn't update task status", "danger");
    } finally {
      refetch();
    }
  }

  async function handleReassign(taskId: string, assigneeId: string) {
    await callMutation("task.reassign", { id: taskId, assigneeId });
    refetch();
  }

  // Comments & Mentions (CONTEXT.md §49) — mounted per row only while
  // expanded, not for every row all the time, so `comments.list` isn't
  // fetched for tasks nobody's actually looking at.
  function toggleComments(taskId: string) {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  const rows = Array.isArray(data) ? (data as TaskRow[]) : [];

  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="flex flex-col gap-3">
        {canCreate && (
          <div className="flex flex-wrap gap-2">
            <Select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
              {projects.length === 0 && <option value="">No projects yet</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Select value={selectedAssigneeId} onChange={(e) => setSelectedAssigneeId(e.target.value)} disabled={assigneeOptions.length === 0}>
              <option value="">{assigneeOptions.length === 0 ? "No members on this project yet" : "Assign to… (defaults to you)"}</option>
              {assigneeOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </Select>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="New task title"
              className="flex-1"
            />
            <Button onClick={handleCreate} disabled={creating || !newTitle.trim() || !selectedProjectId}>
              <Icon name="add" size={14} />
              {creating ? "Adding…" : "New Task"}
            </Button>
          </div>
        )}
        {createError && <Alert tone="danger">{createError}</Alert>}

        {loading && <SkeletonRows />}
        {error && <Alert tone="danger">Couldn&apos;t load tasks: {error}</Alert>}
        {!loading && !error && rows.length === 0 && <EmptyStateView message="No tasks yet." />}
        {!loading && !error && rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((task) => {
              const taskProject = projects.find((p) => p.id === task.projectId);
              const reassignOptions = taskProject?.members ?? [];
              const commentsExpanded = expandedTaskIds.has(task.id);
              return (
                <li key={task.id} className="flex flex-col gap-2 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm text-text">{task.title}</span>
                      {task.priority && <Badge tone={PRIORITY_TONE[task.priority] ?? "neutral"}>{task.priority}</Badge>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleComments(task.id)}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-text-muted transition-colors duration-150 hover:bg-surface-hover"
                      >
                        <Icon name="chat_bubble" size={11} />
                        Comments
                      </button>
                      {canReassign && (
                        <Dropdown
                          align="end"
                          trigger={({ toggle }) => (
                            <button
                              type="button"
                              onClick={toggle}
                              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-text-muted transition-colors duration-150 hover:bg-surface-hover"
                            >
                              <Icon name="group" size={11} />
                              Reassign
                            </button>
                          )}
                        >
                          {({ close }) => (
                            <div className="max-h-56 w-56 overflow-y-auto py-1">
                              {reassignOptions.length === 0 && (
                                <div className="px-3 py-2 text-xs text-text-muted">No members on this project.</div>
                              )}
                              {reassignOptions.map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => {
                                    close();
                                    void handleReassign(task.id, m.id);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-text transition-colors duration-150 hover:bg-surface-hover"
                                >
                                  {m.displayName}
                                  {task.assigneeId === m.id && <Badge tone="accent">current</Badge>}
                                </button>
                              ))}
                            </div>
                          )}
                        </Dropdown>
                      )}
                      {canUpdateStatus ? (
                        <Select value={task.status} onChange={(e) => handleStatusChange(task.id, e.target.value)} className="h-8 text-xs">
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Badge tone={STATUS_TONE[task.status] ?? "neutral"}>{task.status}</Badge>
                      )}
                    </div>
                  </div>
                  {commentsExpanded && <CommentThread entityType="task" entityId={task.id} mentionCandidates={reassignOptions} />}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
