"use client";

import { useParams } from "next/navigation";
import { WorkOrderDetail } from "../../../../modules/work-orders/WorkOrderDetail";

/**
 * Manufacturing Domain, Phase A — a dedicated per-record route, a sibling of
 * `/workspace/[pageId]/page.tsx`, same segment-depth-resolution shape as
 * `/workspace/clients/[clientId]/page.tsx` (see that route's own comment).
 */
export default function WorkOrderDetailPage() {
  const params = useParams<{ woId: string }>();
  return <WorkOrderDetail workOrderId={params.woId} />;
}
