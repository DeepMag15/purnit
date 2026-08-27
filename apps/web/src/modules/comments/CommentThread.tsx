"use client";

import { useState } from "react";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { Button } from "../../ui/Button";
import { Badge } from "../../ui/Badge";
import { Dropdown } from "../../ui/Dropdown";
import { Icon } from "../../ui/Icon";
import { SkeletonRows } from "../../ui/Skeleton";
import { useToast } from "../../ui/Toast";
import { cn } from "../../ui/utils";

export interface MentionCandidate {
  id: string;
  displayName: string;
}

interface CommentRow {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  mentionedUserIds: string[];
}

/**
 * Phase 1, Comments & Mentions (CONTEXT.md §49) — a plain, shared React
 * component, deliberately not a blueprint-registered primitive: a per-row
 * expandable thread can't be expressed as a static blueprint node (rows are
 * dynamic data, not fixed tree structure). Mounted directly by `TaskList`/
 * `ProjectBoard` only while a given row is expanded (not on every row all
 * the time) — see the mount site for why.
 *
 * Mentions are client-resolved, not parsed from free text: pick a name from
 * `mentionCandidates` (a dropdown, reusing `ui/Dropdown.tsx`) and it's
 * appended to the body as visible `@DisplayName` text *and* tracked as a
 * removable chip resolving to a real userId — deliberately simpler than a
 * live cursor-tracking inline-autocomplete text editor, which is out of
 * scope for this pass (matches the roadmap's own "no rich-text editor yet"
 * scope line).
 */
/**
 * ⚠️ `mentionCandidates` was a PROP, and every caller filled it differently.
 *
 * The backend accepts any of the target project's owner + members. The six
 * call sites passed: `project.members` (twice, correct), the assignee alone,
 * the account manager alone, the teacher alone, and — in Manufacturing — an
 * empty array, which meant the Mention control was never rendered at all. A
 * teacher reviewing a submission could @-mention exactly one person.
 *
 * It is no longer a prop. The thread asks `comments.mentionCandidates`, which
 * returns precisely the set `comment.create` validates against, so a caller
 * cannot get it wrong and the picker cannot disagree with the mutation.
 *
 * `noun` follows the `DocumentsPanel` precedent from the Documents review: the
 * same thread serves an IT project, a patient's chart, a course and a work
 * order, and "Write a comment…" is not what a nurse is doing on a chart. The
 * default keeps every existing surface reading exactly as it did.
 */
export function CommentThread({
  entityType,
  entityId,
  noun = "comment",
  nounPlural,
}: {
  entityType: "project" | "task" | "document";
  entityId: string;
  noun?: string;
  nounPlural?: string;
}) {
  const plural = nounPlural ?? `${noun}s`;
  const { user, callMutation } = useRenderContext();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [selectedMentions, setSelectedMentions] = useState<MentionCandidate[]>([]);
  const [posting, setPosting] = useState(false);

  const { data, isPending, refetch } = useDataSourceQuery<CommentRow[]>("comments.list", { entityType, entityId });
  // One source of truth, shared with the mutation — see the note above.
  const { data: candidateData } = useDataSourceQuery<MentionCandidate[]>("comments.mentionCandidates", { entityType, entityId });
  const mentionCandidates = Array.isArray(candidateData) ? candidateData : [];
  const comments = Array.isArray(data) ? data : [];

  function addMention(candidate: MentionCandidate) {
    if (selectedMentions.some((m) => m.id === candidate.id)) return;
    setSelectedMentions((current) => [...current, candidate]);
    setBody((current) => `${current}${current.trim() ? " " : ""}@${candidate.displayName} `);
  }

  function removeMention(id: string) {
    setSelectedMentions((current) => current.filter((m) => m.id !== id));
  }

  async function handlePost() {
    if (!body.trim()) return;
    setPosting(true);
    try {
      await callMutation("comment.create", {
        entityType,
        entityId,
        body: body.trim(),
        mentionedUserIds: selectedMentions.map((m) => m.id),
      });
      setBody("");
      setSelectedMentions([]);
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't post comment", "danger");
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(commentId: string) {
    try {
      await callMutation("comment.delete", { id: commentId });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't delete comment", "danger");
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-hover/40 p-3">
      {isPending && <SkeletonRows rows={2} />}
      {!isPending && comments.length === 0 && <p className="text-xs text-text-muted">No {plural} yet.</p>}
      {!isPending && comments.length > 0 && (
        <ul className="flex flex-col gap-2">
          {comments.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-text">{c.authorName}</span>{" "}
                <span className="text-xs text-text-muted">{new Date(c.createdAt).toLocaleString()}</span>
                <p className="whitespace-pre-wrap break-words text-text">{c.body}</p>
              </div>
              {c.authorId === user.id && (
                <button
                  type="button"
                  onClick={() => handleDelete(c.id)}
                  className="shrink-0 text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-danger"
                  title="Delete comment"
                >
                  <Icon name="delete" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {selectedMentions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedMentions.map((m) => (
            <span key={m.id} className="inline-flex items-center gap-1">
              <Badge tone="accent">
                @{m.displayName}
                <button type="button" onClick={() => removeMention(m.id)} className="ml-1">
                  <Icon name="close" size={10} />
                </button>
              </Badge>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Write a ${noun}…`}
          rows={2}
          className={cn(
            "flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors duration-[var(--duration-fast)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent",
          )}
        />
        <div className="flex flex-col gap-1">
          {mentionCandidates.length > 0 && (
            <Dropdown
              trigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs text-text-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
                >
                  <Icon name="alternate_email" size={12} />
                  Mention
                </button>
              )}
            >
              {({ close }) => (
                <div className="max-h-56 w-52 overflow-y-auto py-1">
                  {mentionCandidates.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        close();
                        addMention(m);
                      }}
                      className="flex w-full items-center px-3 py-1.5 text-left text-sm text-text transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
                    >
                      {m.displayName}
                    </button>
                  ))}
                </div>
              )}
            </Dropdown>
          )}
          <Button onClick={handlePost} disabled={posting || !body.trim()} className="whitespace-nowrap">
            {posting ? "Posting…" : "Post"}
          </Button>
        </div>
      </div>
    </div>
  );
}
