"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signup, callMutation, ApiError, type SignupResult } from "../../lib/api-client";
import { supabase } from "../../lib/supabase-client";
import { setAccessToken } from "../../lib/session";
import { Input } from "../../ui/Input";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { Icon } from "../../ui/Icon";
import { INDUSTRIES } from "../../marketing/content";
import {
  formatUsd,
  isContactTier,
  monthsSavedYearly,
  priceFor,
  type BillingInterval,
  type PublicPlan,
  type PublicPlanCatalog,
} from "../../marketing/plans";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Industry = "IT" | "Healthcare" | "Education" | "Finance" | "Manufacturing";

/**
 * Go-Live, Phase 03 — the signup journey.
 *
 * Four steps, each a real piece of the decision rather than a paginated form:
 * who you are as a company, which industry blueprint provisions your
 * workspace, which plan and how many seats, and finally your own account.
 *
 * The running order matters. Company and industry come first because they are
 * the questions someone can answer without thinking about money; the account
 * comes last because asking for a password before showing what you get is how
 * signup funnels lose people.
 *
 * `useSearchParams()` needs a Suspense boundary on a statically-prerendered
 * page — the same Next.js build requirement the login page already documents.
 */
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupWizard />
    </Suspense>
  );
}

const STEPS = ["Company", "Plan", "Account"] as const;

function SignupWizard() {
  const router = useRouter();
  const params = useSearchParams();

  const [step, setStep] = useState(0);
  const [catalog, setCatalog] = useState<PublicPlanCatalog | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);

  // Step 1 — company
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState<Industry>("IT");

  // Step 2 — plan
  const [planKey, setPlanKey] = useState<string>("free");
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [seats, setSeats] = useState(1);

  // Step 3 — account
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState<{ result: SignupResult; email: string; password: string } | null>(null);

  // Deep links from the marketing site: /signup?plan=starter&interval=year
  // and /signup?industry=Healthcare from an industry page. Applied once,
  // before the catalog arrives, so the user lands on the tier they clicked.
  useEffect(() => {
    const p = params.get("plan");
    if (p) setPlanKey(p);
    const i = params.get("interval");
    if (i === "month" || i === "year") setInterval(i);
    const ind = params.get("industry");
    if (ind && INDUSTRIES.some((x) => x.key === ind)) setIndustry(ind as Industry);
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/public/plans`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: PublicPlanCatalog) => !cancelled && setCatalog(data))
      .catch(() => !cancelled && setCatalogFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const plans = useMemo(
    () => (catalog?.plans ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [catalog],
  );
  const selectedPlan = useMemo(() => plans.find((p) => p.key === planKey) ?? null, [plans, planKey]);

  // Seats always sit inside the selected plan's own bounds. Done as an effect
  // on plan change (rather than only in the stepper) so switching from a
  // 3-seat-minimum tier to a 5-seat-minimum one corrects itself instead of
  // quoting a price the server would refuse to honour.
  useEffect(() => {
    if (!selectedPlan) return;
    setSeats((current) => clampToPlan(selectedPlan, current));
  }, [selectedPlan]);

  const total = useMemo(() => {
    if (!selectedPlan || isContactTier(selectedPlan)) return null;
    const price = priceFor(selectedPlan, interval);
    if (!price) return null;
    return selectedPlan.seatModel === "per_seat" ? price.unitAmountCents * seats : price.unitAmountCents;
  }, [selectedPlan, interval, seats]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await signup({
        email,
        password,
        companyName,
        displayName,
        industry,
        planKey,
        interval,
        seats,
      });
      setReady({ result, email, password });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (ready) return <WorkspaceReady ready={ready} router={router} />;

  const canAdvance =
    step === 0 ? companyName.trim().length > 0 : step === 1 ? !!selectedPlan && !isContactTier(selectedPlan) : true;

  return (
    <main className="relative min-h-screen overflow-hidden bg-bg px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_0%,var(--color-accent)_0%,transparent_70%)] opacity-[0.08]"
      />
      <div className="relative z-10 mx-auto w-full max-w-5xl">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Purnit home">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-fg">
              <Icon name="auto_awesome" size={15} />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-text">Purnit</span>
          </Link>
          <p className="text-sm text-text-muted">
            Already have a workspace?{" "}
            <Link href="/login" className="font-medium text-accent hover:underline">
              Log in
            </Link>
          </p>
        </div>

        <Stepper step={step} />

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="rounded-xl border border-border bg-surface p-6 sm:p-8">
            {step === 0 && (
              <CompanyStep
                companyName={companyName}
                setCompanyName={setCompanyName}
                industry={industry}
                setIndustry={setIndustry}
              />
            )}
            {step === 1 && (
              <PlanStep
                plans={plans}
                failed={catalogFailed}
                planKey={planKey}
                setPlanKey={setPlanKey}
                interval={interval}
                setInterval={setInterval}
                seats={seats}
                setSeats={setSeats}
                selectedPlan={selectedPlan}
              />
            )}
            {step === 2 && (
              <AccountStep
                displayName={displayName}
                setDisplayName={setDisplayName}
                email={email}
                setEmail={setEmail}
                password={password}
                setPassword={setPassword}
                onSubmit={handleCreate}
                submitting={submitting}
                error={error}
                stripeConfigured={catalog?.stripeConfigured ?? false}
                selectedPlan={selectedPlan}
              />
            )}

            {step < 2 && (
              <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-6">
                <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
                  Back
                </Button>
                <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance} size="lg">
                  Continue
                </Button>
              </div>
            )}
            {step === 2 && (
              <div className="mt-6 border-t border-border pt-6">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Button>
              </div>
            )}
          </div>

          <OrderSummary
            companyName={companyName}
            industry={industry}
            plan={selectedPlan}
            interval={interval}
            seats={seats}
            total={total}
          />
        </div>
      </div>
    </main>
  );
}

function clampToPlan(plan: PublicPlan, seats: number): number {
  const floor = Math.max(1, plan.minSeats);
  const atLeast = Math.max(floor, seats);
  return plan.maxSeats === null ? atLeast : Math.min(atLeast, plan.maxSeats);
}

/* ------------------------------------------------------------------ steps */

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {STEPS.map((label, i) => {
        const state = i < step ? "done" : i === step ? "current" : "upcoming";
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              aria-current={state === "current" ? "step" : undefined}
              className={[
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                state === "done"
                  ? "bg-success/15 text-success"
                  : state === "current"
                    ? "bg-accent text-accent-fg"
                    : "bg-surface-hover text-text-muted",
              ].join(" ")}
            >
              {state === "done" ? <Icon name="check" size={13} /> : i + 1}
            </span>
            <span className={state === "upcoming" ? "text-sm text-text-muted" : "text-sm font-medium text-text"}>{label}</span>
            {i < STEPS.length - 1 && <span className="ml-1 hidden h-px flex-1 bg-border sm:block" />}
          </li>
        );
      })}
    </ol>
  );
}

function CompanyStep({
  companyName,
  setCompanyName,
  industry,
  setIndustry,
}: {
  companyName: string;
  setCompanyName: (v: string) => void;
  industry: Industry;
  setIndustry: (v: Industry) => void;
}) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-text">Create your workspace</h1>
      <p className="mt-1.5 text-sm text-text-muted">Your industry decides which modules, roles and dashboards get provisioned.</p>

      <label className="mt-7 block">
        <span className="text-sm font-medium text-text">Company name</span>
        <Input
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Acme Industries"
          className="mt-1.5"
          autoFocus
          required
        />
      </label>

      <fieldset className="mt-7">
        <legend className="text-sm font-medium text-text">Industry</legend>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {INDUSTRIES.map((i) => {
            const selected = industry === i.key;
            return (
              <button
                key={i.key}
                type="button"
                onClick={() => setIndustry(i.key as Industry)}
                aria-pressed={selected}
                className={[
                  "flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                  selected ? "border-accent bg-accent/5" : "border-border bg-surface hover:bg-surface-hover",
                ].join(" ")}
              >
                <span className={selected ? "text-accent" : "text-text-muted"}>
                  <Icon name={i.icon} size={19} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text">{i.name}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{i.tagline}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

function PlanStep({
  plans,
  failed,
  planKey,
  setPlanKey,
  interval,
  setInterval,
  seats,
  setSeats,
  selectedPlan,
}: {
  plans: PublicPlan[];
  failed: boolean;
  planKey: string;
  setPlanKey: (v: string) => void;
  interval: BillingInterval;
  setInterval: (v: BillingInterval) => void;
  seats: number;
  setSeats: (v: number) => void;
  selectedPlan: PublicPlan | null;
}) {
  const monthsSaved = useMemo(() => {
    for (const p of plans) {
      const n = monthsSavedYearly(p);
      if (n) return n;
    }
    return null;
  }, [plans]);

  if (failed && plans.length === 0) {
    return (
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text">Choose a plan</h1>
        <Alert tone="danger">
          <span className="text-sm">
            We couldn&rsquo;t load plans just now. You can continue — your workspace will be created on the Free plan and you can upgrade
            from billing settings at any time.
          </span>
        </Alert>
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div aria-busy="true">
        <h1 className="text-xl font-semibold tracking-tight text-text">Choose a plan</h1>
        <div className="mt-6 space-y-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg border border-border bg-surface-hover" />
          ))}
        </div>
      </div>
    );
  }

  const perSeat = selectedPlan?.seatModel === "per_seat";
  const maxSeats = selectedPlan?.maxSeats ?? null;
  const minSeats = Math.max(1, selectedPlan?.minSeats ?? 1);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text">Choose a plan</h1>
          <p className="mt-1.5 text-sm text-text-muted">You can change this at any time.</p>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-surface p-1">
          {(["month", "year"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setInterval(v)}
              aria-pressed={interval === v}
              className={[
                "rounded-md px-3 py-1 text-xs font-medium transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                interval === v ? "bg-accent text-accent-fg" : "text-text-muted hover:text-text",
              ].join(" ")}
            >
              {v === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
      </div>
      {monthsSaved !== null && interval === "year" && (
        <p className="mt-2 text-xs text-success">Yearly billing saves {monthsSaved} months.</p>
      )}

      <div className="mt-5 space-y-2.5" role="radiogroup" aria-label="Plan">
        {plans.map((p) => {
          const contact = isContactTier(p);
          const price = priceFor(p, interval);
          const selected = p.key === planKey;
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={contact}
              onClick={() => setPlanKey(p.key)}
              className={[
                "flex w-full items-center justify-between gap-4 rounded-lg border p-4 text-left transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                contact
                  ? "cursor-not-allowed border-border bg-surface opacity-60"
                  : selected
                    ? "border-accent bg-accent/5"
                    : "border-border bg-surface hover:bg-surface-hover",
              ].join(" ")}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text">{p.name}</span>
                  {p.trialDays > 0 && !contact && (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                      {p.trialDays}-day trial
                    </span>
                  )}
                </span>
                {p.tagline && <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{p.tagline}</span>}
              </span>
              <span className="shrink-0 text-right">
                {contact ? (
                  <span className="text-sm font-medium text-text-muted">Contact us</span>
                ) : (
                  <>
                    <span className="block text-sm font-semibold tabular-nums text-text">{formatUsd(price?.unitAmountCents ?? 0)}</span>
                    <span className="block text-[11px] text-text-muted">
                      {p.seatModel === "per_seat" ? `per user / ${interval === "year" ? "year" : "month"}` : "free"}
                    </span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {perSeat && (
        <div className="mt-6 rounded-lg border border-border bg-surface-sunk p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-text">How many people?</p>
              <p className="mt-0.5 text-xs text-text-muted">
                {minSeats > 1 && `Minimum ${minSeats}. `}
                You can add more at any time.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Remove a seat"
                onClick={() => setSeats(Math.max(minSeats, seats - 1))}
                disabled={seats <= minSeats}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-text transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <Icon name="remove" size={16} />
              </button>
              <input
                type="number"
                aria-label="Number of seats"
                value={seats}
                min={minSeats}
                max={maxSeats ?? undefined}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(n)) setSeats(Math.max(minSeats, maxSeats === null ? n : Math.min(n, maxSeats)));
                }}
                className="h-9 w-16 rounded-md border border-border bg-surface text-center text-sm tabular-nums text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              />
              <button
                type="button"
                aria-label="Add a seat"
                onClick={() => setSeats(maxSeats === null ? seats + 1 : Math.min(maxSeats, seats + 1))}
                disabled={maxSeats !== null && seats >= maxSeats}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-text transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <Icon name="add" size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedPlan?.maxSeats !== null && selectedPlan?.maxSeats !== undefined && (
        <p className="mt-3 text-xs text-text-muted">
          The {selectedPlan.name} plan includes up to {selectedPlan.maxSeats} users.
        </p>
      )}
    </div>
  );
}

function AccountStep({
  displayName,
  setDisplayName,
  email,
  setEmail,
  password,
  setPassword,
  onSubmit,
  submitting,
  error,
  stripeConfigured,
  selectedPlan,
}: {
  displayName: string;
  setDisplayName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  submitting: boolean;
  error: string | null;
  stripeConfigured: boolean;
  selectedPlan: PublicPlan | null;
}) {
  const paid = !!selectedPlan && !isContactTier(selectedPlan) && (priceFor(selectedPlan, "month")?.unitAmountCents ?? 0) > 0;

  return (
    <form onSubmit={onSubmit}>
      <h1 className="text-xl font-semibold tracking-tight text-text">Create your account</h1>
      <p className="mt-1.5 text-sm text-text-muted">You&rsquo;ll be your workspace&rsquo;s first admin.</p>

      <div className="mt-7 flex flex-col gap-4">
        <label className="block">
          <span className="text-sm font-medium text-text">Your name</span>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1.5" required autoFocus />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-text">Work email</span>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" required />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-text">Password</span>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5"
            minLength={8}
            required
          />
          <span className="mt-1 block text-xs text-text-muted">At least 8 characters.</span>
        </label>
      </div>

      {/* Says exactly what the next click does. A paid signup on a deployment
       * with no live billing must not imply a card is about to be charged. */}
      {paid && !stripeConfigured && (
        <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-info/30 bg-info/5 p-3.5">
          <Icon name="info" size={16} className="mt-0.5 shrink-0 text-info" />
          <p className="text-xs leading-relaxed text-text-muted">
            Card payments are being finalized. Your workspace will be created on the {selectedPlan?.name} plan right away, and we&rsquo;ll
            ask for payment details before any charge is made.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-5">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <Button type="submit" disabled={submitting} size="lg" className="mt-6 w-full">
        {submitting ? "Creating your workspace…" : paid && stripeConfigured ? "Continue to payment" : "Create workspace"}
      </Button>

      <p className="mt-4 text-center text-xs leading-relaxed text-text-muted">
        By creating a workspace you agree to our{" "}
        <Link href="/legal/terms" className="text-accent hover:underline">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/legal/privacy" className="text-accent hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}

/* ---------------------------------------------------------------- summary */

function OrderSummary({
  companyName,
  industry,
  plan,
  interval,
  seats,
  total,
}: {
  companyName: string;
  industry: Industry;
  plan: PublicPlan | null;
  interval: BillingInterval;
  seats: number;
  total: number | null;
}) {
  const industryName = INDUSTRIES.find((i) => i.key === industry)?.name ?? industry;
  const perSeat = plan?.seatModel === "per_seat";
  const unit = plan ? priceFor(plan, interval)?.unitAmountCents ?? 0 : 0;

  return (
    <aside className="rounded-xl border border-border bg-surface p-6 lg:sticky lg:top-6">
      <h2 className="text-sm font-semibold text-text">Summary</h2>

      <dl className="mt-4 space-y-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-text-muted">Workspace</dt>
          <dd className="min-w-0 truncate text-right font-medium text-text">{companyName || "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text-muted">Industry</dt>
          <dd className="text-right font-medium text-text">{industryName}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text-muted">Plan</dt>
          <dd className="text-right font-medium text-text">{plan?.name ?? "—"}</dd>
        </div>
        {perSeat && (
          <>
            <div className="flex justify-between gap-3">
              <dt className="text-text-muted">Billing</dt>
              <dd className="text-right font-medium capitalize text-text">{interval === "year" ? "Yearly" : "Monthly"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-text-muted">Seats</dt>
              <dd className="text-right font-medium tabular-nums text-text">
                {seats} &times; {formatUsd(unit)}
              </dd>
            </div>
          </>
        )}
      </dl>

      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-text">Total</span>
          <span className="text-right">
            <span className="block text-xl font-semibold tabular-nums text-text">{total === null ? "—" : formatUsd(total)}</span>
            {total !== null && total > 0 && (
              <span className="block text-[11px] text-text-muted">per {interval === "year" ? "year" : "month"}</span>
            )}
          </span>
        </div>
        {plan && plan.trialDays > 0 && total !== null && total > 0 && (
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-success">
            <Icon name="check_circle" size={14} className="mt-0.5 shrink-0" />
            Free for {plan.trialDays} days — you won&rsquo;t be charged until then.
          </p>
        )}
        {total === 0 && <p className="mt-3 text-xs text-text-muted">No payment details needed.</p>}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------ provisioned */

/**
 * The workspace exists at this point. Two things still have to happen, in
 * this order: the user must write down their Workspace ID (they need it at
 * every login, and it is shown exactly once), and — for a paid plan on a
 * Stripe-configured deployment — they go to Checkout.
 *
 * Checkout is reached by logging in first and calling the ordinary
 * `billing.createCheckoutSession` mutation, rather than by adding a public
 * checkout endpoint. That keeps the permission gate (`billing:manage`) and
 * every rule Phase 01 established intact — signup does not get a private door
 * into billing.
 */
function WorkspaceReady({
  ready,
  router,
}: {
  ready: { result: SignupResult; email: string; password: string };
  router: ReturnType<typeof useRouter>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { result } = ready;

  async function handleContinue() {
    setBusy(true);
    setError(null);
    try {
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email: ready.email,
        password: ready.password,
      });
      if (loginError || !data.session) {
        throw new Error(loginError?.message ?? "Account created, but automatic sign-in failed. Please log in.");
      }
      setAccessToken(data.session.access_token);

      if (result.checkoutRequired) {
        const session = (await callMutation("billing.createCheckoutSession", {
          planKey: result.plan,
          interval: result.billingInterval ?? "month",
          seats: result.seats,
        })) as { url?: string };
        if (session?.url) {
          window.location.href = session.url;
          return;
        }
        // Checkout couldn't be started. The workspace is real and usable, so
        // land them in it rather than stranding them on this screen — billing
        // settings can finish the job.
        setError("Your workspace is ready, but we couldn't start checkout. You can add payment details from billing settings.");
      }

      router.push("/workspace");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,var(--color-accent)_0%,transparent_70%)] opacity-[0.1]"
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-surface p-7 shadow-sm">
        <div className="mb-5 flex justify-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-success/15 text-success">
            <Icon name="check" size={20} />
          </span>
        </div>
        <h1 className="text-center text-lg font-semibold text-text">Your workspace is ready</h1>

        <div className="mt-5 rounded-lg border border-accent/20 bg-accent/5 p-4">
          <div className="flex items-start gap-2.5">
            <Icon name="key" size={16} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 text-sm text-text">
              <p className="font-medium">Save your Workspace ID</p>
              <p className="mt-1 break-all font-mono text-[13px] text-text">{result.workspaceId}</p>
              <p className="mt-2 text-xs leading-relaxed text-text-muted">
                You&rsquo;ll need this along with your email and password every time you log in. This is the only time we show it.
              </p>
            </div>
          </div>
        </div>

        {result.checkoutRequired && (
          <p className="mt-4 text-center text-xs text-text-muted">Next: payment details to start your trial.</p>
        )}

        {error && (
          <div className="mt-4">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}

        <Button onClick={handleContinue} disabled={busy} size="lg" className="mt-5 w-full">
          {busy ? "Just a moment…" : result.checkoutRequired ? "Continue to payment" : "Go to your workspace"}
        </Button>
      </div>
    </main>
  );
}
