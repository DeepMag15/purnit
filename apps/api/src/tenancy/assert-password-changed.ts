import { ForbiddenException } from "@nestjs/common";
import type { CurrentUser } from "./current-user.service";

/**
 * Called right after `CurrentUserService.get()` in every controller that
 * grants real access to tenant data (`WorkspaceController`,
 * `DataSourcesController`, `MutationsController`) — the complete set of
 * chokepoints an authenticated user must pass through to do anything beyond
 * `GET /me`. `POST /auth/complete-first-login` is a bespoke `AuthController`
 * endpoint outside this set, so it stays reachable while the flag is still
 * set. A shared helper (not a copy-pasted throw in each controller)
 * guarantees the error code the frontend matches on never drifts.
 */
export function assertPasswordChanged(user: CurrentUser): void {
  if (user.mustChangePassword) {
    throw new ForbiddenException({
      statusCode: 403,
      code: "PASSWORD_CHANGE_REQUIRED",
      message: "You must change your temporary password before continuing",
    });
  }
}
