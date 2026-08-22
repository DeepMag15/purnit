"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../lib/supabase-client";
import { setAccessToken } from "../../lib/session";
import { verifyWorkspace, getWorkspaceSsoStatus, ApiError } from "../../lib/api-client";
import { completePostLoginRedirect } from "../../lib/post-login";
import { Input } from "../../ui/Input";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { Icon } from "../../ui/Icon";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

// A real two-step flow, not a cosmetic field-hide: step 1 resolves the
// workspace ID alone (no email yet — Enterprise SSO's JIT-provisioned users
// have no User row to check an email against, unlike verifyWorkspace's own
// existing-user requirement); step 2 is either today's email/password form
// or, for an SSO-enabled workspace, a single "Continue with SSO" button.
type Step = "workspace" | "credentials" | "sso";

// `useSearchParams()` (to read the `?error=sso_failed` redirect from
// SsoController.callback's own failure path) requires a Suspense boundary
// for a public, statically-prerendered page like this one — Next.js's own
// build-time requirement, not an app-level concern; the fallback never
// visibly renders in practice since this page has no server data to wait on.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("workspace");
  const [workspaceId, setWorkspaceId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Landed here from SsoController.callback's own failure redirect
    // (GET /auth/sso/callback never surfaces a raw 500 — it always redirects
    // to /login?error=sso_failed with the real cause logged server-side).
    if (searchParams.get("error") === "sso_failed") {
      setError("Enterprise SSO sign-in failed. Please try again or contact your workspace admin.");
    }
  }, [searchParams]);

  async function handleWorkspaceSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const trimmedWorkspaceId = workspaceId.trim();
      const { ssoEnabled } = await getWorkspaceSsoStatus(trimmedWorkspaceId);
      setStep(ssoEnabled ? "sso" : "credentials");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSsoContinue() {
    window.location.assign(`${API_URL}/auth/sso/authorize?workspaceId=${encodeURIComponent(workspaceId.trim())}`);
  }

  async function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const trimmedEmail = email.trim();
      // Confirmed before ever attempting a Supabase sign-in — a wrong
      // workspace ID never even gets to a password check (see
      // AuthService.verifyWorkspace for why this doesn't change how
      // tenant_id ends up in the JWT).
      try {
        await verifyWorkspace(workspaceId.trim(), trimmedEmail);
      } catch (err) {
        // Only a genuine ApiError means the backend actually rejected this
        // workspace/email pair. Anything else (fetch itself throwing, e.g.
        // the API being unreachable) is a connectivity failure, not a
        // workspace mismatch — showing the same wording for both would lie
        // about the real cause.
        throw new Error(err instanceof ApiError ? err.message : "Couldn't reach the server. Please try again.", { cause: err });
      }

      const { data, error: loginError } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password });
      if (loginError || !data.session) {
        throw new Error(loginError?.message ?? "Login failed");
      }
      setAccessToken(data.session.access_token);
      await completePostLoginRedirect(router);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  function backToWorkspace() {
    setStep("workspace");
    setError(null);
    setEmail("");
    setPassword("");
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,var(--color-accent)_0%,transparent_70%)] opacity-[0.1]" />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-surface p-7 shadow-sm">
        {/* Go-Live, Phase 02 — a way back to the public site. Landing on an
         * auth page with no route home is a small dead end, and it is the
         * one piece of chrome the marketing layout deliberately doesn't
         * wrap these pages in. */}
        <div className="mb-5 flex justify-center">
          <Link
            href="/"
            aria-label="Purnit home"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg transition-colors duration-[var(--duration-base)] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <Icon name="auto_awesome" size={16} />
          </Link>
        </div>
        <h1 className="text-center text-lg font-semibold text-text">Log in</h1>

        {step === "workspace" && (
          <form onSubmit={handleWorkspaceSubmit} className="mt-6 flex flex-col gap-3">
            <Input placeholder="Workspace ID" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} required autoFocus />
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" disabled={submitting} className="mt-1 w-full">
              {submitting ? "Checking…" : "Continue"}
            </Button>
          </form>
        )}

        {step === "sso" && (
          <div className="mt-6 flex flex-col gap-3">
            <p className="text-center text-sm text-text-muted">
              <span className="font-medium text-text">{workspaceId.trim()}</span> uses Enterprise SSO.
            </p>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="button" onClick={handleSsoContinue} className="mt-1 w-full">
              Continue with SSO
            </Button>
            <button type="button" onClick={backToWorkspace} className="text-center text-sm text-text-muted hover:underline">
              Not your workspace?
            </button>
          </div>
        )}

        {step === "credentials" && (
          <form onSubmit={handleCredentialsSubmit} className="mt-6 flex flex-col gap-3">
            <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" disabled={submitting} className="mt-1 w-full">
              {submitting ? "Logging in…" : "Log in"}
            </Button>
            <button type="button" onClick={backToWorkspace} className="text-center text-sm text-text-muted hover:underline">
              Not your workspace?
            </button>
          </form>
        )}

        {/* `next/link`, not a plain `<a href>` — an internal `<a>` forces a
         * full browser navigation, tearing down and remounting the whole
         * React tree. That was a real, measured bug in the workspace
         * sidebar (ARCHITECTURE.md §7.8) and is now a standing rule. */}
        <p className="mt-5 text-center text-sm text-text-muted">
          No workspace yet?{" "}
          <Link href="/signup" className="font-medium text-accent hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
