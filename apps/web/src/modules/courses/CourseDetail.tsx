"use client";

import { useState } from "react";
import { useEntityDetail } from "../../sdui/use-entity-detail";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { DetailPageShell } from "../../ui/DetailPageShell";
import { Tabs } from "../../ui/Tabs";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Badge } from "../../ui/Badge";
import { Select } from "../../ui/Select";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Icon } from "../../ui/Icon";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { CommentThread } from "../comments/CommentThread";
import { DocumentsPanel } from "../documents/DocumentsPanel";
import { AssignmentsGradebookTab } from "./AssignmentsGradebookTab";

interface RosterRow {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  status: string;
  finalGrade: string | null;
}

interface CourseDetailData {
  id: string;
  name: string;
  description: string | null;
  status: string;
  teacherId: string | null;
  teacherName: string | null;
  materialsProjectId: string;
  roster: RosterRow[];
  assignmentCount: number;
  documentCount: number;
  canUpdate: boolean;
  canReadAssignments: boolean;
  canCreateAssignments: boolean;
  canEnroll: boolean;
  canUpdateEnrollments: boolean;
  canCreateDocuments: boolean;
  canUpdateDocuments: boolean;
  canDeleteDocuments: boolean;
}

interface StudentOption {
  id: string;
  name: string;
}

const STATUSES = ["active", "archived"];
const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  active: "accent",
  archived: "neutral",
};
const ENROLLMENT_STATUSES = ["enrolled", "completed", "dropped"];
const ENROLLMENT_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  enrolled: "info",
  completed: "success",
  dropped: "danger",
};

/** Education Domain, Phase A — mounted by `/workspace/courses/[courseId]`.
 * `materialsProjectId` (the "chart"-equivalent backing Project, see
 * course.prisma's own doc comment) is what lets Materials/Discussion reuse
 * `DocumentsPanel`/`CommentThread` completely unmodified. */
export function CourseDetail({ courseId }: { courseId: string }) {
  const { data, loading, error, notFound, refetch } = useEntityDetail<CourseDetailData>("courses.detail", courseId);
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);

  const { data: studentsData } = useDataSourceQuery<StudentOption[]>("students.list", {}, { enabled: !!data?.canEnroll });
  const allStudents = Array.isArray(studentsData) ? studentsData : [];
  const enrolledStudentIds = new Set((data?.roster ?? []).map((r) => r.studentId));
  const enrollableStudents = allStudents.filter((s) => !enrolledStudentIds.has(s.id));

  async function handleStatusChange(status: string) {
    try {
      await callMutation("course.updateStatus", { id: courseId, status });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update course status", "danger");
    }
  }

  async function handleEnroll() {
    if (!selectedStudentId) return;
    setEnrolling(true);
    setEnrollError(null);
    try {
      await callMutation("enrollment.enroll", { studentId: selectedStudentId, courseId });
      setEnrollOpen(false);
      setSelectedStudentId("");
      refetch();
    } catch (err) {
      setEnrollError(err instanceof Error ? err.message : "Couldn't enroll student");
    } finally {
      setEnrolling(false);
    }
  }

  async function handleEnrollmentStatusChange(enrollmentId: string, status: string) {
    try {
      await callMutation("enrollment.updateStatus", { id: enrollmentId, status });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update enrollment status", "danger");
    }
  }

  async function handleFinalGradeChange(enrollmentId: string, finalGrade: string) {
    try {
      await callMutation("enrollment.recordFinalGrade", { id: enrollmentId, finalGrade });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't record final grade", "danger");
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (notFound) return <EmptyStateView message="Course not found, or you don't have access to it." />;
  if (error) return <Alert tone="danger">Couldn&apos;t load course: {error}</Alert>;
  if (!data) return null;

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "roster", label: "Roster" },
    ...(data.canReadAssignments ? [{ id: "assignments", label: "Assignments" }] : []),
    { id: "materials", label: "Materials" },
    { id: "discussion", label: "Discussion" },
  ];

  return (
    <DetailPageShell
      backHref="/workspace/courses"
      backLabel="Courses"
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
      tabs={<Tabs items={TABS} activeId={activeTab} onChange={setActiveTab} />}
      metadata={
        <Card>
          <CardHeader title="Details" />
          <CardBody className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">Teacher</span>
              <span className="text-text">{data.teacherName ?? "Unassigned"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Enrolled</span>
              <span className="text-text">{data.roster.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Assignments</span>
              <span className="text-text">{data.assignmentCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Materials</span>
              <span className="text-text">{data.documentCount}</span>
            </div>
          </CardBody>
        </Card>
      }
    >
      {activeTab === "overview" && (
        <Card>
          <CardHeader title="Description" />
          <CardBody>
            <p className="whitespace-pre-wrap text-sm text-text">{data.description || "No description yet."}</p>
          </CardBody>
        </Card>
      )}

      {activeTab === "roster" && (
        <Card>
          <CardHeader
            title="Roster"
            action={
              data.canEnroll && (
                <Button size="sm" onClick={() => setEnrollOpen(true)}>
                  <Icon name="add" size={14} />
                  Enroll Student
                </Button>
              )
            }
          />
          <CardBody>
            {data.roster.length === 0 && <EmptyStateView message="No students enrolled yet." />}
            {data.roster.length > 0 && (
              <ul className="flex flex-col divide-y divide-border">
                {data.roster.map((r) => (
                  <li key={r.enrollmentId} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm text-text">{r.studentName}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      {data.canUpdateEnrollments ? (
                        <>
                          <input
                            type="text"
                            defaultValue={r.finalGrade ?? ""}
                            placeholder="Final grade"
                            onBlur={(e) => {
                              if (e.target.value !== (r.finalGrade ?? "")) void handleFinalGradeChange(r.enrollmentId, e.target.value);
                            }}
                            className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                          />
                          <Select
                            value={r.status}
                            onChange={(e) => handleEnrollmentStatusChange(r.enrollmentId, e.target.value)}
                            className="h-8 text-xs"
                          >
                            {ENROLLMENT_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </Select>
                        </>
                      ) : (
                        <>
                          {r.finalGrade && <span className="text-xs text-text-muted">{r.finalGrade}</span>}
                          <Badge tone={ENROLLMENT_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {activeTab === "assignments" && data.canReadAssignments && (
        <AssignmentsGradebookTab courseId={courseId} canCreateAssignments={data.canCreateAssignments} />
      )}

      {activeTab === "materials" && (
        <DocumentsPanel
          projectId={data.materialsProjectId}
          canCreate={data.canCreateDocuments}
          canUpdate={data.canUpdateDocuments}
          canDelete={data.canDeleteDocuments}
        />
      )}

      {activeTab === "discussion" && (
        <CommentThread
          entityType="project"
          entityId={data.materialsProjectId}
          mentionCandidates={data.teacherId && data.teacherName ? [{ id: data.teacherId, displayName: data.teacherName }] : []}
        />
      )}

      <Dialog open={enrollOpen} onClose={() => setEnrollOpen(false)} title="Enroll Student">
        <div className="flex flex-col gap-3">
          <Select label="Student" value={selectedStudentId} onChange={(e) => setSelectedStudentId(e.target.value)} autoFocus>
            <option value="">{enrollableStudents.length === 0 ? "No students available to enroll" : "Choose a student…"}</option>
            {enrollableStudents.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          {enrollError && <Alert tone="danger">{enrollError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEnrollOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEnroll} disabled={enrolling || !selectedStudentId}>
              {enrolling ? "Enrolling…" : "Enroll"}
            </Button>
          </div>
        </div>
      </Dialog>
    </DetailPageShell>
  );
}
