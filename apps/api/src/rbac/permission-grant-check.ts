import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { parsePermissionString } from "@purnit/manifest-schema";
import { broaderScope } from "./scope";
import type { EffectivePermissions } from "./permission-collapse";

/** `parsePermissionString` throws a plain `Error` (not an `HttpException`)
 * on a malformed "resource:action:scope" string — this is the one place in
 * the codebase that feeds actor-supplied strings into it, so it's the one
 * place that needs to catch and rethrow as a proper 400 rather than letting
 * a raw Error 500 out of the resolver. */
function parsePermissionStringOrBadRequest(raw: string) {
  try {
    return parsePermissionString(raw);
  } catch {
    throw new BadRequestException(`Malformed permission string "${raw}" — expected "resource:action:scope"`);
  }
}

/**
 * Escalation-prevention for role authoring: every requested
 * "resource:action:scope" triple must already be covered by the actor's own
 * effective permissions (`ctx.effective`, already resolved for every
 * mutation/data-source call) at an equal-or-broader scope. Reuses
 * `broaderScope`/`SCOPE_RANK` rather than reimplementing scope comparison —
 * mirrors `isRoleAssignableBy`'s shape (role-hierarchy.ts) but guards WHICH
 * PERMISSIONS a role definition may contain, a distinct surface that was
 * previously unguarded anywhere in this codebase (isRoleAssignableBy only
 * ever guarded WHICH ROLE could be assigned).
 *
 * All-or-nothing: the first ungranted triple throws, no partial application.
 */
export function assertPermissionsGrantableByActor(actorEffective: EffectivePermissions, requested: readonly string[]): void {
  for (const raw of requested) {
    const { resource, action, scope } = parsePermissionStringOrBadRequest(raw);
    const actorScope = actorEffective.has(resource, action);
    if (actorScope === null || broaderScope(actorScope, scope) !== actorScope) {
      throw new ForbiddenException(`Cannot grant "${raw}" — you do not hold "${resource}:${action}" at scope "${scope}" or broader`);
    }
  }
}
