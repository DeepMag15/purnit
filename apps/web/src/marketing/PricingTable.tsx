"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "../ui/Icon";
import {
  formatUsd,
  isContactTier,
  monthlyEquivalentCents,
  monthsSavedYearly,
  priceFor,
  type BillingInterval,
  type PublicPlan,
  type PublicPlanCatalog,
} from "./plans";

/** The tier given visual emphasis. A pricing page with no recommendation
 * makes the reader do work; one that shouts makes them distrust it. One
 * quiet accent border and a label is the whole treatment. */
const FEATURED_KEY = "professional";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function PricingTable({
  initialCatalog,
  /** The landing page shows the tiers without the FAQ-scale detail; the
   * pricing page shows everything. Same component, so the two can never
   * disagree about a price. */
  compact = false,
}: {
  initialCatalog: PublicPlanCatalog | null;
  compact?: boolean;
}) {
  const [catalog, setCatalog] = useState<PublicPlanCatalog | null>(initialCatalog);
  const [failed, setFailed] = useState(false);
  const [interval, setInterval] = useState<BillingInterval>("month");

  // Only runs when the server-side fetch came back empty — `next build` runs
  // in CI with no API reachable, so the page must be able to fill itself in
  // on the client rather than shipping a permanently empty pricing section.
  useEffect(() => {
    if (catalog) return;
    let cancelled = false;
    fetch(`${API_URL}/api/public/plans`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: PublicPlanCatalog) => !cancelled && setCatalog(data))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [catalog]);

  const plans = useMemo(() => (catalog?.plans ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder), [catalog]);

  // Derived from the real catalog rather than hardcoded, so changing the
  // seeded discount changes this copy automatically.
  const monthsSaved = useMemo(() => {
    for (const p of plans) {
      const n = monthsSavedYearly(p);
      if (n) return n;
    }
    return null;
  }, [plans]);

  if (failed && plans.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <p className="text-sm text-text-muted">
          Pricing isn&rsquo;t loading right now.{" "}
          <Link href="/signup" className="font-medium text-accent hover:underline">
            Start a workspace
          </Link>{" "}
          — the Free plan needs no payment details.
        </p>
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading pricing">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[420px] animate-pulse rounded-xl border border-border bg-surface" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex flex-col items-center gap-3">
        <div role="group" aria-label="Billing interval" className="inline-flex rounded-lg border border-border bg-surface p-1">
          {(["month", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setInterval(value)}
              aria-pressed={interval === value}
              className={[
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                interval === value ? "bg-accent text-accent-fg" : "text-text-muted hover:text-text",
              ].join(" ")}
            >
              {value === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
        {monthsSaved !== null && (
          <p className="text-xs text-text-muted">
            Yearly billing saves {monthsSaved} month{monthsSaved === 1 ? "" : "s"}.
          </p>
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => (
          <PlanCard key={plan.key} plan={plan} interval={interval} compact={compact} />
        ))}
      </div>

      {catalog && !catalog.stripeConfigured && (
        <p className="mt-6 text-center text-xs text-text-muted">
          Card payments are being finalized. You can create a workspace now — we&rsquo;ll collect payment details before your trial ends.
        </p>
      )}
    </div>
  );
}

function PlanCard({ plan, interval, compact }: { plan: PublicPlan; interval: BillingInterval; compact: boolean }) {
  const featured = plan.key === FEATURED_KEY;
  const contact = isContactTier(plan);
  const price = priceFor(plan, interval);
  const free = !contact && price?.unitAmountCents === 0;

  return (
    <div
      className={[
        "relative flex flex-col rounded-xl border bg-surface p-6",
        featured ? "border-accent/50 shadow-md" : "border-border",
      ].join(" ")}
    >
      {featured && (
        <span className="absolute -top-2.5 left-6 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-accent-fg">
          Most popular
        </span>
      )}

      <h3 className="text-base font-semibold text-text">{plan.name}</h3>
      {plan.tagline && <p className="mt-1 min-h-[40px] text-sm leading-relaxed text-text-muted">{plan.tagline}</p>}

      <div className="mt-5 min-h-[68px]">
        {contact ? (
          <p className="text-3xl font-semibold tracking-tight text-text">Custom</p>
        ) : (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-semibold tracking-tight tabular-nums text-text">
                {formatUsd(monthlyEquivalentCents(price!))}
              </span>
              {!free && <span className="text-sm text-text-muted">/ user / month</span>}
            </div>
            {/* The real charge is always shown next to the comparable
             * monthly figure, never instead of it — nobody should be
             * surprised by what actually leaves their account. */}
            {!free && interval === "year" && (
              <p className="mt-1 text-xs text-text-muted tabular-nums">{formatUsd(price!.unitAmountCents)} / user, billed yearly</p>
            )}
            {free && <p className="mt-1 text-xs text-text-muted">Free forever</p>}
          </>
        )}
      </div>

      <div className="mt-5">
        {contact ? (
          <Link
            href="/signup"
            className="interactive-press inline-flex h-10 w-full items-center justify-center rounded-md border border-border bg-surface text-sm font-medium text-text transition-colors duration-[var(--duration-base)] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            Contact us
          </Link>
        ) : (
          <Link
            href={`/signup?plan=${plan.key}&interval=${interval}`}
            className={[
              "interactive-press inline-flex h-10 w-full items-center justify-center rounded-md text-sm font-medium transition-colors duration-[var(--duration-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
              featured
                ? "bg-accent text-accent-fg hover:bg-accent-hover"
                : "border border-border bg-surface text-text hover:bg-surface-hover",
            ].join(" ")}
          >
            {free ? "Start for free" : plan.trialDays > 0 ? `Start ${plan.trialDays}-day trial` : "Get started"}
          </Link>
        )}
      </div>

      <dl className="mt-6 space-y-2 border-t border-border pt-5 text-xs text-text-muted">
        <div className="flex items-center justify-between gap-3">
          <dt>Users</dt>
          <dd className="font-medium tabular-nums text-text">
            {plan.maxSeats !== null ? `Up to ${plan.maxSeats}` : plan.minSeats > 1 ? `${plan.minSeats} minimum` : "Unlimited"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt>AI messages</dt>
          <dd className="font-medium tabular-nums text-text">
            {plan.aiMessageDailyCap === null ? "Unlimited" : `${plan.aiMessageDailyCap.toLocaleString()} / day`}
          </dd>
        </div>
      </dl>

      {!compact && plan.highlights.length > 0 && (
        <ul className="mt-5 space-y-2.5 border-t border-border pt-5">
          {plan.highlights.map((h) => (
            <li key={h} className="flex gap-2.5 text-sm text-text-muted">
              <Icon name="check" size={16} className="mt-0.5 shrink-0 text-success" />
              <span className="leading-relaxed">{h}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
