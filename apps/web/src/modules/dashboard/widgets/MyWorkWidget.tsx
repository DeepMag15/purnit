"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDataSourceQuery } from "../../../sdui/use-data-binding";
import { useRenderContext } from "../../../sdui/render-context";
import { Card, CardHeader, CardBody, StatusDot, type StatusTone } from "../../../ui";
import { SkeletonRows } from "../../../ui/Skeleton";
import { Alert } from "../../../ui/Alert";
import { EmptyStateView } from "../../../sdui/primitives/EmptyState";

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
}

const STATUS_TONE: Record<string, StatusTone> = { todo: "queued", in_progress: "progress", done: "done" };

function formatDue(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  const isOverdue = date.getTime() < Date.now();
  const label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return isOverdue ? `Overdue · ${label}` : `Due ${label}`;
}

/**
 * Frontend Redesign, Phase 01 — "own" scope for `task:read` already means
 * *assigned to me* (see `tasksWhere`'s own doc comment); passing
 * `assigneeId` explicitly here just narrows within whatever scope the
 * caller's role already grants, same as every other `tasks.list` caller.
 */
export function MyWorkWidget() {
  const { user } = useRenderContext();
  const router = useRouter();
  const { data, isPending, error } = useDataSourceQuery<Task[]>("tasks.list", { assigneeId: user.id });
  const tasks = (Array.isArray(data) ? data : []).filter((t) => t.status !== "done").slice(0, 6);

  return (
    <Card>
      <CardHeader
        title="My Work"
        action={
          <Link href="/workspace/page.tasks" className="text-xs font-medium text-accent hover:underline">
            View all
          </Link>
        }
      />
      <CardBody className="flex flex-col gap-1">
        {isPending && <SkeletonRows rows={3} />}
        {!isPending && error && <Alert tone="danger">Couldn&apos;t load your tasks.</Alert>}
        {!isPending && !error && tasks.length === 0 && (
          <EmptyStateView
            icon="task_alt"
            message="No open tasks assigned to you."
            action={{ label: "New Task", onClick: () => router.push("/workspace/page.tasks?compose=1") }}
          />
        )}
        {!isPending &&
          !error &&
          tasks.map((task) => (
            <Link
              key={task.id}
              href={`/workspace/tasks/${task.id}`}
              className="flex items-center gap-3 rounded-md border-t border-border px-1.5 py-2.5 text-sm transition-colors duration-[var(--duration-fast)] first:border-t-0 hover:bg-surface-hover"
            >
              <StatusDot tone={STATUS_TONE[task.status] ?? "queued"} />
              <span className="min-w-0 flex-1 truncate text-text">{task.title}</span>
              {task.priority === "high" && <StatusDot tone="danger" className="shrink-0" />}
              {task.dueDate && <span className="shrink-0 text-xs text-text-muted">{formatDue(task.dueDate)}</span>}
            </Link>
          ))}
      </CardBody>
    </Card>
  );
}
