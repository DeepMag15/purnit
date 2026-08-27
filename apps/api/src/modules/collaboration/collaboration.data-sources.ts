import { z } from "zod";
import type { DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import { reachableUsers } from "./collaboration-reach";

const EmptyParamsSchema = z.object({});

/**
 * The people this caller may contact — the roster a "start a conversation" or
 * "assign a colleague" picker should offer.
 *
 * ⚠️ What this replaces. Those pickers all called `users.list`, which
 * requires **`user:manage`** — an administrative grant. Verified live: a
 * Teacher is refused 403, and so is a Student. `ChatWorkspace` called it
 * **unconditionally**, so every non-admin logged a 403 simply by opening
 * Chat; `CourseDetail` and `ClientDetail` guarded it with `canUpdate`, using
 * a *resource* permission as a proxy for a *people* permission — two
 * different authorities, so the guard could never be right.
 *
 * The precedent for the fix already existed and had not been generalised:
 * `meetings.inviteCandidates` is gated on `meeting:create` precisely because
 * `user:manage` was the wrong question for it.
 *
 * Ungated on purpose, and declared in `authorization-invariants.spec.ts`: a
 * name and an id are not sensitive — `project.members` says exactly this
 * already — and the thing that actually needs protecting is *reach*, which
 * `reachableUsers` enforces. A student sees only the staff connected to their
 * courses and reviews; staff see the roster minus students they have no
 * connection to. It returns precisely the set `conversation.createDm` will
 * accept, so the UI cannot offer someone the API will refuse.
 */
export const peopleDirectoryDataSource: DataSourceDefinition<z.infer<typeof EmptyParamsSchema>> = {
  name: "people.directory",
  paramsSchema: EmptyParamsSchema,
  async resolve(_params, ctx, tx) {
    if (!ctx.userId) return [];
    return reachableUsers(tx, ctx.tenantId, ctx.userId);
  },
};
