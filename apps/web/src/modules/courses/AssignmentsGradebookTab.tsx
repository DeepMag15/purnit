"use client";

import { useState } from "react";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Icon } from "../../ui/Icon";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";

interface AssignmentRow {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  maxScore: number;
}

interface GradeRow {
  studentId: string;
  studentName: string;
  gradeId: string | null;
  score: number | null;
  feedback: string | null;
  gradedByName: string | null;
  gradedAt: string | null;
}

/** Education Domain, Phase A — the gradebook UI, nested inside
 * `CourseDetail`'s own "Assignments" tab. Plain React, not SDUI-registered —
 * a nested per-assignment student table doesn't fit `Table3`'s flat-rows
 * contract, so this is hand-rolled markup, same as `Table.tsx`'s own raw-
 * table approach. Dispatches `grade.record` (first entry, `gradeId ===
 * null`) vs `grade.update` (correcting an already-graded row) per cell —
 * see grades.mutations.ts's own doc comment for why grade-entry is split
 * into two mutations. */
export function AssignmentsGradebookTab({
  courseId,
  courseName,
  canCreateAssignments,
  canUpdateAssignments,
}: {
  courseId: string;
  courseName: string;
  canCreateAssignments: boolean;
  canUpdateAssignments: boolean;
}) {
  const { callMutation, aiAvailable, openAiPanel } = useRenderContext();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newMaxScore, setNewMaxScore] = useState("100");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editing, setEditing] = useState<AssignmentRow | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editMaxScore, setEditMaxScore] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const { data, isPending, error, refetch } = useDataSourceQuery<AssignmentRow[]>("assignments.list", { courseId });
  const assignments = Array.isArray(data) ? data : [];

  function summarizeGradebook() {
    const lines = [
      `Course: ${courseName}`,
      assignments.length > 0
        ? `Assignments: ${assignments
            .map((a) => `${a.title} (${a.dueDate ? `due ${new Date(a.dueDate).toLocaleDateString()}` : "no due date"}, ${a.maxScore} pts)`)
            .join("; ")}`
        : "No assignments yet.",
    ];
    openAiPanel(
      "courses.summarizeGradebook",
      `Summarize this course's assignment load. Do not suggest a grade or evaluate any individual student.\n\n${lines.join("\n")}`,
    );
  }

  function openCreate() {
    setNewTitle("");
    setNewDescription("");
    setNewDueDate("");
    setNewMaxScore("100");
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!newTitle.trim()) {
      setCreateError("Assignment title is required");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await callMutation("assignment.create", {
        courseId,
        title: newTitle.trim(),
        ...(newDescription ? { description: newDescription } : {}),
        ...(newDueDate ? { dueDate: newDueDate } : {}),
        ...(newMaxScore ? { maxScore: Number(newMaxScore) } : {}),
      });
      setCreateOpen(false);
      refetch();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Couldn't create assignment");
    } finally {
      setCreating(false);
    }
  }

  function openEdit(a: AssignmentRow) {
    setEditing(a);
    setEditTitle(a.title);
    setEditDescription(a.description ?? "");
    setEditDueDate(a.dueDate ? a.dueDate.slice(0, 10) : "");
    setEditMaxScore(String(a.maxScore));
    setEditError(null);
  }

  async function handleSaveEdit() {
    if (!editing) return;
    if (!editTitle.trim()) {
      setEditError("Assignment title is required");
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      await callMutation("assignment.update", {
        id: editing.id,
        title: editTitle.trim(),
        description: editDescription,
        ...(editDueDate ? { dueDate: editDueDate } : {}),
        ...(editMaxScore ? { maxScore: Number(editMaxScore) } : {}),
      });
      setEditing(null);
      refetch();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Couldn't save the assignment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader
          title="Assignments"
          action={
            (aiAvailable || canCreateAssignments) && (
              <div className="flex gap-2">
                {aiAvailable && (
                  <Button size="sm" variant="secondary" onClick={summarizeGradebook}>
                    Summarize Gradebook
                  </Button>
                )}
                {canCreateAssignments && (
                  <Button size="sm" onClick={openCreate}>
                    <Icon name="add" size={14} />
                    Add Assignment
                  </Button>
                )}
              </div>
            )
          }
        />
        <CardBody>
          {isPending && <SkeletonRows />}
          {!isPending && error && (
            <Alert tone="danger">Couldn&apos;t load assignments: {error instanceof Error ? error.message : String(error)}</Alert>
          )}
          {!isPending && !error && assignments.length === 0 && <EmptyStateView message="No assignments yet." />}
          {!isPending && !error && assignments.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {assignments.map((a) => (
                <li key={a.id} className="flex flex-col">
                  <div className="flex w-full items-center gap-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{a.title}</span>
                      <span className="shrink-0 text-xs text-text-muted">
                        {a.dueDate ? `Due ${new Date(a.dueDate).toLocaleDateString()}` : "No due date"} · {a.maxScore} pts
                      </span>
                      <Icon name={expandedId === a.id ? "expand_less" : "expand_more"} size={16} />
                    </button>
                    {canUpdateAssignments && (
                      <button
                        type="button"
                        onClick={() => openEdit(a)}
                        title="Edit assignment"
                        className="shrink-0 text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
                      >
                        <Icon name="edit" size={15} />
                      </button>
                    )}
                  </div>
                  {expandedId === a.id && <GradebookTable assignment={a} />}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Add Assignment">
        <div className="flex flex-col gap-3">
          <Input
            label="Title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <Input label="Description" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
          <Input label="Due date" type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} />
          <Input label="Max score" type="number" min={1} value={newMaxScore} onChange={(e) => setNewMaxScore(e.target.value)} />
          {createError && <Alert tone="danger">{createError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title="Edit Assignment">
        <div className="flex flex-col gap-3">
          <Input
            label="Title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()}
            autoFocus
          />
          <Input label="Description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
          <Input label="Due date" type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} />
          <Input label="Max score" type="number" min={1} value={editMaxScore} onChange={(e) => setEditMaxScore(e.target.value)} />
          {editError && <Alert tone="danger">{editError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function GradebookTable({ assignment }: { assignment: AssignmentRow }) {
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const { data, isPending, error, refetch } = useDataSourceQuery<GradeRow[]>("grades.list", { assignmentId: assignment.id });
  const rows = Array.isArray(data) ? data : [];

  async function handleScoreChange(row: GradeRow, rawScore: string) {
    const score = Number(rawScore);
    if (!Number.isFinite(score)) return;
    try {
      if (row.gradeId === null) {
        await callMutation("grade.record", { assignmentId: assignment.id, studentId: row.studentId, score });
      } else {
        await callMutation("grade.update", { id: row.gradeId, score });
      }
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't save the grade", "danger");
    }
  }

  async function handleFeedbackChange(row: GradeRow, feedback: string) {
    try {
      if (row.gradeId === null) {
        if (row.score == null) return; // no score yet — nothing to attach feedback to.
        await callMutation("grade.record", { assignmentId: assignment.id, studentId: row.studentId, score: row.score, feedback });
      } else {
        await callMutation("grade.update", { id: row.gradeId, feedback });
      }
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't save the feedback", "danger");
    }
  }

  if (isPending) return <SkeletonRows />;
  if (error) return <Alert tone="danger">Couldn&apos;t load grades: {error instanceof Error ? error.message : String(error)}</Alert>;
  if (rows.length === 0) return <EmptyStateView message="No students enrolled in this course yet." />;

  return (
    <div className="overflow-x-auto pb-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-text-muted">
            <th className="py-2 pr-3 font-medium">Student</th>
            <th className="py-2 pr-3 font-medium">Score</th>
            <th className="py-2 pr-3 font-medium">Feedback</th>
            <th className="py-2 pr-3 font-medium">Graded by</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.studentId}>
              <td className="py-2 pr-3 text-text">{row.studentName}</td>
              <td className="py-2 pr-3">
                <input
                  type="number"
                  min={0}
                  max={assignment.maxScore}
                  defaultValue={row.score ?? ""}
                  onBlur={(e) => e.target.value !== "" && Number(e.target.value) !== row.score && void handleScoreChange(row, e.target.value)}
                  className="h-8 w-16 rounded-md border border-border bg-surface px-2 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                />
                <span className="ml-1 text-xs text-text-muted">/ {assignment.maxScore}</span>
              </td>
              <td className="py-2 pr-3">
                <input
                  type="text"
                  defaultValue={row.feedback ?? ""}
                  onBlur={(e) => e.target.value !== (row.feedback ?? "") && void handleFeedbackChange(row, e.target.value)}
                  className="h-8 w-full min-w-32 rounded-md border border-border bg-surface px-2 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                />
              </td>
              <td className="py-2 pr-3 text-xs text-text-muted">{row.gradedByName ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
