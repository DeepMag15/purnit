"use client";

import { useParams } from "next/navigation";
import { DocumentDetail } from "../../../../modules/documents/DocumentDetail";

/** Frontend Structural Redesign, Phase 1 — see the matching comment on
 * /workspace/projects/[projectId]/page.tsx (Phase 0) for why this is a
 * plain, hand-written route rather than an SDUI blueprint page. Unlike
 * Projects/Tasks, there is no `page.documents` nav entry — this route is
 * reached only via a link from a document row (DocumentsPanel), not
 * primary navigation. */
export default function DocumentDetailPage() {
  const params = useParams<{ documentId: string }>();
  return <DocumentDetail documentId={params.documentId} />;
}
