"use client";

import { useParams } from "next/navigation";
import { TaskDetail } from "../../../../modules/tasks/TaskDetail";

/** Frontend Structural Redesign, Phase 0 — see the matching comment on
 * /workspace/projects/[projectId]/page.tsx for why this is a plain,
 * hand-written route rather than an SDUI blueprint page. */
export default function TaskDetailPage() {
  const params = useParams<{ taskId: string }>();
  return <TaskDetail taskId={params.taskId} />;
}
