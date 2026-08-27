"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDataSourceQuery, dataSourceQueryKey } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { Button } from "../../ui/Button";
import { Badge } from "../../ui/Badge";
import { Alert } from "../../ui/Alert";
import { Icon } from "../../ui/Icon";
import { SkeletonRows } from "../../ui/Skeleton";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";

/**
 * Contextual Reporting — the analysis of an uploaded report, shown inside the
 * document it belongs to.
 *
 * Deliberately a tab on the existing document detail page rather than a
 * "Reports" area of its own: a report's insights belong next to its versions,
 * its approval status and its comment thread, which together are the review
 * workflow. A separate area would mean uploading in one place and reasoning
 * about it in another.
 *
 * The lens name is shown prominently and on purpose. Two people opening the
 * same file get different analyses, and the honest way to present that is to
 * say which reading they are looking at rather than implying there is one
 * objective answer.
 */

interface Finding {
  label: string;
  detail: string;
  severity: "info" | "attention" | "risk";
}

interface Analysis {
  id: string;
  lensKey: string;
  lensLabel: string;
  summary: string;
  findings: Finding[];
  suggestedActions: string[];
  documentVersion: number;
  stale: boolean;
  requestedByName: string;
  createdAt: string;
}

interface AnalysesResult {
  canAnalyze: boolean;
  availableLens: { key: string; label: string } | null;
  documentVersion: number;
  analyses: Analysis[];
}

const SEVERITY_TONE: Record<Finding["severity"], "neutral" | "warning" | "danger"> = {
  info: "neutral",
  attention: "warning",
  risk: "danger",
};

const SEVERITY_LABEL: Record<Finding["severity"], string> = {
  info: "Worth knowing",
  attention: "Needs a look",
  risk: "Needs action",
};

export function DocumentInsights({ documentId, documentName }: { documentId: string; documentName: string }) {
  const { callMutation, user, tenant } = useRenderContext();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useDataSourceQuery<AnalysesResult>("document.analyses", { documentId });

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  async function handleAnalyze() {
    setRunning(true);
    setRunError(null);
    try {
      await callMutation("document.analyze", { documentId });
      await queryClient.invalidateQueries({
        queryKey: dataSourceQueryKey("document.analyses", { documentId }, tenant.id, user.id),
      });
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Couldn't analyse this report");
    } finally {
      setRunning(false);
    }
  }

  if (isLoading) return <SkeletonRows rows={3} />;
  if (error) return <Alert tone="danger">{error instanceof Error ? error.message : "Couldn't load insights"}</Alert>;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text">Insights</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
            {data.availableLens ? (
              <>
                Analysed for you as <span className="font-medium text-text">{data.availableLens.label}</span> — what this
                report means for your role.
              </>
            ) : (
              "Analysis here is shaped by what you work on."
            )}
          </p>
        </div>
        {data.canAnalyze && (
          <Button size="sm" onClick={handleAnalyze} disabled={running}>
            {running ? "Reading the report…" : data.analyses.length > 0 ? "Analyse again" : "Analyse report"}
          </Button>
        )}
      </div>

      {runError && <Alert tone="danger">{runError}</Alert>}

      {!data.canAnalyze && data.analyses.length === 0 && (
        <EmptyStateView
          icon="insights"
          message={`You can read ${documentName}, but running an analysis isn't part of your role here. Insights someone else runs will appear in this tab.`}
        />
      )}

      {data.canAnalyze && data.analyses.length === 0 && !running && (
        <EmptyStateView
          icon="insights"
          message="No analysis yet. Running one reads the report and summarises what matters for your role — it won't change the file."
        />
      )}

      <div className="flex flex-col gap-4">
        {data.analyses.map((a) => (
          <AnalysisCard key={a.id} analysis={a} currentVersion={data.documentVersion} />
        ))}
      </div>
    </div>
  );
}

function AnalysisCard({ analysis, currentVersion }: { analysis: Analysis; currentVersion: number }) {
  const findings = Array.isArray(analysis.findings) ? analysis.findings : [];
  const actions = Array.isArray(analysis.suggestedActions) ? analysis.suggestedActions : [];

  return (
    <article className="rounded-lg border border-border bg-surface p-4">
      <header className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">{analysis.lensLabel}</Badge>
        {analysis.stale && (
          // The file moved on. Saying so is the difference between an old
          // insight and a wrong one.
          <Badge tone="warning">
            Analysed v{analysis.documentVersion} — file is now v{currentVersion}
          </Badge>
        )}
        <span className="ml-auto text-xs text-text-muted">
          {analysis.requestedByName} · {new Date(analysis.createdAt).toLocaleString()}
        </span>
      </header>

      <p className="mt-3 text-sm leading-relaxed text-text">{analysis.summary}</p>

      {findings.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2.5">
          {findings.map((f, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 shrink-0">
                <Badge tone={SEVERITY_TONE[f.severity] ?? "neutral"}>{SEVERITY_LABEL[f.severity] ?? "Worth knowing"}</Badge>
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text">{f.label}</span>
                <span className="block text-sm leading-relaxed text-text-muted">{f.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {actions.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Suggested next steps</h4>
          <ul className="mt-2 flex flex-col gap-1.5">
            {actions.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-text-muted">
                <Icon name="check-square" size={14} className="mt-0.5 shrink-0" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
