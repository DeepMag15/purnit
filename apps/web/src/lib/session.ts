const TOKEN_KEY = "antigravity.accessToken";

/**
 * Phase 1 simplification: the access token lives in localStorage and every
 * fetch is client-side (no SSR-protected routes, no httpOnly cookie, no
 * Next.js middleware auth check). Fine for a thin vertical slice proving the
 * engine end-to-end; a production app should move to httpOnly cookies +
 * server-verified sessions. Revisit before Phase 2 hardening.
 */
export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}
