"use client";

import { z } from "zod";
import { useState } from "react";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { PageHeader } from "../../ui/PageHeader";
import { Card, CardBody } from "../../ui/Card";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { Icon } from "../../ui/Icon";
import { SkeletonRows } from "../../ui/Skeleton";
import { StudentPortalNotLinked, isNotLinkedError } from "./StudentPortalNotLinked";
import { dueLabel, dueTone } from "./due";

export const StudentCoursesSchema = z.object({ title: z.string().optional() });

interface MyCourse {
  enrollmentId: string;
  courseId: string;
  name: string;
  description: string | null;
  teacherName: string | null;
  enrolmentStatus: string;
  finalGrade: string | null;
  assignmentCount: number;
  outstandingCount: number;
  nextDueDate: string | null;
  materialsProjectId: string;
}

interface CourseDoc {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Student Role — the learner's course list.
 *
 * Deliberately not a route to `/workspace/courses/[id]`: that detail page is
 * staff-shaped (roster, gradebook, teacher reassignment) and `courses.detail`
 * refuses a student anyway, since they hold no `course:read`. Expanding a card
 * in place shows the two things a student actually opens a course for — what
 * is due, and the materials — using `myAssignments.list` and the existing
 * `documents.list`, with no new route and no new data source.
 */
export function StudentCourses() {
  const { data, isLoading, error } = useDataSourceQuery<MyCourse[]>("myCourses.list", {});
  const [openId, setOpenId] = useState<string | null>(null);

  if (isNotLinkedError(error)) return <StudentPortalNotLinked />;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader title="My Courses" description="The classes you're enrolled in this term." />

      {isLoading && <SkeletonRows rows={3} />}
      {error && !isNotLinkedError(error) && (
        <Alert tone="danger">{error instanceof Error ? error.message : "Couldn't load your courses"}</Alert>
      )}

      {!isLoading && !error && (data?.length ?? 0) === 0 && (
        <EmptyStateView
          icon="school"
          message="No courses yet. Once you're enrolled in a class, it'll appear here with its assignments and materials."
        />
      )}

      <div className="mt-5 flex flex-col gap-3">
        {(data ?? []).map((course) => (
          <CourseCard
            key={course.enrollmentId}
            course={course}
            open={openId === course.courseId}
            onToggle={() => setOpenId(openId === course.courseId ? null : course.courseId)}
          />
        ))}
      </div>
    </div>
  );
}

function CourseCard({ course, open, onToggle }: { course: MyCourse; open: boolean; onToggle: () => void }) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-text">{course.name}</h3>
              {course.enrolmentStatus === "completed" && <Badge tone="success">Completed</Badge>}
              {course.finalGrade && <Badge tone="accent">Final: {course.finalGrade}</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-text-muted">
              {course.teacherName ? `Taught by ${course.teacherName}` : "No teacher assigned yet"}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={onToggle} aria-expanded={open}>
            {open ? "Hide" : "Open"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
          <span className="text-text-muted">
            <span className="font-medium text-text">{course.outstandingCount}</span> of {course.assignmentCount} awaiting a grade
          </span>
          {course.nextDueDate && (
            <span className={dueTone(course.nextDueDate)}>
              <Icon name="calendar" size={14} /> Next due {dueLabel(course.nextDueDate)}
            </span>
          )}
        </div>

        {open && <CourseDetail course={course} />}
      </CardBody>
    </Card>
  );
}

function CourseDetail({ course }: { course: MyCourse }) {
  // Both are student-scoped sources. Materials deliberately do NOT go through
  // `documents.list`: that calls `assertProjectVisible`, which at a student's
  // scope filters projects by `ownerId` and never checks membership — see
  // `myCourseMaterials.list`'s own comment for the full reasoning.
  const assignments = useDataSourceQuery<{ id: string; title: string; courseId: string; dueDate: string | null; graded: boolean; score: number | null; maxScore: number; overdue: boolean }[]>(
    "myAssignments.list",
    {},
  );
  const docs = useDataSourceQuery<CourseDoc[]>("myCourseMaterials.list", { courseId: course.courseId });

  const mine = (assignments.data ?? []).filter((a) => a.courseId === course.courseId);

  return (
    <div className="mt-1 grid gap-5 border-t border-border pt-4 sm:grid-cols-2">
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Assignments</h4>
        {assignments.isLoading && <SkeletonRows rows={2} />}
        {!assignments.isLoading && mine.length === 0 && (
          <p className="mt-2 text-sm text-text-muted">Nothing set for this course yet.</p>
        )}
        <ul className="mt-2 flex flex-col gap-2">
          {mine.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0 text-text">{a.title}</span>
              {a.graded ? (
                <Badge tone="success">
                  {a.score}/{a.maxScore}
                </Badge>
              ) : a.overdue ? (
                <Badge tone="danger">Overdue</Badge>
              ) : (
                <span className="shrink-0 text-xs text-text-muted">{a.dueDate ? dueLabel(a.dueDate) : "No due date"}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Materials</h4>
        {docs.isLoading && <SkeletonRows rows={2} />}
        {docs.error && <p className="mt-2 text-sm text-text-muted">Materials aren&apos;t available for this course.</p>}
        {!docs.isLoading && !docs.error && (docs.data?.length ?? 0) === 0 && (
          <p className="mt-2 text-sm text-text-muted">No notes or resources posted yet.</p>
        )}
        <ul className="mt-2 flex flex-col gap-2">
          {(docs.data ?? []).map((d) => (
            <li key={d.id} className="flex items-center gap-2 text-sm text-text">
              <Icon name="description" size={15} />
              <span className="min-w-0 truncate">{d.name}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
