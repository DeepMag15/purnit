"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../lib/supabase-client";
import { setAccessToken } from "../../../lib/session";
import { completePostLoginRedirect } from "../../../lib/post-login";
import { Alert } from "../../../ui/Alert";

/**
 * Enterprise SSO's landing page — SsoController.callback redirects here with
 * `access_token`/`refresh_token` in the URL **fragment**, never a query
 * param (fragments are never sent to any server or appear in any log; the
 * tokens are otherwise a fully-authenticating bearer credential). Reading
 * `window.location.hash` therefore requires a client component; there is no
 * server-renderable version of this page.
 *
 * Calls **both** `supabase.auth.setSession` (the SDK's own internal session
 * store) **and** `setAccessToken` (this codebase's separate `session.ts`
 * localStorage key, which `apiFetch` actually reads for the Authorization
 * header) — `login/page.tsx`'s password flow does both independently too;
 * missing the second call here would silently break every API request after
 * SSO login even though Supabase itself thinks the user is signed in.
 */
export default function SsoCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function completeSsoLogin() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      if (!accessToken || !refreshToken) {
        setError("Missing SSO session tokens. Please try logging in again.");
        return;
      }

      // Clears the fragment from the address bar / browser history — done
      // before any further work so a failure below doesn't leave the tokens
      // sitting in the URL.
      window.history.replaceState(null, "", window.location.pathname);

      try {
        const { error: setSessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (setSessionError) throw new Error(setSessionError.message);
        setAccessToken(accessToken);
        await completePostLoginRedirect(router);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't complete SSO sign-in.");
      }
    }

    void completeSsoLogin();
    // Runs once on mount — the fragment is only ever present on the initial
    // landing from SsoController's redirect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4">
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-surface p-7 text-center shadow-sm">
        {error ? (
          <>
            <Alert tone="danger">{error}</Alert>
            <Link href="/login" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
              Back to login
            </Link>
          </>
        ) : (
          <p className="text-sm text-text-muted">Completing sign-in…</p>
        )}
      </div>
    </main>
  );
}
