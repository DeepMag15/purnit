"use client";

import { useDataSourceQuery } from "../../../sdui/use-data-binding";
import { useRenderContext } from "../../../sdui/render-context";
import { Card, CardHeader, CardBody, Icon, Button } from "../../../ui";

interface Task {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
}

/**
 * Frontend Redesign, Phase 01 — same `formatWidgetsForAi` precedent
 * AnalyticsDashboard already established: build the prompt from data
 * already fetched client-side, real numbers/titles, not a vague "look at my
 * stuff" ask. Shares its `tasks.list({assigneeId})` query cache with
 * MyWorkWidget (same query key), so this costs no extra request.
 */
export function AiInsightsWidget() {
  const { user, openAiPanel } = useRenderContext();
  const { data } = useDataSourceQuery<Task[]>("tasks.list", { assigneeId: user.id });
  const tasks = Array.isArray(data) ? data : [];
  const open = tasks.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < Date.now());

  function ask() {
    const lines = [
      `I have ${open.length} open task(s), ${overdue.length} of them overdue.`,
      open.length > 0 ? `Titles: ${open.slice(0, 5).map((t) => t.title).join("; ")}` : "",
    ].filter(Boolean);
    openAiPanel(
      "dashboard.insights",
      `Here's a snapshot of my open work today.\n\n${lines.join("\n")}\n\nSummarize what needs my attention first and suggest one or two next steps.`,
    );
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5">
            <Icon name="auto_awesome" size={15} className="text-accent" />
            AI Insights
          </span>
        }
      />
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">
          {overdue.length > 0
            ? `${overdue.length} of your tasks are overdue. Want a plan to catch up?`
            : open.length > 0
              ? `You have ${open.length} open task${open.length === 1 ? "" : "s"}. Want a summary of what to tackle first?`
              : "You're all caught up. Ask AI to help plan what's next."}
        </p>
        <Button size="sm" variant="secondary" onClick={ask}>
          Ask AI about my day
        </Button>
      </CardBody>
    </Card>
  );
}
