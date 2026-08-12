"use client";

import { useParams } from "next/navigation";
import { PurchaseOrderDetail } from "../../../../modules/purchase-orders/PurchaseOrderDetail";

/**
 * Manufacturing Domain, Phase A — a dedicated per-record route, a sibling of
 * `/workspace/[pageId]/page.tsx`, same segment-depth-resolution shape as
 * `/workspace/clients/[clientId]/page.tsx` (see that route's own comment).
 */
export default function PurchaseOrderDetailPage() {
  const params = useParams<{ poId: string }>();
  return <PurchaseOrderDetail purchaseOrderId={params.poId} />;
}
