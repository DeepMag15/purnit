"use client";

import { useRouter } from "next/navigation";
import { useBootstrap } from "../../../app/workspace/bootstrap-context";
import { getQuickCreateItems } from "../../../lib/quick-create";
import { useRenderContext } from "../../../sdui/render-context";
import { Card, CardHeader, CardBody, Icon } from "../../../ui";

/** Frontend Redesign, Phase 01 — same catalog as the header's quick-create
 * menu and the Command Palette (`getQuickCreateItems`), so the three
 * surfaces never drift. Adds "Ask AI" as a fourth, dashboard-only entry
 * when available — a quick action, not a widget of its own. */
export function QuickActionsWidget() {
  const { manifest } = useBootstrap();
  const { openAiPanel } = useRenderContext();
  const router = useRouter();
  const items = getQuickCreateItems(manifest);

  return (
    <Card>
      <CardHeader title="Quick Actions" />
      <CardBody className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => router.push(item.href)}
            className="interactive-press flex flex-col items-center justify-center gap-1.5 rounded-md border border-border p-3 text-center transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
          >
            <Icon name={item.icon} size={18} className="text-text-muted" />
            <span className="text-xs font-medium text-text-muted">{item.label}</span>
          </button>
        ))}
        {manifest.aiAvailable && (
          <button
            type="button"
            onClick={() => openAiPanel()}
            className="interactive-press flex flex-col items-center justify-center gap-1.5 rounded-md border border-border p-3 text-center transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
          >
            <Icon name="auto_awesome" size={18} className="text-accent" />
            <span className="text-xs font-medium text-text-muted">Ask AI</span>
          </button>
        )}
      </CardBody>
    </Card>
  );
}
