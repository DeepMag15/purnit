"use client";

import { useParams } from "next/navigation";
import { InvoiceDetail } from "../../../../modules/invoices/InvoiceDetail";

/**
 * Finance Domain, Phase A — a dedicated per-record route, a sibling of
 * `/workspace/[pageId]/page.tsx`, same segment-depth-resolution shape as
 * `/workspace/courses/[courseId]/page.tsx` (see that route's own comment).
 */
export default function InvoiceDetailPage() {
  const params = useParams<{ invoiceId: string }>();
  return <InvoiceDetail invoiceId={params.invoiceId} />;
}
