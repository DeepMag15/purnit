"use client";

import { useParams } from "next/navigation";
import { StudentDetail } from "../../../../modules/students/StudentDetail";

/**
 * Education Domain, Phase A — a dedicated per-record route, a sibling of
 * `/workspace/[pageId]/page.tsx`, same segment-depth-resolution shape as
 * `/workspace/projects/[projectId]/page.tsx` (see that route's own comment).
 */
export default function StudentDetailPage() {
  const params = useParams<{ studentId: string }>();
  return <StudentDetail studentId={params.studentId} />;
}
