"use client";

import { useParams } from "next/navigation";
import { CourseDetail } from "../../../../modules/courses/CourseDetail";

/**
 * Education Domain, Phase A — a dedicated per-record route, a sibling of
 * `/workspace/[pageId]/page.tsx`, same segment-depth-resolution shape as
 * `/workspace/projects/[projectId]/page.tsx` (see that route's own comment).
 */
export default function CourseDetailPage() {
  const params = useParams<{ courseId: string }>();
  return <CourseDetail courseId={params.courseId} />;
}
