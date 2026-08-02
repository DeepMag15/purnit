"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { CommonRenderProps } from "../../sdui/registry";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceQuery, dataSourceQueryKey } from "../../sdui/use-data-binding";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Badge } from "../../ui/Badge";
import { Icon } from "../../ui/Icon";
import { SkeletonRows } from "../../ui/Skeleton";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";

export const AnnouncementsWorkspaceSchema = z.object({});
type Props = z.infer<typeof AnnouncementsWorkspaceSchema>;

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  authorId: string;
  authorName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  createdAt: string;
}

interface DepartmentOption {
  id: string;
  name: string;
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
 * Core Workspace Modules, Phase 1, Submodule 4: Announcements — a
 * blueprint-registered composite, mirrors `MeetingsWorkspace`'s "manages its
 * own data via `useDataSourceQuery`" shape. `announcement.create`'s presence
 * in `actions` is the only real permission-pruned gate (who may post);
 * delete visibility is data-driven off each row's `authorId`, same
 * precedent as Meetings' isOrganizer-driven controls — `announcement.delete`
 * carries no `requiredPermission` to prune on.
 */
export function AnnouncementsWorkspace({ actions }: Props & CommonRenderProps) {
  const { user, tenant, callMutation } = useRenderContext();
  const queryClient = useQueryClient();
  const toast = useToast();

  const canPost = actions?.some((a) => a.kind === "mutation" && a.mutation === "announcement.create") ?? false;
  // Only "Company Admin"/"HR Manager" can target the whole company — every
  // other tier that holds announcement:create (Department Head, Executive)
  // only ever gets their own department/subtree back from departments.list
  // anyway, so the UI never offers a choice the backend would reject.
  const canTargetWholeCompany = user.roles.includes("Company Admin") || user.roles.includes("HR Manager");

  const { data: announcementsData, isPending } = useDataSourceQuery<AnnouncementRow[]>("announcements.list");
  const announcements = Array.isArray(announcementsData) ? announcementsData : [];

  const { data: departmentsData } = useDataSourceQuery<DepartmentOption[]>("departments.list", {}, { enabled: canPost });
  const departments = Array.isArray(departmentsData) ? departmentsData : [];

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetDepartmentId, setTargetDepartmentId] = useState("");
  const [posting, setPosting] = useState(false);

  function invalidateAnnouncements() {
    queryClient.invalidateQueries({ queryKey: dataSourceQueryKey("announcements.list", {}, tenant.id, user.id) });
  }

  async function handlePost() {
    if (!title.trim() || !body.trim()) return;
    setPosting(true);
    try {
      await callMutation("announcement.create", {
        title: title.trim(),
        body: body.trim(),
        departmentId: targetDepartmentId || undefined,
      });
      toast.show("Announcement posted");
      setTitle("");
      setBody("");
      setTargetDepartmentId("");
      setShowForm(false);
      invalidateAnnouncements();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't post announcement", "danger");
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await callMutation("announcement.delete", { id });
      invalidateAnnouncements();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't delete announcement", "danger");
    }
  }

  return (
    <Card>
      <CardHeader
        title="Announcements"
        action={
          canPost && (
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>
              <Icon name="add" size={14} />
              New Announcement
            </Button>
          )
        }
      />
      <CardBody className="flex flex-col gap-4">
        {showForm && canPost && (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Announcement title" />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your announcement…"
              rows={4}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent"
            />
            <Select value={targetDepartmentId} onChange={(e) => setTargetDepartmentId(e.target.value)}>
              {canTargetWholeCompany && <option value="">Whole company</option>}
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={handlePost} disabled={posting || !title.trim() || !body.trim()} className="w-fit">
              {posting ? "Posting…" : "Post announcement"}
            </Button>
          </div>
        )}

        {isPending && <SkeletonRows />}

        {!isPending && announcements.length === 0 && <EmptyStateView message="No announcements yet." />}

        {!isPending && announcements.length > 0 && (
          <div className="flex flex-col gap-2">
            {announcements.map((a) => (
              <div key={a.id} className="rounded-md border border-border bg-surface p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text">{a.title}</span>
                      <Badge tone="accent">{a.departmentName ?? "Company-wide"}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-text-muted">
                      {a.authorName ?? "Unknown"} · {formatRelativeTime(a.createdAt)}
                    </div>
                  </div>
                  {a.authorId === user.id && (
                    <button
                      type="button"
                      onClick={() => handleDelete(a.id)}
                      className="shrink-0 text-text-muted transition-colors duration-150 hover:text-danger"
                      title="Delete announcement"
                    >
                      <Icon name="delete" size={14} />
                    </button>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text">{a.body}</p>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
