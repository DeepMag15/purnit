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
import { Select } from "../../ui/Select";
import { Dropdown } from "../../ui/Dropdown";
import { Icon } from "../../ui/Icon";
import { Skeleton } from "../../ui/Skeleton";
import { Button } from "../../ui/Button";
import { Textarea } from "../../ui/Textarea";
import { Alert } from "../../ui/Alert";
import { useToast } from "../../ui/Toast";
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
  // Projects ecosystem review — the two halves of the review step. Separate
  // flags because they are separate authorities: submitting is ownership
  // (assignee only), deciding is task:review and never the assignee.
  canSubmit: boolean;
  canReview: boolean;
  isAssignee: boolean;
  submittedAt: string | null;
  submittedByName: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
}

type ProjectMembers = { id: string; displayName: string }[];

const TABS = [
  { id: "details", label: "Details" },
  { id: "comments", label: "Comments" },
];

/** What a person may set directly. "in_review" is deliberately absent: it is
 * reached by submitting and left by a review decision, never by picking it
 * from a menu — the API refuses it either way, and offering it here would
 * promise something the server will not honour. */
const STATUSES = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];
const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  todo: "neutral",
  in_progress: "info",
  in_review: "warning",
  done: "success",
};
const STATUS_LABEL: Record<string, string> = { todo: "To do", in_progress: "In progress", in_review: "In review", done: "Done" };

/** Frontend Structural Redesign, Phase 0/1 — mounted by
 * /workspace/tasks/[taskId] (see that route's own comment for why this
 * isn't an SDUI blueprint page). Deliberately simpler than ProjectDetail —
 * a Task has no members/documents of its own, just Comments. Phase 1 adds
 * real edit capability (status change, reassign), gated on the existing
 * `canUpdate` flag — both moved here from TaskList's own now-removed
 * per-row controls, consistent with ProjectDetail's own Phase 0 member-
 * management precedent. */
export function TaskDetail({ taskId }: { taskId: string }) {
  const { data, loading, error, notFound, refetch } = useEntityDetail<TaskDetailData>("task.detail", taskId);
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("details");

  // Only fetched when the actor can actually reassign — the reassign picker
  // needs the task's own project's member list. `project.members`, not
  // `project.detail`: a reviewer can legitimately hold task:review on work
  // sitting in a project they are not themselves a member of, and asking for
  // the whole project 404s for them. The narrower source answers exactly the
  // question the picker asks, and returns [] when there is nothing to offer.
  const { data: projectData } = useDataSourceQuery<ProjectMembers>(
    "project.members",
    { projectId: data?.projectId ?? "" },
    { enabled: !!data?.canUpdate && !!data?.projectId },
  );
  const reassignOptions = projectData ?? [];

  async function handleStatusChange(status: string) {
    try {
      await callMutation("task.updateStatus", { id: taskId, status });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update task status", "danger");
    }
  }

  async function handleReassign(assigneeId: string) {
    try {
      await callMutation("task.reassign", { id: taskId, assigneeId });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't reassign task", "danger");
    }
  }

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
      status={!data.canUpdate ? { label: STATUS_LABEL[data.status] ?? data.status, tone: STATUS_TONE[data.status] ?? "neutral" } : undefined}
      actions={
        data.canUpdate && data.status !== "in_review" && (
          <Select value={data.status} onChange={(e) => handleStatusChange(e.target.value)} className="h-8 text-xs">
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        )
      }
      tabs={<Tabs items={TABS} activeId={activeTab} onChange={setActiveTab} />}
      metadata={
        <Card>
          <CardHeader title="Details" />
          <CardBody className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-text-muted">Assignee</span>
              {data.canUpdate ? (
                <Dropdown
                  align="end"
                  trigger={({ toggle }) => (
                    <button type="button" onClick={toggle} className="flex items-center gap-1.5 text-text hover:text-accent">
                      {data.assigneeName ? (
                        <>
                          <Avatar name={data.assigneeName} size="sm" />
                          {data.assigneeName}
                        </>
                      ) : (
                        "Unassigned"
                      )}
                      <Icon name="expand_more" size={16} />
                    </button>
                  )}
                >
                  {({ close }) => (
                    <div className="max-h-56 w-56 overflow-y-auto py-1">
                      {reassignOptions.length === 0 && <div className="px-3 py-2 text-xs text-text-muted">No members on this project.</div>}
                      {reassignOptions.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            close();
                            void handleReassign(m.id);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-text transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
                        >
                          {m.displayName}
                          {data.assigneeId === m.id && <Badge tone="accent">current</Badge>}
                        </button>
                      ))}
                    </div>
                  )}
                </Dropdown>
              ) : data.assigneeName ? (
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
      <ReviewPanel data={data} onDone={refetch} />

      {activeTab === "details" && (
        <Card>
          <CardHeader title="Description" />
          <CardBody>
            <p className="whitespace-pre-wrap text-sm text-text">{data.description || "No description yet."}</p>
          </CardBody>
        </Card>
      )}
      {activeTab === "comments" && (
        <CommentThread
          entityType="task"
          entityId={taskId}
          mentionCandidates={data.assigneeId ? [{ id: data.assigneeId, displayName: data.assigneeName ?? "" }] : []}
        />
      )}
    </DetailPageShell>
  );
}

/**
 * Projects ecosystem review — submit → review → approval, in the UI.
 *
 * Renders nothing at all for a task nobody is reviewing, which is most of
 * them: review is optional, and a panel on every task would make routine work
 * feel like paperwork.
 *
 * Which controls appear is decided by the server (`canSubmit` / `canReview`),
 * never by comparing ids here — the same prune-not-hide rule the rest of the
 * product follows.
 */
function ReviewPanel({ data, onDone }: { data: TaskDetailData; onDone: () => void }) {
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const inReview = data.status === "in_review";
  if (!data.canSubmit && !data.canReview && !inReview && !data.reviewedAt) return null;

  async function run(mutation: string, input: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      await callMutation(mutation, input);
      setNote("");
      toast.show(done, "success");
      onDone();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "That didn't work", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={inReview ? "warning" : data.status === "done" ? "success" : "neutral"}>
            {inReview ? "Waiting on review" : data.reviewedAt ? "Reviewed" : "Not submitted"}
          </Badge>
          {data.submittedByName && data.submittedAt && (
            <span className="text-xs text-text-muted">
              Submitted by {data.submittedByName} on {new Date(data.submittedAt).toLocaleDateString()}
            </span>
          )}
          {data.reviewedByName && data.reviewedAt && (
            <span className="text-xs text-text-muted">
              · Reviewed by {data.reviewedByName} on {new Date(data.reviewedAt).toLocaleDateString()}
            </span>
          )}
        </div>

        {data.reviewNote && (
          <p className="rounded-md bg-surface-subtle px-3 py-2 text-sm leading-relaxed text-text-muted">{data.reviewNote}</p>
        )}

        {(data.canSubmit || data.canReview) && (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={data.canReview ? "Add a note for whoever did the work (optional)" : "Anything the reviewer should know (optional)"}
              rows={2}
            />
            <div className="flex flex-wrap justify-end gap-2">
              {data.canSubmit && (
                <Button size="sm" disabled={busy} onClick={() => run("task.submitForReview", { id: data.id, note: note || undefined }, "Sent for review")}>
                  Submit for review
                </Button>
              )}
              {data.canReview && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => run("task.review", { id: data.id, decision: "request_changes", note: note || undefined }, "Changes requested")}
                  >
                    Request changes
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => run("task.review", { id: data.id, decision: "approve", note: note || undefined }, "Approved")}>
                    Approve
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {inReview && !data.canReview && data.isAssignee && (
          <p className="text-xs text-text-muted">Someone else has to review this before it can be marked done.</p>
        )}
      </CardBody>
    </Card>
  );
}
