import { z } from "zod";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "../../ui/Icon";
import type { CommonRenderProps } from "../../sdui/registry";
import { useDataBinding, useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { Badge } from "../../ui/Badge";
import { Dropdown } from "../../ui/Dropdown";
import { useToast } from "../../ui/Toast";
import { CommentThread } from "../comments/CommentThread";
import { DocumentsPanel } from "../documents/DocumentsPanel";

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

interface UserOption {
  id: string;
  displayName: string;
}

export function ProjectBoard({ title, bind, actions }: Props & CommonRenderProps) {
  const { data, loading, error, refetch, queryKey } = useDataBinding(bind);
  const { callMutation } = useRenderContext();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Presence in `actions` already reflects Stage 4's permission pruning —
  // if the user lacks project:create, this action simply isn't in the
  // manifest, so the create UI never renders. That's the prune-not-hide
  // contract extended to a composite's own controls, not just nav/actions
  // on primitives.
  const canCreate = actions?.some((a) => a.kind === "mutation" && a.mutation === "project.create") ?? false;
  const canManageMembers = actions?.some((a) => a.kind === "mutation" && a.mutation === "project.addMember") ?? false;
  const canDelete = actions?.some((a) => a.kind === "mutation" && a.mutation === "project.delete") ?? false;
  // Documents (Core Workspace Phase 2, Submodule 1) — passed down to
  // DocumentsPanel as booleans rather than re-deriving `actions` there,
  // same pattern the project-level canX flags above already establish.
  const canCreateDocuments = actions?.some((a) => a.kind === "mutation" && a.mutation === "document.create") ?? false;
  const canUpdateDocuments = actions?.some((a) => a.kind === "mutation" && a.mutation === "document.update") ?? false;
  const canDeleteDocuments = actions?.some((a) => a.kind === "mutation" && a.mutation === "document.delete") ?? false;

  // The member-picker's roster is this composite's own UI need, not the
  // node's bound data — same `useDataSourceQuery` pattern TaskList/TeamMembers
  // use for their own reference-data needs (CONTEXT.md §48), cached and
  // deduped against anything else on the page asking for `users.list` with
  // the same params. `users.list` is Admin-gated (`user:manage`), same as
  // `project:update` in practice today, so a denied fetch (no grant) just
  // leaves `tenantUsers` empty below — not surfaced as a page error.
  const { data: tenantUsersData } = useDataSourceQuery<UserOption[]>("users.list", {}, { enabled: canManageMembers });
  const tenantUsers = Array.isArray(tenantUsersData) ? tenantUsersData : [];

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      // Bypasses the generic ActionSpec `input` resolution (a static
      // BindExpr) because the project name is dynamic user input, not
      // something derivable from render context — a deliberate, documented
      // simplification, not an oversight (see Table.tsx for the
      // ActionSpec-driven pattern used where the input truly is static).
      await callMutation("project.create", { name: newName.trim() });
      toast.show(`Project "${newName.trim()}" created`);
      setNewName("");
      refetch();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Couldn't create project");
    } finally {
      setCreating(false);
    }
  }

  // Optimistic UI (performance pass 2, CONTEXT.md §48) — same pattern as
  // `TaskList`'s status change: a member checkbox should feel instant, not
  // wait on a round trip. Rolls back to the pre-mutation snapshot on error.
  async function handleToggleMember(projectId: string, userId: string, isMember: boolean) {
    const previous = queryClient.getQueryData<ProjectRow[]>(queryKey);
    queryClient.setQueryData<ProjectRow[]>(queryKey, (rows) =>
      rows?.map((p) => {
        if (p.id !== projectId) return p;
        if (isMember) return { ...p, members: p.members.filter((m) => m.id !== userId) };
        const addedUser = tenantUsers.find((u) => u.id === userId);
        return addedUser ? { ...p, members: [...p.members, { id: addedUser.id, displayName: addedUser.displayName }] } : p;
      }),
    );
    try {
      await callMutation(isMember ? "project.removeMember" : "project.addMember", { projectId, userId });
    } catch (err) {
      queryClient.setQueryData(queryKey, previous);
      toast.show(err instanceof Error ? err.message : "Couldn't update project membership", "danger");
    } finally {
      refetch();
    }
  }

  async function handleDelete(projectId: string) {
    await callMutation("project.delete", { id: projectId });
    refetch();
  }

  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="flex flex-col gap-3">
        {canCreate && (
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="New project name"
              className="flex-1"
            />
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              <Icon name="add" size={14} />
              {creating ? "Adding…" : "New Project"}
            </Button>
          </div>
        )}
        {createError && <Alert tone="danger">{createError}</Alert>}

        {loading && <SkeletonRows />}
        {error && <Alert tone="danger">Couldn&apos;t load projects: {error}</Alert>}
        {!loading && !error && (
          <BoardColumns
            projects={Array.isArray(data) ? (data as ProjectRow[]) : []}
            tenantUsers={tenantUsers}
            canManageMembers={canManageMembers}
            canDelete={canDelete}
            canCreateDocuments={canCreateDocuments}
            canUpdateDocuments={canUpdateDocuments}
            canDeleteDocuments={canDeleteDocuments}
            onToggleMember={handleToggleMember}
            onDelete={handleDelete}
          />
        )}
      </CardBody>
    </Card>
  );
}

function BoardColumns({
  projects,
  tenantUsers,
  canManageMembers,
  canDelete,
  canCreateDocuments,
  canUpdateDocuments,
  canDeleteDocuments,
  onToggleMember,
  onDelete,
}: {
  projects: ProjectRow[];
  tenantUsers: UserOption[];
  canManageMembers: boolean;
  canDelete: boolean;
  canCreateDocuments: boolean;
  canUpdateDocuments: boolean;
  canDeleteDocuments: boolean;
  onToggleMember: (projectId: string, userId: string, isMember: boolean) => void;
  onDelete: (projectId: string) => void;
}) {
  // Comments & Mentions (CONTEXT.md §49) — mounted per card only while
  // expanded, not for every card all the time, so `comments.list` isn't
  // fetched for projects nobody's actually looking at.
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set());
  function toggleComments(projectId: string) {
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  // Documents (Core Workspace Phase 2, Submodule 1) — its own, independent
  // expand toggle/state, same "only fetch when actually looking" discipline
  // as comments above, deliberately not sharing the same Set so a user can
  // expand documents without also expanding comments.
  const [expandedDocumentProjectIds, setExpandedDocumentProjectIds] = useState<Set<string>>(new Set());
  function toggleDocuments(projectId: string) {
    setExpandedDocumentProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  if (projects.length === 0) return <EmptyStateView message="No projects yet." />;

  const byStatus = new Map<string, ProjectRow[]>();
  for (const project of projects) {
    const list = byStatus.get(project.status) ?? [];
    list.push(project);
    byStatus.set(project.status, list);
  }

  return (
    <div className="flex gap-4 overflow-x-auto">
      {[...byStatus.entries()].map(([status, items]) => (
        <div key={status} className="min-w-[240px] shrink-0">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-text-muted">
            <Badge tone="accent">{status}</Badge>
            <span>{items.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {items.map((project) => (
              <div key={project.id} className="rounded-md border border-border bg-surface p-2.5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium text-text">{project.name}</div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleComments(project.id)}
                      title="Comments"
                      className="text-xs text-text-muted transition-colors duration-150 hover:text-text"
                    >
                      <Icon name="chat_bubble" size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleDocuments(project.id)}
                      title="Documents"
                      className="text-xs text-text-muted transition-colors duration-150 hover:text-text"
                    >
                      <Icon name="description" size={12} />
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => onDelete(project.id)}
                        className="text-xs text-text-muted transition-colors duration-150 hover:text-danger"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                {project.owner && <div className="mt-0.5 text-xs text-text-muted">{project.owner}</div>}

                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {project.members.map((m) => (
                    <Badge key={m.id}>{m.displayName}</Badge>
                  ))}
                  {canManageMembers && (
                    <Dropdown
                      align="start"
                      trigger={({ toggle }) => (
                        <button
                          type="button"
                          onClick={toggle}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-text-muted transition-colors duration-150 hover:bg-surface-hover"
                        >
                          <Icon name="group" size={11} />
                          {project.members.length}
                        </button>
                      )}
                    >
                      {() => (
                        <div className="max-h-56 w-56 overflow-y-auto py-1">
                          {tenantUsers.length === 0 && <div className="px-3 py-2 text-xs text-text-muted">No tenant members found.</div>}
                          {tenantUsers.map((u) => {
                            const isMember = project.members.some((m) => m.id === u.id);
                            return (
                              <label
                                key={u.id}
                                className="flex items-center gap-2 px-3 py-1.5 text-sm text-text transition-colors duration-150 hover:bg-surface-hover"
                              >
                                <input
                                  type="checkbox"
                                  checked={isMember}
                                  onChange={() => onToggleMember(project.id, u.id, isMember)}
                                  className="accent-accent"
                                />
                                {u.displayName}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </Dropdown>
                  )}
                </div>

                {expandedProjectIds.has(project.id) && (
                  <div className="mt-2">
                    <CommentThread entityType="project" entityId={project.id} mentionCandidates={project.members} />
                  </div>
                )}

                {expandedDocumentProjectIds.has(project.id) && (
                  <div className="mt-2">
                    <DocumentsPanel
                      projectId={project.id}
                      canCreate={canCreateDocuments}
                      canUpdate={canUpdateDocuments}
                      canDelete={canDeleteDocuments}
                      mentionCandidates={project.members}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
