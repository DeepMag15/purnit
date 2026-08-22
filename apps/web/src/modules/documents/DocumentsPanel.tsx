"use client";

import { useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceQuery, dataSourceQueryKey } from "../../sdui/use-data-binding";
import { supabase } from "../../lib/supabase-client";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { StatusDot, type StatusTone } from "../../ui/StatusDot";
import { Select } from "../../ui/Select";
import { SkeletonRows } from "../../ui/Skeleton";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { SearchBar } from "../../sdui/primitives/SearchBar";

const DOCUMENTS_BUCKET = "documents";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Frontend Redesign, Phase 03 — StatusDot's tone vocabulary doesn't include
// "accent"/"success" (see StatusDot.tsx), so approved/rejected/pending map
// onto the closest workflow-status equivalents instead of carrying over the
// old Badge tone values verbatim.
const APPROVAL_STATUS_TONE: Record<string, StatusTone> = {
  approved: "done",
  rejected: "danger",
  pending: "queued",
};

interface DocumentRow {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
  approvalStatus: string | null;
  uploadedById: string;
  uploadedByName: string;
  createdAt: string;
  updatedAt: string;
}

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
 * Project Documents (Core Workspace Phase 2, Submodule 1) — a plain shared
 * component, not blueprint-registered, mounted inside `ProjectDetail`'s own
 * Documents tab. Permission gating comes from `ProjectDetail`'s own
 * `data.canCreateDocuments`/etc. flags, passed down as booleans rather than
 * re-deriving from render context here.
 *
 * Frontend Structural Redesign, Phase 1 — the per-row expand toggle
 * (activity history + comments) was removed: both are now redundant with
 * the new `/workspace/documents/[id]` detail page's own Activity/Comments
 * tabs, and this panel is already mounted one level inside a detail page
 * (`ProjectDetail`), so a second nested expand-toggle for the same
 * information was real clutter. Click-to-open-file/download/upload/
 * replace/approval-status/delete all stay exactly as they were — genuinely
 * fast, primary actions worth keeping inline, not moved to the detail page.
 */
export function DocumentsPanel({
  projectId,
  canCreate,
  canUpdate,
  canDelete,
}: {
  projectId: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const { user, tenant, callMutation, aiAvailable, openAiPanel } = useRenderContext();
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const replaceTargetId = useRef<string | null>(null);

  const params = { projectId, search: search || undefined };
  const { data, isPending } = useDataSourceQuery<DocumentRow[]>("documents.list", params);
  const documents = Array.isArray(data) ? data : [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: dataSourceQueryKey("documents.list", params, tenant.id, user.id) });
  }

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.show("File exceeds the 25MB limit", "danger");
      return;
    }
    setUploading(true);
    try {
      const mimeType = file.type || "application/octet-stream";
      const { path, token } = (await callMutation("document.createUploadUrl", { projectId, fileName: file.name, mimeType, sizeBytes: file.size })) as {
        path: string;
        token: string;
      };
      const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).uploadToSignedUrl(path, token, file);
      if (error) throw new Error(error.message);
      await callMutation("document.create", { projectId, storagePath: path, name: file.name, mimeType, sizeBytes: file.size });
      toast.show(`"${file.name}" uploaded`);
      invalidate();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't upload document", "danger");
    } finally {
      setUploading(false);
    }
  }

  async function handleReplace(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const id = replaceTargetId.current;
    replaceTargetId.current = null;
    if (!file || !id) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.show("File exceeds the 25MB limit", "danger");
      return;
    }
    setUploading(true);
    try {
      const mimeType = file.type || "application/octet-stream";
      const { path, token } = (await callMutation("document.createReplaceUploadUrl", { id, fileName: file.name, mimeType, sizeBytes: file.size })) as {
        path: string;
        token: string;
      };
      const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).uploadToSignedUrl(path, token, file);
      if (error) throw new Error(error.message);
      await callMutation("document.finalizeReplace", { id, storagePath: path, mimeType, sizeBytes: file.size });
      toast.show("New version uploaded");
      invalidate();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't replace document", "danger");
    } finally {
      setUploading(false);
    }
  }

  async function handleOpen(id: string, mode: "view" | "download") {
    try {
      const { signedUrl } = (await callMutation("document.getFileUrl", { id, mode })) as { signedUrl: string };
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't open document", "danger");
    }
  }

  async function handleApprovalChange(id: string, status: string) {
    try {
      await callMutation("document.setApprovalStatus", { id, status });
      invalidate();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update approval status", "danger");
    }
  }

  async function handleDelete(id: string) {
    try {
      await callMutation("document.delete", { id });
      invalidate();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't delete document", "danger");
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface/50 p-2">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <SearchBar value={search} onChange={setSearch} placeholder="Search documents…" nodeId="documents-search" renderChild={() => null} />
        </div>
        {canCreate && (
          <>
            <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <Icon name="upload_file" size={13} />
              {uploading ? "Uploading…" : "Upload"}
            </Button>
            <input ref={fileInputRef} type="file" onChange={handleUpload} className="hidden" disabled={uploading} />
          </>
        )}
      </div>

      {isPending && <SkeletonRows />}
      {!isPending && documents.length === 0 && <EmptyStateView message="No documents yet." />}

      {!isPending && documents.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {documents.map((d) => (
            <div key={d.id} className="rounded-md border border-border bg-surface p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <button type="button" onClick={() => handleOpen(d.id, "view")} className="truncate text-left text-sm font-medium text-text hover:underline">
                    {d.name}
                  </button>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                    <span>v{d.version}</span>
                    <span>·</span>
                    <span>{formatBytes(d.sizeBytes)}</span>
                    <span>·</span>
                    <span>{d.uploadedByName}</span>
                    <span>·</span>
                    <span>{formatRelativeTime(d.updatedAt)}</span>
                    {d.approvalStatus && (
                      <span className="inline-flex items-center gap-1">
                        <StatusDot tone={APPROVAL_STATUS_TONE[d.approvalStatus] ?? "neutral"} />
                        {d.approvalStatus}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {aiAvailable && (
                    <>
                      <button
                        type="button"
                        onClick={() => openAiPanel("documents.summarize", { sourceType: "document", sourceId: d.id })}
                        title="Summarize with AI"
                        className="text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
                      >
                        <Icon name="summarize" size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openAiPanel("documents.qa", { sourceType: "document", sourceId: d.id })}
                        title="Ask AI about this document"
                        className="text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
                      >
                        <Icon name="auto_awesome" size={14} />
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => handleOpen(d.id, "download")} title="Download" className="text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-text">
                    <Icon name="download" size={14} />
                  </button>
                  {canUpdate && (
                    <button
                      type="button"
                      onClick={() => {
                        replaceTargetId.current = d.id;
                        replaceInputRef.current?.click();
                      }}
                      title="Replace"
                      className="text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
                    >
                      <Icon name="publish" size={14} />
                    </button>
                  )}
                  <Link
                    href={`/workspace/documents/${d.id}`}
                    title="View details"
                    className="text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
                  >
                    <Icon name="open_in_new" size={14} />
                  </Link>
                  {canDelete && (
                    <button type="button" onClick={() => handleDelete(d.id)} title="Delete" className="text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-danger">
                      <Icon name="delete" size={14} />
                    </button>
                  )}
                </div>
              </div>

              {canUpdate && (
                <div className="mt-1.5">
                  {d.approvalStatus === null ? (
                    <button type="button" onClick={() => handleApprovalChange(d.id, "pending")} className="text-xs text-accent hover:underline">
                      Request approval
                    </button>
                  ) : (
                    <Select value={d.approvalStatus} onChange={(e) => handleApprovalChange(d.id, e.target.value)} className="h-6 py-0 text-xs">
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </Select>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <input ref={replaceInputRef} type="file" onChange={handleReplace} className="hidden" disabled={uploading} />
    </div>
  );
}
