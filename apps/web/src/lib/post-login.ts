import type { useRouter } from "next/navigation";
import { getMe } from "./api-client";

/**
 * The one post-login step both entry points share (password login in
 * login/page.tsx and Enterprise SSO's login/sso-callback/page.tsx) — checked
 * immediately, before ever loading workspace data, same reasoning
 * login/page.tsx's own original comment already gave: avoids a flash of
 * workspace-loading UI before the API-level PASSWORD_CHANGE_REQUIRED
 * backstop would otherwise catch it. Extracted here so the two entry points
 * can't silently drift apart on what "logged in" actually means.
 */
export async function completePostLoginRedirect(router: ReturnType<typeof useRouter>): Promise<void> {
  const me = await getMe();
  router.push(me.mustChangePassword ? "/change-password" : "/workspace");
}
