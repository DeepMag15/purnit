"use client";

import { useState } from "react";
import Link from "next/link";
import { useEntityDetail } from "../../sdui/use-entity-detail";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { DetailPageShell } from "../../ui/DetailPageShell";
import { Tabs } from "../../ui/Tabs";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Avatar } from "../../ui/Avatar";
import { Badge } from "../../ui/Badge";
import { Icon } from "../../ui/Icon";
import { Dropdown } from "../../ui/Dropdown";
import { Skeleton, SkeletonRows } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { CommentThread } from "../comments/CommentThread";
import { DocumentsPanel } from "../documents/DocumentsPanel";

interface ProjectDetailData {
  id: string;
  name: string;
  description: string | null;
  status: string;
  owner: string | null;
  departmentName: string | null;
  members: { id: string; displayName: string }[];
  taskCount: number;
  documentCount: number;
  canUpdate: boolean;
  canDelete: boolean;
  canManageMembers: boolean;
  canCreateDocuments: boolean;
  canUpdateDocuments: boolean;
  canDeleteDocuments: boolean;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  projectId: string;
  dueDate: string | null;
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "tasks", label: "Tasks" },
  { id: "documents", label: "Documents" },
  { id: "comments", label: "Comments" },
];

/** Frontend Structural Redesign, Phase 0 — the first dedicated detail-page
 * composite, proving the DetailPageShell/useEntityDetail pattern end-to-end.
 * Mounted by the /workspace/projects/[projectId] route (a plain Next.js
 * route, not an SDUI blueprint page — see that route file's own comment). */
export function ProjectDetail({ projectId }: { projectId: string }) {
  const { data, loading, error, notFound, refetch } = useEntityDetail<ProjectDetailData>("project.detail", projectId);
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  // Only fetched for someone who can actually manage members — same
  // enabled-gating precedent ProjectBoard's own tenantUsers fetch already
  // used (users.list is Admin-gated in practice, same as project:update).
  const { data: tenantUsersData } = useDataSourceQuery<{ id: string; displayName: string }[]>(
    "users.list",
    {},
    { enabled: !!data?.canManageMembers },
  );
  const tenantUsers = Array.isArray(tenantUsersData) ? tenantUsersData : [];

  async function handleToggleMember(userId: string, isMember: boolean) {
    try {
      await callMutation(isMember ? "project.removeMember" : "project.addMember", { projectId, userId });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update project membership", "danger");
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (notFound) return <EmptyStateView message="Project not found, or you don't have access to it." />;
  if (error) return <Alert tone="danger">Couldn&apos;t load project: {error}</Alert>;
  if (!data) return null;

  return (
    <DetailPageShell
      backHref="/workspace/projects"
      backLabel="Projects"
      title={data.name}
      status={{ label: data.status, tone: "accent" }}
      tabs={<Tabs items={TABS} activeId={activeTab} onChange={setActiveTab} />}
      metadata={
        <div className="flex flex-col gap-3">
          <Card>
            <CardHeader title="Details" />
            <CardBody className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Owner</span>
                <span className="text-text">{data.owner ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Department</span>
                <span className="text-text">{data.departmentName ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Tasks</span>
                <span className="text-text">{data.taskCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Documents</span>
                <span className="text-text">{data.documentCount}</span>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Members"
              action={
                data.canManageMembers && (
                  <Dropdown
                    align="end"
                    trigger={({ toggle }) => (
                      <button type="button" onClick={toggle} className="text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-text">
                        <Icon name="person_add" size={18} />
                      </button>
                    )}
                  >
                    {() => (
                      <div className="max-h-64 w-56 overflow-y-auto py-1">
                        {tenantUsers.length === 0 && <div className="px-3 py-2 text-xs text-text-muted">No tenant members found.</div>}
                        {tenantUsers.map((u) => {
                          const isMember = data.members.some((m) => m.id === u.id);
                          return (
                            <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-text transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover">
                              <input type="checkbox" checked={isMember} onChange={() => handleToggleMember(u.id, isMember)} className="accent-accent" />
                              {u.displayName}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </Dropdown>
                )
              }
            />
            <CardBody className="flex flex-col gap-2">
              {data.members.length === 0 && <span className="text-sm text-text-muted">No members yet.</span>}
              {data.members.map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <Avatar name={m.displayName} size="sm" />
                  <span className="text-sm text-text">{m.displayName}</span>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      }
    >
      {activeTab === "overview" && (
        <Card>
          <CardHeader title="Description" />
          <CardBody>
            <p className="whitespace-pre-wrap text-sm text-text">{data.description || "No description yet."}</p>
          </CardBody>
        </Card>
      )}
      {activeTab === "tasks" && <ProjectTasksTab projectId={projectId} />}
      {activeTab === "documents" && (
        <DocumentsPanel
          projectId={projectId}
          canCreate={data.canCreateDocuments}
          canUpdate={data.canUpdateDocuments}
          canDelete={data.canDeleteDocuments}
        />
      )}
      {activeTab === "comments" && <CommentThread entityType="project" entityId={projectId} />}
    </DetailPageShell>
  );
}

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  todo: "neutral",
  in_progress: "info",
  done: "success",
};

// Reuses the already-existing tasks.list (no backend change) filtered
// client-side by projectId — same "capped result set, no real pagination
// yet" limitation tasks.list already discloses in its own doc comment; a
// task belonging to this project could in principle fall outside the
// caller's most-recent-50 visible tasks, same pre-existing trade-off every
// other tasks.list consumer already accepts.
function ProjectTasksTab({ projectId }: { projectId: string }) {
  const { data, isPending, error } = useDataSourceQuery<TaskRow[]>("tasks.list", {});
  const rows = (Array.isArray(data) ? data : []).filter((t) => t.projectId === projectId);

  return (
    <Card>
      <CardHeader title="Tasks in this project" />
      <CardBody>
        {isPending && <SkeletonRows />}
        {!isPending && error && <Alert tone="danger">Couldn&apos;t load tasks: {error instanceof Error ? error.message : String(error)}</Alert>}
        {!isPending && !error && rows.length === 0 && <EmptyStateView message="No tasks in this project yet." />}
        {!isPending && !error && rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3 py-2.5">
                <Link href={`/workspace/tasks/${task.id}`} className="min-w-0 flex-1 truncate text-sm text-text hover:text-accent">
                  {task.title}
                </Link>
                <Badge tone={STATUS_TONE[task.status] ?? "neutral"}>{task.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
