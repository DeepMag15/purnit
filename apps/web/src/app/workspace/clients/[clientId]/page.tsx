"use client";

import { useParams } from "next/navigation";
import { ClientDetail } from "../../../../modules/clients/ClientDetail";

/**
 * Finance Domain, Phase A — a dedicated per-record route, a sibling of
 * `/workspace/[pageId]/page.tsx`, same segment-depth-resolution shape as
 * `/workspace/courses/[courseId]/page.tsx` (see that route's own comment).
 */
export default function ClientDetailPage() {
  const params = useParams<{ clientId: string }>();
  return <ClientDetail clientId={params.clientId} />;
}
