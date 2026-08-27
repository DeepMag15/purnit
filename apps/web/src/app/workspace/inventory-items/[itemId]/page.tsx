"use client";

import { useParams } from "next/navigation";
import { InventoryItemDetail } from "../../../../modules/inventory-items/InventoryItemDetail";

/**
 * Manufacturing Domain, Phase A — a dedicated per-record route, a sibling of
 * `/workspace/[pageId]/page.tsx`, same segment-depth-resolution shape as
 * `/workspace/clients/[clientId]/page.tsx` (see that route's own comment).
 */
export default function InventoryItemDetailPage() {
  const params = useParams<{ itemId: string }>();
  return <InventoryItemDetail itemId={params.itemId} />;
}
