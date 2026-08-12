"use client";

import { useParams } from "next/navigation";
import { SupplierDetail } from "../../../../modules/suppliers/SupplierDetail";

/**
 * Manufacturing Domain, Phase A — a dedicated per-record route, a sibling of
 * `/workspace/[pageId]/page.tsx`, same segment-depth-resolution shape as
 * `/workspace/clients/[clientId]/page.tsx` (see that route's own comment).
 */
export default function SupplierDetailPage() {
  const params = useParams<{ supplierId: string }>();
  return <SupplierDetail supplierId={params.supplierId} />;
}
