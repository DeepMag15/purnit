"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useEntityDetail } from "../../sdui/use-entity-detail";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { DetailPageShell } from "../../ui/DetailPageShell";
import { Tabs } from "../../ui/Tabs";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Avatar } from "../../ui/Avatar";
import { Badge } from "../../ui/Badge";
import { Select } from "../../ui/Select";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { CommentThread } from "../comments/CommentThread";

interface DocumentDetailData {
  canUpdate: boolean;
  canDelete: boolean;
  document: {
    id: string;
    projectId: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    version: number;
    approvalStatus: string | null;
    uploadedById: string;
    uploadedByName: string;
    createdAt: string;
    updatedAt: string;
  };
  versions: { id: string; version: number; mimeType: string; sizeBytes: number; createdById: string; createdByName: string; createdAt: string }[];
  activities: { id: string; type: string; detail: string | null; actorId: string; actorName: string; createdAt: string }[];
}

interface ProjectMembers {
  members: { id: string; displayName: string }[];
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "versions", label: "Versions" },
  { id: "activity", label: "Activity" },
  { id: "comments", label: "Comments" },
];

// Identical to DocumentsPanel.tsx's own copies — kept local rather than
// shared, matching this codebase's own precedent of small, per-file
// formatting helpers (AnnouncementsWorkspace/DocumentsPanel each already
// have their own copy of formatRelativeTime).
const ACTIVITY_LABELS: Record<string, string> = {
  uploaded: "uploaded this document",
  replaced: "uploaded a new version",
  renamed: "renamed this document",
  approval_status_changed: "changed the approval status",
  deleted: "deleted this document",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Frontend Structural Redesign, Phase 1 — mounted by
 * /workspace/documents/[documentId]. `DocumentsPanel` stays mounted exactly
 * as-is inside `ProjectDetail`'s own Documents tab (upload/replace/search
 * unchanged there) — this route is the "more" a document's own "view
 * details" link now points to, replacing its old inline expand-toggle
 * (activity + comments), which is now redundant with this page's own
 * Activity/Comments tabs.
 */
export function DocumentDetail({ documentId }: { documentId: string }) {
  const router = useRouter();
  const { data, loading, error, notFound, refetch } = useEntityDetail<DocumentDetailData>("document.detail", documentId);
  const { callMutation, aiAvailable, openAiPanel } = useRenderContext();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  const { data: projectData } = useDataSourceQuery<ProjectMembers>(
    "project.detail",
    { id: data?.document.projectId ?? "" },
    { enabled: !!data?.document.projectId },
  );
  const mentionCandidates = projectData?.members ?? [];

  async function handleOpen(mode: "view" | "download") {
    try {
      const { signedUrl } = (await callMutation("document.getFileUrl", { id: documentId, mode })) as { signedUrl: string };
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't open document", "danger");
    }
  }

  async function handleApprovalChange(status: string) {
    try {
      await callMutation("document.setApprovalStatus", { id: documentId, status });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update approval status", "danger");
    }
  }

  async function handleDelete() {
    if (!data) return;
    try {
      await callMutation("document.delete", { id: documentId });
      toast.show(`"${data.document.name}" deleted`);
      router.push(`/workspace/projects/${data.document.projectId}`);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't delete document", "danger");
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (notFound) return <EmptyStateView message="Document not found, or you don't have access to it." />;
  if (error) return <Alert tone="danger">Couldn&apos;t load document: {error}</Alert>;
  if (!data) return null;

  const { document, versions, activities, canUpdate, canDelete } = data;

  return (
    <DetailPageShell
      backHref={`/workspace/projects/${document.projectId}`}
      backLabel="Back to project"
      title={document.name}
      status={document.approvalStatus ? { label: document.approvalStatus, tone: document.approvalStatus === "approved" ? "success" : document.approvalStatus === "rejected" ? "danger" : "accent" } : undefined}
      actions={
        <>
          <Button size="sm" variant="secondary" onClick={() => handleOpen("view")}>
            <Icon name="visibility" size={14} />
            View
          </Button>
          <Button size="sm" variant="secondary" onClick={() => handleOpen("download")}>
            <Icon name="download" size={14} />
            Download
          </Button>
          {canDelete && (
            <Button size="sm" variant="danger" onClick={handleDelete}>
              <Icon name="delete" size={14} />
              Delete
            </Button>
          )}
        </>
      }
      tabs={<Tabs items={TABS} activeId={activeTab} onChange={setActiveTab} />}
      metadata={
        <Card>
          <CardHeader title="Details" />
          <CardBody className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Uploaded by</span>
              <span className="flex items-center gap-1.5 text-text">
                <Avatar name={document.uploadedByName} size="sm" />
                {document.uploadedByName}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Type</span>
              <span className="text-text">{document.mimeType}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Size</span>
              <span className="text-text">{formatBytes(document.sizeBytes)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Version</span>
              <span className="text-text">v{document.version}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Updated</span>
              <span className="text-text">{formatRelativeTime(document.updatedAt)}</span>
            </div>
            {canUpdate && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-muted">Approval</span>
                {document.approvalStatus === null ? (
                  <button type="button" onClick={() => handleApprovalChange("pending")} className="text-xs text-accent hover:underline">
                    Request approval
                  </button>
                ) : (
                  <Select value={document.approvalStatus} onChange={(e) => handleApprovalChange(e.target.value)} className="h-7 py-0 text-xs">
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </Select>
                )}
              </div>
            )}
            {aiAvailable && (
              <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => openAiPanel("documents.summarize", { sourceType: "document", sourceId: documentId })}
                  className="flex items-center gap-1.5 text-xs text-text-muted transition-colors duration-150 hover:text-text"
                >
                  <Icon name="summarize" size={14} />
                  Summarize with AI
                </button>
                <button
                  type="button"
                  onClick={() => openAiPanel("documents.qa", { sourceType: "document", sourceId: documentId })}
                  className="flex items-center gap-1.5 text-xs text-text-muted transition-colors duration-150 hover:text-text"
                >
                  <Icon name="auto_awesome" size={14} />
                  Ask AI about this document
                </button>
              </div>
            )}
          </CardBody>
        </Card>
      }
    >
      {activeTab === "overview" && (
        <Card>
          <CardHeader title="File" />
          <CardBody className="text-sm text-text-muted">
            {document.name} — v{document.version}, {formatBytes(document.sizeBytes)}, uploaded {formatRelativeTime(document.createdAt)}.
          </CardBody>
        </Card>
      )}

      {activeTab === "versions" && (
        <Card>
          <CardHeader title="Version history" />
          <CardBody>
            {versions.length === 0 ? (
              <EmptyStateView message="No prior versions." />
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">v{v.version}</Badge>
                      <Avatar name={v.createdByName} size="sm" />
                      <span className="text-text">{v.createdByName}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <span>{formatBytes(v.sizeBytes)}</span>
                      <span>{formatRelativeTime(v.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {activeTab === "activity" && (
        <Card>
          <CardHeader title="Activity" />
          <CardBody>
            {activities.length === 0 ? (
              <EmptyStateView message="No activity yet." />
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm text-text-muted">
                {activities.map((a) => (
                  <li key={a.id}>
                    <span className="text-text">{a.actorName}</span> {ACTIVITY_LABELS[a.type] ?? a.type}
                    {a.detail ? ` (${a.detail})` : ""} — {formatRelativeTime(a.createdAt)}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {activeTab === "comments" && <CommentThread entityType="document" entityId={documentId} mentionCandidates={mentionCandidates} />}
    </DetailPageShell>
  );
}
