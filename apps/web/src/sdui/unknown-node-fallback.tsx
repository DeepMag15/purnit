import type { UINode } from "@purnit/manifest-schema";

/** Rendered when a manifest references a `type@version` the client's
 * registry doesn't know — expected during a rolling deploy where the API
 * has shipped a newer primitive before the frontend has. Degrades
 * gracefully instead of crashing the page. */
export function UnknownNodeFallback({ node }: { node: UINode }) {
  return (
    <div role="note" data-unknown-node={node.id} className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-text-muted">
      Unsupported widget ({node.type}@{node.version}).
    </div>
  );
}
