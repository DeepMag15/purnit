"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signup, ApiError } from "../../lib/api-client";
import { supabase } from "../../lib/supabase-client";
import { setAccessToken } from "../../lib/session";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { Icon } from "../../ui/Icon";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [displayName, setDisplayName] = useState("");
  // Healthcare Domain, Phase A — the platform's first non-IT blueprint;
  // this is the one real frontend hardcode that needs to change every time a
  // new industry blueprint is added to make it provisionable at all
  // (everything else — nav, pages, widgets — is already 100% manifest-
  // driven, zero industry-conditional code anywhere else in this app).
  // Education Domain, Phase A added "Education". Finance Domain, Phase A
  // added "Finance" — done in this same commit this time, not a follow-up
  // hotfix (Education's own launch missed it once).
  const [industry, setIndustry] = useState<"IT" | "Healthcare" | "Education" | "Finance">("IT");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Held only in memory, only between signup succeeding and the user
  // clicking "Continue" below — never persisted. Needed to complete the
  // auto-login after the one-time workspace-ID callout is shown.
  const [ready, setReady] = useState<{ workspaceId: string; email: string; password: string } | null>(null);
  const [continuing, setContinuing] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await signup({ email, password, companyName, displayName, industry });
      setReady({ workspaceId: result.workspaceId, email, password });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleContinue() {
    if (!ready) return;
    setContinuing(true);
    setError(null);
    try {
      const { data, error: loginError } = await supabase.auth.signInWithPassword({ email: ready.email, password: ready.password });
      if (loginError || !data.session) {
        throw new Error(loginError?.message ?? "Account created, but automatic sign-in failed. Please log in.");
      }
      setAccessToken(data.session.access_token);
      router.push("/workspace");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setContinuing(false);
    }
  }

  if (ready) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,var(--color-accent)_0%,transparent_70%)] opacity-[0.1]" />
        <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-surface p-7 shadow-sm">
          <div className="mb-5 flex justify-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg">
              <Icon name="auto_awesome" size={16} />
            </div>
          </div>
          <h1 className="text-center text-lg font-semibold text-text">Your workspace is ready</h1>
          <div className="mt-5 flex items-start gap-2 rounded-md border border-accent/20 bg-accent/5 px-3 py-2.5 text-sm text-text">
            <Icon name="key" size={15} className="mt-0.5 shrink-0 text-accent" />
            <span>
              Your Workspace ID is <strong className="font-mono">{ready.workspaceId}</strong> — you&apos;ll need it (along with your email and
              password) every time you log in. Save it now.
            </span>
          </div>
          {error && (
            <div className="mt-3">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}
          <Button onClick={handleContinue} disabled={continuing} className="mt-4 w-full">
            {continuing ? "Continuing…" : "Continue to workspace"}
          </Button>
        </div>
      </main>
    );
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
        <h1 className="text-center text-lg font-semibold text-text">Create your workspace</h1>
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
          <Input placeholder="Company name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required autoFocus />
          <Select value={industry} onChange={(e) => setIndustry(e.target.value as "IT" | "Healthcare" | "Education" | "Finance")} aria-label="Industry">
            <option value="IT">IT</option>
            <option value="Healthcare">Healthcare</option>
            <option value="Education">Education</option>
            <option value="Finance">Finance</option>
          </Select>
          <Input placeholder="Your name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input
            type="password"
            placeholder="Password (min. 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" disabled={submitting} className="mt-1 w-full">
            {submitting ? "Creating…" : "Create workspace"}
          </Button>
        </form>
        <p className="mt-5 text-center text-sm text-text-muted">
          Already have a workspace?{" "}
          <a href="/login" className="font-medium text-accent hover:underline">
            Log in
          </a>
        </p>
      </div>
    </main>
  );
}
