"use client";

import { z } from "zod";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { PageHeader } from "../../ui/PageHeader";
import { Card, CardBody, CardHeader } from "../../ui/Card";
import { Badge } from "../../ui/Badge";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { StudentPortalNotLinked, isNotLinkedError } from "./StudentPortalNotLinked";

export const StudentProgressSchema = z.object({ title: z.string().optional() });

interface CourseProgress {
  courseId: string;
  courseName: string;
  assignmentCount: number;
  gradedCount: number;
  averagePercent: number | null;
  finalGrade: string | null;
  enrolmentStatus: string;
}

interface Progress {
  studentName: string;
  courseCount: number;
  assignmentCount: number;
  gradedCount: number;
  overallPercent: number | null;
  attendanceRecorded: number;
  attendancePercent: number | null;
  perCourse: CourseProgress[];
}

/**
 * Student Role — a student's own academic picture.
 *
 * Every number here is averaged over **graded work only**. Counting ungraded
 * assignments as zero would show a student failing a course they are simply
 * early in, which is both wrong and demoralising. Where nothing is graded yet
 * the page says so rather than showing 0%.
 */
export function StudentProgress() {
  const { data, isLoading, error } = useDataSourceQuery<Progress>("myProgress.get", {});

  if (isNotLinkedError(error)) return <StudentPortalNotLinked />;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title="My Progress" description="How you're tracking across your courses so far." />

      {isLoading && <SkeletonRows rows={4} />}
      {error && !isNotLinkedError(error) && (
        <Alert tone="danger">{error instanceof Error ? error.message : "Couldn't load your progress"}</Alert>
      )}

      {data && (
        <div className="mt-5 flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Overall average"
              value={data.overallPercent === null ? "—" : `${data.overallPercent}%`}
              hint={data.gradedCount === 0 ? "Nothing graded yet" : `Across ${data.gradedCount} graded assignment${data.gradedCount === 1 ? "" : "s"}`}
            />
            <StatCard
              label="Attendance"
              value={data.attendancePercent === null ? "—" : `${data.attendancePercent}%`}
              hint={data.attendanceRecorded === 0 ? "No days recorded yet" : `${data.attendanceRecorded} day${data.attendanceRecorded === 1 ? "" : "s"} recorded`}
            />
            <StatCard
              label="Courses"
              value={String(data.courseCount)}
              hint={`${data.assignmentCount} assignment${data.assignmentCount === 1 ? "" : "s"} set`}
            />
          </div>

          <Card>
            <CardHeader title="By course" />
            <CardBody className="p-0">
              {data.perCourse.length === 0 ? (
                <div className="px-5 py-6">
                  <EmptyStateView
                    icon="school"
                    message="Your progress will appear here once you're enrolled and your work starts being graded."
                  />
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {data.perCourse.map((c) => (
                    <li key={c.courseId} className="flex items-center justify-between gap-4 px-5 py-3.5">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-text">{c.courseName}</span>
                          {c.enrolmentStatus === "completed" && <Badge tone="success">Completed</Badge>}
                          {c.finalGrade && <Badge tone="accent">Final: {c.finalGrade}</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {c.gradedCount} of {c.assignmentCount} graded
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        {c.averagePercent === null ? (
                          <span className="text-sm text-text-muted">Not graded yet</span>
                        ) : (
                          <>
                            <div className="text-base font-semibold tabular-nums text-text">{c.averagePercent}%</div>
                            <ProgressBar percent={c.averagePercent} />
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</span>
        <span className="text-2xl font-semibold tabular-nums text-text">{value}</span>
        <span className="text-xs text-text-muted">{hint}</span>
      </CardBody>
    </Card>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-surface-subtle" role="presentation">
      <div className="h-full rounded-full bg-accent" style={{ width: `${clamped}%` }} />
    </div>
  );
}
