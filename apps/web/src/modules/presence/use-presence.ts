"use client";

import { useMemo } from "react";
import { useDataSourceQuery } from "../../sdui/use-data-binding";

interface PresenceRow {
  userId: string;
  status: string;
}

const POLL_INTERVAL_MS = 25_000;

/**
 * One batched `presence.list` call per view, not one per rendered dot — per
 * the approved plan's "scoped to only the userIds actually visible on
 * screen, never the whole tenant" design. A caller (`TeamMembers`,
 * `ChatWorkspace`'s DM list) collects every userId it's about to render a
 * `PresenceDot` for and passes the whole array here once; `<PresenceDot>`
 * itself stays a dumb presentational component fed a single `status` prop,
 * not a data-fetching one — ten rows means one request, not ten.
 */
export function usePresence(userIds: string[]): Map<string, string> {
  const ids = useMemo(() => Array.from(new Set(userIds)).sort(), [userIds]);
  const { data } = useDataSourceQuery<PresenceRow[]>("presence.list", { userIds: ids }, { enabled: ids.length > 0, refetchInterval: POLL_INTERVAL_MS });

  return useMemo(() => {
    const map = new Map<string, string>();
    if (Array.isArray(data)) for (const row of data) map.set(row.userId, row.status);
    return map;
  }, [data]);
}
