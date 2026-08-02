"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase-client";
import { getMe, completeFirstLogin, ApiError } from "../../lib/api-client";
import { getAccessToken } from "../../lib/session";
import { Input } from "../../ui/Input";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { Icon } from "../../ui/Icon";

/**
 * The mandatory first-login screen for anyone still on an Admin-generated
 * temporary password (user.invite). Reachable only while authenticated;
 * `apiFetch`'s PASSWORD_CHANGE_REQUIRED handling redirects here from
 * anywhere in the app, and this page itself redirects away if it's visited
 * without a real reason to be here (see the mount check below).
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    getMe()
      .then((me) => {
        if (!me.mustChangePassword) {
          router.replace("/workspace");
          return;
        }
        setChecking(false);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);

      await completeFirstLogin();
      router.replace("/workspace");
    } catch (err) {
      // The temporary password is still valid on failure — safe to retry.
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Couldn't change your password");
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) return null;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,var(--color-accent)_0%,transparent_70%)] opacity-[0.1]" />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-surface p-7 shadow-sm">
        <div className="mb-5 flex justify-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <Icon name="key" size={16} />
          </div>
        </div>
        <h1 className="text-center text-lg font-semibold text-text">Set a new password</h1>
        <p className="mt-1 text-center text-sm text-text-muted">
          You&apos;re using a temporary password. Set a new one to continue to your workspace.
        </p>
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
          <Input
            type="password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
          <Input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" disabled={submitting} className="mt-1 w-full">
            {submitting ? "Setting password…" : "Set password and continue"}
          </Button>
        </form>
      </div>
    </main>
  );
}
