"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase-client";
import { setAccessToken } from "../../lib/session";
import { verifyWorkspace, getMe, ApiError } from "../../lib/api-client";
import { Input } from "../../ui/Input";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { Icon } from "../../ui/Icon";

export default function LoginPage() {
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
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

      // Checked immediately, before ever loading workspace data — avoids a
      // flash of workspace-loading UI before the API-level backstop
      // (apiFetch's PASSWORD_CHANGE_REQUIRED handling) would otherwise catch
      // an invited user still on their temporary password.
      const me = await getMe();
      router.push(me.mustChangePassword ? "/change-password" : "/workspace");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,var(--color-accent)_0%,transparent_70%)] opacity-[0.1]" />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-surface p-7 shadow-sm">
        <div className="mb-5 flex justify-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <Icon name="auto_awesome" size={16} />
          </div>
        </div>
        <h1 className="text-center text-lg font-semibold text-text">Log in</h1>
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
          <Input placeholder="Workspace ID" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} required autoFocus />
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" disabled={submitting} className="mt-1 w-full">
            {submitting ? "Logging in…" : "Log in"}
          </Button>
        </form>
        <p className="mt-5 text-center text-sm text-text-muted">
          No workspace yet?{" "}
          <a href="/signup" className="font-medium text-accent hover:underline">
            Create one
          </a>
        </p>
      </div>
    </main>
  );
}
