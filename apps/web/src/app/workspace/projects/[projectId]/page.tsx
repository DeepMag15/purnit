"use client";

import { useParams } from "next/navigation";
import { ProjectDetail } from "../../../../modules/projects/ProjectDetail";

/**
 * Frontend Structural Redesign, Phase 0 — a dedicated per-record route, a
 * sibling of `/workspace/[pageId]/page.tsx`, not a modification of it.
 * `/workspace/projects` (2 segments) still matches `[pageId]`, unaffected;
 * `/workspace/projects/<id>` (3 segments) matches here instead — standard
 * Next.js App Router segment-depth resolution, no collision.
 *
 * Unlike `[pageId]`, this route does not go through the SDUI blueprint
 * compiler/`Renderer` at all — it's a plain, hand-written composite (same
 * category as `ChatWorkspace`/`AnalyticsDashboard`/`login`/`signup`) that
 * fetches one record via a dedicated `*.detail` data source. It still
 * renders inside the exact same `workspace/layout.tsx` shell (header/
 * sidebar/breadcrumbs) as every other page, since that layout wraps every
 * route nested under `/workspace`.
 */
export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  return <ProjectDetail projectId={params.projectId} />;
}
