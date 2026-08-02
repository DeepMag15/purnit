import { memo } from "react";
import type { UINode } from "@antigravity/manifest-schema";
import { getPrimitive } from "./registry";
import { NodeErrorBoundary } from "./node-error-boundary";
import { UnknownNodeFallback } from "./unknown-node-fallback";

// Performance-audit fix (CONTEXT.md §47): module-level, not recreated inside
// RendererInner's render body. It closes over nothing render-specific — it
// only ever needs `Renderer` itself, a stable import — so the old inline
// arrow function form handed every primitive a *new* function reference as
// `renderChild` on every single render, which would defeat `React.memo` on
// any primitive that tried to rely on prop stability.
function renderChild(child: UINode) {
  return <Renderer key={child.id} node={child} />;
}

function RendererInner({ node }: { node: UINode }) {
  const entry = getPrimitive(node.type, node.version);
  if (!entry) {
    return <UnknownNodeFallback node={node} />;
  }

  // Throws on failure. Deliberately not caught here — it must propagate up
  // to *this* node's own NodeErrorBoundary (see Renderer below), not a
  // parent's. Validating inside the boundary's own subtree, rather than
  // before constructing the boundary, is what keeps a broken node from
  // taking its siblings down with it.
  const props = entry.schema.parse(node.props ?? {}) as Record<string, unknown>;
  const { Component } = entry;

  return (
    <Component
      {...props}
      nodeId={node.id}
      bind={node.bind}
      actions={node.actions}
      childNodes={node.children}
      renderChild={renderChild}
    />
  );
}

/**
 * Interprets a manifest node against the primitive registry — the renderer
 * half of the SDUI contract (ARCHITECTURE.md §7.5). Three guarantees, all
 * load-bearing:
 *  1. Zod-validates `props` at the boundary before the component ever sees them.
 *  2. Every node — including the validation step itself — is wrapped in its
 *     own error boundary, so one broken widget cannot blank its siblings.
 *  3. An unregistered `type@version` degrades to a visible placeholder
 *     instead of crashing (important for rolling deploys).
 *
 * Performance-audit fix (CONTEXT.md §47): wrapped in `React.memo`, keyed on
 * `node` reference identity (the manifest/page tree is fetched once and held
 * in state as-is, so a given node's object identity is stable across
 * re-renders that don't touch it). Without this, any unrelated re-render
 * higher in the tree (e.g. a sibling `FilterBar`'s local state) cascaded
 * into re-validating (Zod `.parse()`) and re-rendering every visible node in
 * the whole subtree below it.
 */
export const Renderer = memo(function Renderer({ node }: { node: UINode }) {
  return (
    <NodeErrorBoundary nodeId={node.id} nodeType={`${node.type}@${node.version}`}>
      <RendererInner node={node} />
    </NodeErrorBoundary>
  );
});
