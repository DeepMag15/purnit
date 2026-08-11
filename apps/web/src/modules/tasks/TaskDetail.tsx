"use client";

import { useState } from "react";
import Link from "next/link";
import { useEntityDetail } from "../../sdui/use-entity-detail";
import { DetailPageShell } from "../../ui/DetailPageShell";
import { Tabs } from "../../ui/Tabs";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Avatar } from "../../ui/Avatar";
import { Badge } from "../../ui/Badge";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { CommentThread } from "../comments/CommentThread";

interface TaskDetailData {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  projectId: string;
  projectName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  canUpdate: boolean;
}

const TABS = [
  { id: "details", label: "Details" },
  { id: "comments", label: "Comments" },
];

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  todo: "neutral",
  in_progress: "info",
  done: "success",
};

/** Frontend Structural Redesign, Phase 0 — mounted by
 * /workspace/tasks/[taskId] (see that route's own comment for why this
 * isn't an SDUI blueprint page). Deliberately simpler than ProjectDetail —
 * a Task has no members/documents of its own, just Comments. */
export function TaskDetail({ taskId }: { taskId: string }) {
  const { data, loading, error, notFound } = useEntityDetail<TaskDetailData>("task.detail", taskId);
  const [activeTab, setActiveTab] = useState("details");

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (notFound) return <EmptyStateView message="Task not found, or you don't have access to it." />;
  if (error) return <Alert tone="danger">Couldn&apos;t load task: {error}</Alert>;
  if (!data) return null;

  return (
    <DetailPageShell
      backHref="/workspace/tasks"
      backLabel="Tasks"
      title={data.title}
      status={{ label: data.status, tone: STATUS_TONE[data.status] ?? "neutral" }}
      tabs={<Tabs items={TABS} activeId={activeTab} onChange={setActiveTab} />}
      metadata={
        <Card>
          <CardHeader title="Details" />
          <CardBody className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Assignee</span>
              {data.assigneeName ? (
                <span className="flex items-center gap-1.5 text-text">
                  <Avatar name={data.assigneeName} size="sm" />
                  {data.assigneeName}
                </span>
              ) : (
                <span className="text-text">Unassigned</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Project</span>
              <Link href={`/workspace/projects/${data.projectId}`} className="truncate text-accent hover:underline">
                {data.projectName ?? "—"}
              </Link>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Priority</span>
              <Badge tone={data.priority === "high" ? "danger" : data.priority === "low" ? "neutral" : "warning"}>{data.priority}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Due date</span>
              <span className="text-text">{data.dueDate ? new Date(data.dueDate).toLocaleDateString() : "—"}</span>
            </div>
          </CardBody>
        </Card>
      }
    >
      {activeTab === "details" && (
        <Card>
          <CardHeader title="Description" />
          <CardBody>
            <p className="whitespace-pre-wrap text-sm text-text">{data.description || "No description yet."}</p>
          </CardBody>
        </Card>
      )}
      {activeTab === "comments" && <CommentThread entityType="task" entityId={taskId} mentionCandidates={data.assigneeId ? [{ id: data.assigneeId, displayName: data.assigneeName ?? "" }] : []} />}
    </DetailPageShell>
  );
}
