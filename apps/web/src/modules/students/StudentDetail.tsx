"use client";

import { useState } from "react";
import Link from "next/link";
import { useEntityDetail } from "../../sdui/use-entity-detail";
import { useRenderContext } from "../../sdui/render-context";
import { DetailPageShell } from "../../ui/DetailPageShell";
import { Tabs } from "../../ui/Tabs";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Badge } from "../../ui/Badge";
import { Select } from "../../ui/Select";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";

interface EnrollmentRow {
  id: string;
  courseId: string;
  courseName: string;
  status: string;
  finalGrade: string | null;
}

interface StudentDetailData {
  id: string;
  name: string;
  dateOfBirth: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  status: string;
  canUpdate: boolean;
  canReadEnrollments: boolean;
  enrollments: EnrollmentRow[];
}

const STATUSES = ["active", "graduated", "withdrawn"];
const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  active: "accent",
  graduated: "success",
  withdrawn: "neutral",
};

/** Education Domain, Phase A — mounted by `/workspace/students/[studentId]`.
 * No Documents/Comments tab — Student has no backing Project (unlike
 * Course, see course.prisma's own doc comment for why). Enrollments tab
 * only shown when `canReadEnrollments` — Teacher/TA never hold
 * `enrollment:read` in Phase A, the concrete "structurally excluded" proof
 * for this page. */
export function StudentDetail({ studentId }: { studentId: string }) {
  const { data, loading, error, notFound, refetch } = useEntityDetail<StudentDetailData>("students.detail", studentId);
  const { callMutation, aiAvailable, openAiPanel } = useRenderContext();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  async function handleStatusChange(status: string) {
    try {
      await callMutation("student.updateStatus", { id: studentId, status });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update student status", "danger");
    }
  }

  function summarizeEnrollments() {
    if (!data) return;
    const lines = [
      `Student: ${data.name}`,
      `Status: ${data.status}`,
      data.enrollments.length > 0
        ? `Enrollments: ${data.enrollments.map((e) => `${e.courseName} (${e.status}${e.finalGrade ? `, final grade ${e.finalGrade}` : ""})`).join("; ")}`
        : "Not enrolled in any courses yet.",
    ];
    openAiPanel("students.summarizeEnrollments", `Summarize this student's enrollment record.\n\n${lines.join("\n")}`);
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
  if (notFound) return <EmptyStateView message="Student not found, or you don't have access to it." />;
  if (error) return <Alert tone="danger">Couldn&apos;t load student: {error}</Alert>;
  if (!data) return null;

  const tabs = data.canReadEnrollments
    ? [
        { id: "overview", label: "Overview" },
        { id: "enrollments", label: "Enrollments" },
      ]
    : [{ id: "overview", label: "Overview" }];

  return (
    <DetailPageShell
      backHref="/workspace/students"
      backLabel="Students"
      title={data.name}
      status={!data.canUpdate ? { label: data.status, tone: STATUS_TONE[data.status] ?? "neutral" } : undefined}
      actions={
        data.canUpdate && (
          <Select value={data.status} onChange={(e) => handleStatusChange(e.target.value)} className="h-8 text-xs">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )
      }
      tabs={tabs.length > 1 ? <Tabs items={tabs} activeId={activeTab} onChange={setActiveTab} /> : undefined}
    >
      {activeTab === "overview" && (
        <Card>
          <CardHeader title="Details" />
          <CardBody className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">Date of birth</span>
              <span className="text-text">{data.dateOfBirth ? new Date(data.dateOfBirth).toLocaleDateString() : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Phone</span>
              <span className="text-text">{data.contactPhone ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Email</span>
              <span className="text-text">{data.contactEmail ?? "—"}</span>
            </div>
          </CardBody>
        </Card>
      )}
      {activeTab === "enrollments" && data.canReadEnrollments && (
        <Card>
          <CardHeader
            title="Enrollments"
            action={
              aiAvailable && (
                <Button size="sm" variant="secondary" onClick={summarizeEnrollments}>
                  Summarize Enrollments
                </Button>
              )
            }
          />
          <CardBody>
            {data.enrollments.length === 0 && <EmptyStateView message="Not enrolled in any courses yet." />}
            {data.enrollments.length > 0 && (
              <ul className="flex flex-col divide-y divide-border">
                {data.enrollments.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link href={`/workspace/courses/${e.courseId}`} className="min-w-0 flex-1 truncate text-sm text-text hover:text-accent">
                      {e.courseName}
                    </Link>
                    <div className="flex shrink-0 items-center gap-2">
                      {e.finalGrade && <span className="text-xs text-text-muted">{e.finalGrade}</span>}
                      <Badge tone={e.status === "completed" ? "success" : e.status === "dropped" ? "danger" : "info"}>{e.status}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </DetailPageShell>
  );
}
