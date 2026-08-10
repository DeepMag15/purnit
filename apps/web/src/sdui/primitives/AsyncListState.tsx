import type { ReactNode } from "react";
import { SkeletonRows } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { EmptyStateView } from "./EmptyState";

/**
 * Centralizes the {loading}/{error}/{empty}/{content} 4-branch convention
 * copy-pasted near-verbatim across 15+ module composites (PatientsWorkspace,
 * TaskList, ProjectBoard, etc.) — byte-for-byte the same shape, just shared.
 * A plain, non-registered helper a composite imports directly, same
 * precedent as EmptyStateView itself.
 */
export function AsyncListState({
  loading,
  error,
  isEmpty,
  emptyMessage,
  loadErrorLabel = "data",
  children,
}: {
  loading: boolean;
  error: string | null | undefined;
  isEmpty: boolean;
  emptyMessage?: string;
  loadErrorLabel?: string;
  children: ReactNode;
}) {
  if (loading) return <SkeletonRows />;
  if (error)
    return (
      <Alert tone="danger">
        Couldn&apos;t load {loadErrorLabel}: {error}
      </Alert>
    );
  if (isEmpty) return <EmptyStateView message={emptyMessage} />;
  return <>{children}</>;
}
