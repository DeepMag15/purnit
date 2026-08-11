import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { WorkspaceManifest } from "@antigravity/manifest-schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssignmentsGradebookTab } from "./AssignmentsGradebookTab";
import { RenderContextProvider } from "../../sdui/render-context";
import { ToastProvider } from "../../ui/Toast";

const user: WorkspaceManifest["user"] = { id: "u1", displayName: "Test User", roles: ["Teacher"], permissionsHash: "x" };
const tenant: WorkspaceManifest["tenant"] = { id: "t1", name: "Test School", workspaceId: "test-school", industry: "Education", branding: {}, profile: {} };

const ASSIGNMENTS = [{ id: "a1", title: "Homework 1", description: null, dueDate: null, maxScore: 100 }];
const GRADES = [
  { studentId: "s1", studentName: "Jane", gradeId: "g1", score: 80, feedback: null, gradedByName: "Test User", gradedAt: "2026-01-01" },
  { studentId: "s2", studentName: "Bob", gradeId: null, score: null, feedback: null, gradedByName: null, gradedAt: null },
];

/** Education Domain, Phase A — the one genuinely new piece of client-side
 * logic in this domain (everything else is a thin wrapper over
 * already-tested mutations/data, matching this codebase's own established
 * "no dedicated test for thin UI wrappers" precedent). Confirms the
 * `gradeId === null -> grade.record` / `gradeId !== null -> grade.update`
 * dispatch rule from grades.mutations.ts's own doc comment actually holds
 * on the frontend side too. */
describe("AssignmentsGradebookTab grade dispatch rule", () => {
  function renderTab(callMutation: (mutation: string, input?: unknown) => Promise<unknown>) {
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <RenderContextProvider
          value={{
            user,
            tenant,
            callDataSource: async (source: string) => {
              if (source === "assignments.list") return ASSIGNMENTS;
              if (source === "grades.list") return GRADES;
              return [];
            },
            callMutation,
            navigate: () => {},
            refetchBootstrap: () => {},
            openAiPanel: () => {},
            aiAvailable: false,
          }}
        >
          <ToastProvider>
            <AssignmentsGradebookTab courseId="c1" courseName="Test Course" canCreateAssignments={false} />
          </ToastProvider>
        </RenderContextProvider>
      </QueryClientProvider>,
    );
  }

  it("calls grade.record for a student with no existing grade (gradeId: null)", async () => {
    const callMutation = vi.fn().mockResolvedValue({});
    renderTab(callMutation);

    fireEvent.click(await screen.findByText("Homework 1"));
    const bobScoreInput = (await screen.findByText("Bob")).closest("tr")!.querySelector('input[type="number"]') as HTMLInputElement;

    fireEvent.change(bobScoreInput, { target: { value: "70" } });
    fireEvent.blur(bobScoreInput);

    await waitFor(() => expect(callMutation).toHaveBeenCalledWith("grade.record", { assignmentId: "a1", studentId: "s2", score: 70 }));
  });

  it("calls grade.update for a student who already has a grade (gradeId set)", async () => {
    const callMutation = vi.fn().mockResolvedValue({});
    renderTab(callMutation);

    fireEvent.click(await screen.findByText("Homework 1"));
    const janeScoreInput = (await screen.findByText("Jane")).closest("tr")!.querySelector('input[type="number"]') as HTMLInputElement;

    fireEvent.change(janeScoreInput, { target: { value: "95" } });
    fireEvent.blur(janeScoreInput);

    await waitFor(() => expect(callMutation).toHaveBeenCalledWith("grade.update", { id: "g1", score: 95 }));
  });
});
