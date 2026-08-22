import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "../../../ui/Icon";
import { PRICING_FAQ } from "../../../marketing/content";
import { fetchPlanCatalog } from "../../../marketing/plans";
import { PricingTable } from "../../../marketing/PricingTable";

export const metadata: Metadata = {
  title: "Pricing — Purnit",
  description:
    "Per-seat pricing for Purnit. Free for up to 3 users, Starter and Professional billed per person with a 14-day trial, and Enterprise for organizations with compliance requirements.",
};

export const revalidate = 300;

export default async function PricingPage() {
  const catalog = await fetchPlanCatalog();

  return (
    <>
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-balance text-4xl font-semibold tracking-tight text-text sm:text-[2.75rem]">Simple, per-person pricing</h1>
            <p className="mt-5 text-lg leading-relaxed text-text-muted">
              You pay for the people who use it. Nothing else changes between plans that you cannot see on this page.
            </p>
          </div>
          <div className="mt-14">
            <PricingTable initialCatalog={catalog} />
          </div>
        </div>
      </section>

      <ComparisonNote />
      <Faq />

      <section>
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-balance text-2xl font-semibold tracking-tight text-text">Still deciding?</h2>
            <p className="mt-3 text-base leading-relaxed text-text-muted">
              The Free plan is a real workspace, not a demo. Start there and upgrade when your team outgrows three people.
            </p>
            <div className="mt-7">
              <Link
                href="/signup"
                className="interactive-press inline-flex h-11 items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-accent-fg transition-colors duration-[var(--duration-base)] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                Create a free workspace
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * Says plainly which differences between tiers are enforced by the product
 * and which are commitments we make. A pricing page that blurs the two is
 * the thing customers discover later and resent.
 */
function ComparisonNote() {
  const rows = [
    { label: "Seat limit", detail: "Enforced. Invitations are blocked once every seat is in use." },
    { label: "AI assistant messages", detail: "Enforced. A per-day cap on assistant messages across your whole workspace." },
    { label: "Leave management", detail: "Enforced. Available from Starter upward." },
    { label: "CRM", detail: "Enforced. Available on Professional and Enterprise." },
    { label: "Everything else", detail: "Included on every plan, including Free — projects, calendar, documents, chat, analytics and the full permissions model." },
  ];

  return (
    <section className="border-b border-border bg-surface-sunk">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="max-w-2xl">
          <h2 className="text-balance text-2xl font-semibold tracking-tight text-text">What actually differs between plans</h2>
          <p className="mt-4 text-base leading-relaxed text-text-muted">
            Four things, and we would rather list them than bury them in a comparison grid.
          </p>
        </div>
        <dl className="mt-9 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {rows.map((r) => (
            <div key={r.label} className="grid gap-1.5 p-5 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-6 sm:p-6">
              <dt className="text-sm font-semibold text-text">{r.label}</dt>
              <dd className="text-sm leading-relaxed text-text-muted">{r.detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div>
            <h2 className="text-balance text-2xl font-semibold tracking-tight text-text">Questions people actually ask</h2>
            <p className="mt-3 text-sm leading-relaxed text-text-muted">
              If yours is not here,{" "}
              <Link href="/signup" className="font-medium text-accent hover:underline">
                start a free workspace
              </Link>{" "}
              and ask us from inside it.
            </p>
          </div>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {PRICING_FAQ.map((item) => (
              <details key={item.q} className="group p-5 sm:p-6">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                  {item.q}
                  <Icon
                    name="expand_more"
                    size={18}
                    className="shrink-0 text-text-muted transition-transform duration-[var(--duration-base)] group-open:rotate-180"
                  />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-text-muted">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
