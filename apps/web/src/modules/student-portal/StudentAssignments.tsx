"use client";

import { z } from "zod";
import { useMemo } from "react";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
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
}

/**
 * Student Role — everything assigned to this student, in the order a student
 * cares about it.
 *
 * Grouped by urgency rather than by course, because "what do I have to do
 * next" is the question this page exists to answer; the course list is where
 * you go when you already know which class you mean.
 *
 * ⚠️ "Graded" is the completion signal, not "submitted" — this platform has
 * no student submission model (Assignment → Grade is the whole chain, and a
 * Grade is written by a teacher). The labels say "Awaiting grade" rather than
 * "Not done" so the page never claims to know something it doesn't.
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

        {!a.graded && <p className="text-xs text-text-muted">Awaiting grade</p>}
      </CardBody>
    </Card>
  );
}
