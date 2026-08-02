import type { UINode } from "@antigravity/manifest-schema";

/** Rendered when a manifest references a `type@version` the client's
 * registry doesn't know — expected during a rolling deploy where the API
 * has shipped a newer primitive before the frontend has. Degrades
 * gracefully instead of crashing the page. */
export function UnknownNodeFallback({ node }: { node: UINode }) {
  return (
    <div
      role="note"
      data-unknown-node={node.id}
      style={{ padding: "0.5rem", border: "1px dashed #999", borderRadius: 4, color: "#666", fontSize: "0.875rem" }}
    >
      Unsupported widget ({node.type}@{node.version}).
    </div>
  );
}
