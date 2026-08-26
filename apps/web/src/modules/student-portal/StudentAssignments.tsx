"use client";

import { z } from "zod";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { useToast } from "../../ui/Toast";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { supabase } from "../../lib/supabase-client";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { PageHeader } from "../../ui/PageHeader";
import { Card, CardBody } from "../../ui/Card";
import { Badge } from "../../ui/Badge";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { StudentPortalNotLinked, isNotLinkedError } from "./StudentPortalNotLinked";
import { dueLabel, daysUntil } from "./due";

export const StudentAssignmentsSchema = z.object({ title: z.string().optional() });

interface MyAssignment {
  id: string;
  title: string;
  description: string | null;
  courseId: string;
  courseName: string;
  dueDate: string | null;
  maxScore: number;
  graded: boolean;
  score: number | null;
  feedback: string | null;
  overdue: boolean;
  // Documents module review — handing work in is a separate question from
  // being graded, and a student needs both answered.
  submissionStatus: "not_submitted" | "submitted" | "changes_requested" | "accepted";
  submissionTaskId: string | null;
  submittedAt: string | null;
  submittedFileName: string | null;
  teacherNote: string | null;
}

const DOCUMENTS_BUCKET = "documents";

const SUBMISSION_COPY: Record<MyAssignment["submissionStatus"], { label: string; tone: "neutral" | "info" | "warning" | "success" }> = {
  not_submitted: { label: "Not handed in", tone: "neutral" },
  submitted: { label: "Handed in", tone: "info" },
  changes_requested: { label: "Changes requested", tone: "warning" },
  accepted: { label: "Accepted", tone: "success" },
};

/**
 * Student Role — everything assigned to this student, in the order a student
 * cares about it.
 *
 * Grouped by urgency rather than by course, because "what do I have to do
 * next" is the question this page exists to answer; the course list is where
 * you go when you already know which class you mean.
 *
 * Two states, deliberately kept apart: **handed in** is the student's own
 * action, **graded** is the teacher's. Work can sit handed-in and ungraded
 * for a week, and a page that collapsed the two would tell a student who
 * submitted on time that they had done nothing.
 *
 * Handing in reuses the platform's ordinary upload: a signed URL from
 * `document.createUploadUrl` against the student's own submissions project,
 * then `assignment.submit`, which files the work as evidence on a task and
 * puts it in the teacher's review queue. No student-only storage path.
 */
export function StudentAssignments() {
  const { data, isLoading, error } = useDataSourceQuery<MyAssignment[]>("myAssignments.list", {});

  const groups = useMemo(() => {
    const all = data ?? [];
    const pending = all.filter((a) => !a.graded);
    return [
      { key: "overdue", title: "Overdue", tone: "danger" as const, items: pending.filter((a) => a.overdue) },
      {
        key: "week",
        title: "Due this week",
        tone: "warning" as const,
        items: pending.filter((a) => !a.overdue && a.dueDate && daysUntil(a.dueDate) <= 7),
      },
      {
        key: "later",
        title: "Later",
        tone: "neutral" as const,
        items: pending.filter((a) => !a.overdue && (!a.dueDate || daysUntil(a.dueDate) > 7)),
      },
      { key: "graded", title: "Graded", tone: "success" as const, items: all.filter((a) => a.graded) },
    ].filter((g) => g.items.length > 0);
  }, [data]);

  if (isNotLinkedError(error)) return <StudentPortalNotLinked />;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title="Assignments" description="Everything set across your courses, most urgent first." />

      {isLoading && <SkeletonRows rows={4} />}
      {error && !isNotLinkedError(error) && (
        <Alert tone="danger">{error instanceof Error ? error.message : "Couldn't load your assignments"}</Alert>
      )}

      {!isLoading && !error && (data?.length ?? 0) === 0 && (
        <EmptyStateView
          icon="check-square"
          message="Nothing assigned yet. When your teachers set work, it'll show up here with its deadline."
        />
      )}

      <div className="mt-5 flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.key} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-text">{group.title}</h2>
              <Badge tone={group.tone}>{group.items.length}</Badge>
            </div>
            <div className="flex flex-col gap-2">
              {group.items.map((a) => (
                <AssignmentRow key={a.id} assignment={a} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function AssignmentRow({ assignment: a }: { assignment: MyAssignment }) {
  const { callMutation } = useRenderContext();
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const submission = SUBMISSION_COPY[a.submissionStatus];

  async function handleSubmit(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setBusy(true);
    try {
      // Where this student's own work goes. Asked for rather than assumed —
      // the portal must never be handed a project id it could reuse elsewhere.
      const { projectId } = (await callMutation("assignment.submissionTarget", { assignmentId: a.id })) as { projectId: string };
      const mimeType = file.type || "application/octet-stream";
      const { path, token } = (await callMutation("document.createUploadUrl", {
        projectId,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
      })) as { path: string; token: string };

      const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).uploadToSignedUrl(path, token, file);
      if (error) throw new Error(error.message);

      await callMutation("assignment.submit", { assignmentId: a.id, storagePath: path, name: file.name, mimeType, sizeBytes: file.size });
      toast.show("Handed in", "success");
      await queryClient.invalidateQueries();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't hand that in", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-text">{a.title}</h3>
            <p className="mt-0.5 text-xs text-text-muted">{a.courseName}</p>
          </div>
          <div className="shrink-0 text-right">
            {a.graded ? (
              <Badge tone="success">
                {a.score}/{a.maxScore}
              </Badge>
            ) : a.overdue ? (
              <Badge tone="danger">Overdue{a.dueDate ? ` · due ${dueLabel(a.dueDate)}` : ""}</Badge>
            ) : (
              <span className="text-xs text-text-muted">{a.dueDate ? `Due ${dueLabel(a.dueDate)}` : "No due date"}</span>
            )}
          </div>
        </div>

        {a.description && <p className="text-sm leading-relaxed text-text-muted">{a.description}</p>}

        {a.graded && a.feedback && (
          <div className="rounded-md bg-surface-subtle px-3 py-2 text-sm text-text-muted">
            <span className="font-medium text-text">Feedback: </span>
            {a.feedback}
          </div>
        )}

        {a.teacherNote && a.submissionStatus === "changes_requested" && (
          <div className="rounded-md bg-surface-subtle px-3 py-2 text-sm text-text-muted">
            <span className="font-medium text-text">Your teacher asked for: </span>
            {a.teacherNote}
          </div>
        )}

        {!a.graded && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Badge tone={submission.tone}>{submission.label}</Badge>
              {a.submittedFileName && (
                <span className="truncate text-xs text-text-muted">
                  {a.submittedFileName}
                  {a.submittedAt ? ` · ${dueLabel(a.submittedAt)}` : ""}
                </span>
              )}
            </div>
            {a.submissionStatus !== "accepted" && (
              <>
                <Button size="sm" variant={a.submissionStatus === "not_submitted" ? "primary" : "secondary"} disabled={busy} onClick={() => fileInputRef.current?.click()}>
                  <Icon name="upload_file" size={13} />
                  {busy ? "Sending…" : a.submissionStatus === "not_submitted" ? "Hand in work" : "Hand in again"}
                </Button>
                <input ref={fileInputRef} type="file" onChange={handleSubmit} className="hidden" disabled={busy} />
              </>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
