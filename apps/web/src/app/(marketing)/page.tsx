import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "../../ui/Icon";
import { CAPABILITIES, INDUSTRIES } from "../../marketing/content";
import { fetchPlanCatalog } from "../../marketing/plans";
import { PricingTable } from "../../marketing/PricingTable";

export const metadata: Metadata = {
  title: "Purnit — Enterprise workspaces, generated for your industry",
  description:
    "Purnit generates a complete enterprise workspace — navigation, dashboards, roles and permissions — from your industry's blueprint. Healthcare, Education, Finance, Manufacturing and IT.",
};

/** Static shell, but the pricing preview needs live prices; ISR keeps them
 * fresh without a redeploy and lets the page build even when the API is
 * unreachable in CI (see fetchPlanCatalog). */
export const revalidate = 300;

export default async function LandingPage() {
  const catalog = await fetchPlanCatalog();

  return (
    <>
      <Hero />
      <Thesis />
      <Industries />
      <Capabilities />
      <Security />
      <Pricing catalog={catalog} />
      <FinalCta />
    </>
  );
}

/* ------------------------------------------------------------------ hero */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      {/* One restrained wash behind the headline. Color as atmosphere, at
       * very low opacity — not a saturated gradient hero. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_50%_-10%,var(--color-accent)_0%,transparent_65%)] opacity-[0.10]"
      />
      <div className="relative mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Five industry blueprints, one platform
          </p>
          <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-text sm:text-5xl lg:text-[3.4rem]">
            Your industry&rsquo;s workspace, ready on day one
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg leading-relaxed text-text-muted">
            Purnit generates a complete enterprise workspace — navigation, dashboards, roles and permissions — from your industry&rsquo;s
            blueprint. Not a blank tool you spend six months configuring.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="interactive-press inline-flex h-11 w-full items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-accent-fg transition-colors duration-[var(--duration-base)] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 sm:w-auto"
            >
              Get started free
            </Link>
            <Link
              href="/login"
              className="interactive-press inline-flex h-11 w-full items-center justify-center rounded-md border border-border bg-surface px-6 text-sm font-medium text-text transition-colors duration-[var(--duration-base)] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 sm:w-auto"
            >
              Log in
            </Link>
          </div>
          <p className="mt-4 text-xs text-text-muted">Free for up to 3 users. No card required to start.</p>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- thesis */

function Thesis() {
  const points = [
    {
      icon: "dashboard_customize",
      title: "Configuration, not customization",
      body: "Your workspace is compiled on the server from your blueprint, your overrides, your plan and your permissions. Nothing about what you see is decided in the browser.",
    },
    {
      icon: "lock_person",
      title: "Permissions that are actually enforced",
      body: "Anything you lack access to is absent from the data the server sends you — not hidden by the interface. There is nothing to inspect your way around.",
    },
    {
      icon: "swap_horiz",
      title: "One platform, genuinely different workspaces",
      body: "A hospital and a factory do not get the same tool with different labels. They get different objects, different roles, different dashboards.",
    },
  ];

  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="max-w-2xl">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-text">
            Most platforms give every industry the same blank canvas
          </h2>
          <p className="mt-4 text-base leading-relaxed text-text-muted">
            Then you spend months turning it into something your team recognizes. Purnit starts from your industry instead — and keeps the
            parts every organization needs underneath.
          </p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {points.map((p) => (
            <div key={p.title} className="rounded-xl border border-border bg-surface p-6">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-hover text-text-muted">
                <Icon name={p.icon} size={19} />
              </span>
              <h3 className="mt-4 text-[15px] font-semibold text-text">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ industries */

function Industries() {
  return (
    <section id="industries" className="scroll-mt-20 border-b border-border bg-surface-sunk">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="max-w-2xl">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-text">Built for five industries, in their own vocabulary</h2>
          <p className="mt-4 text-base leading-relaxed text-text-muted">
            Each blueprint ships its own objects, roles and dashboards. Pick yours at signup and the workspace is provisioned around it.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {INDUSTRIES.map((industry) => (
            <Link
              key={industry.slug}
              href={`/industries/${industry.slug}`}
              className="interactive-lift group flex flex-col rounded-xl border border-border bg-surface p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-hover text-text-muted transition-colors duration-[var(--duration-base)] group-hover:text-accent">
                <Icon name={industry.icon} size={19} />
              </span>
              <h3 className="mt-4 text-[15px] font-semibold text-text">{industry.name}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-text-muted">{industry.summary}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {industry.modules.slice(0, 3).map((m) => (
                  <span key={m} className="rounded-md bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-text-muted">
                    {m}
                  </span>
                ))}
                {industry.modules.length > 3 && (
                  <span className="rounded-md px-2 py-0.5 text-[11px] font-medium text-text-muted">
                    +{industry.modules.length - 3}
                  </span>
                )}
              </div>
              <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-accent">
                Explore
                <Icon name="arrow_forward" size={15} />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- capabilities */

function Capabilities() {
  return (
    <section id="capabilities" className="scroll-mt-20 border-b border-border">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="max-w-2xl">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-text">Everything your organization runs on</h2>
          <p className="mt-4 text-base leading-relaxed text-text-muted">
            The shared platform underneath every blueprint. Same engine, same permissions model, whichever industry you picked.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <div key={c.key} className="rounded-xl border border-border bg-surface p-7">
              <div className="flex items-start gap-4">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-text-muted">
                  <Icon name={c.icon} size={20} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-text">{c.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-text-muted">{c.summary}</p>
                </div>
              </div>
              <ul className="mt-5 space-y-2.5">
                {c.points.map((p) => (
                  <li key={p} className="flex gap-2.5 text-sm text-text-muted">
                    <Icon name="check" size={16} className="mt-0.5 shrink-0 text-success" />
                    <span className="leading-relaxed">{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- security */

function Security() {
  const layers = [
    {
      label: "Database",
      title: "Row-level security",
      body: "Every tenant-owned table carries an isolation policy enforced by Postgres itself. Even a bug in application code cannot return another organization's rows.",
    },
    {
      label: "Server",
      title: "Permission resolver",
      body: "Your effective permissions are computed server-side from your roles, then used to prune your workspace before a single byte is sent.",
    },
    {
      label: "Every request",
      title: "Independent re-checks",
      body: "Each data source and each write re-checks tenant and scope at call time. Nothing trusts a decision made earlier in the request.",
    },
  ];

  return (
    <section id="security" className="scroll-mt-20 border-b border-border bg-surface-sunk">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Security</p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-text">Defense in depth, not a permissions checkbox</h2>
            <p className="mt-4 text-base leading-relaxed text-text-muted">
              Multi-tenancy is the hardest thing to retrofit and the easiest thing to get quietly wrong. Purnit enforces it at three
              independent layers, so no single mistake exposes another organization&rsquo;s data.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                "Seven-tier role hierarchy with own, team, department, subtree and organization scopes",
                "Per-user delegation, granted and revoked without cloning a role",
                "Enterprise SSO through your own identity provider",
                "Append-only audit log of sensitive actions",
              ].map((item) => (
                <li key={item} className="flex gap-2.5 text-sm text-text-muted">
                  <Icon name="check" size={16} className="mt-0.5 shrink-0 text-success" />
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            {layers.map((layer) => (
              <div key={layer.label} className="rounded-xl border border-border bg-surface p-6">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">{layer.label}</p>
                <h3 className="mt-2 text-[15px] font-semibold text-text">{layer.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-muted">{layer.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- pricing */

function Pricing({ catalog }: { catalog: Awaited<ReturnType<typeof fetchPlanCatalog>> }) {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-text">Priced per person, not per promise</h2>
          <p className="mt-4 text-base leading-relaxed text-text-muted">
            Start free for up to three people. Pay for seats only as your team actually grows.
          </p>
        </div>
        <div className="mt-12">
          <PricingTable initialCatalog={catalog} compact />
        </div>
        <p className="mt-8 text-center text-sm">
          <Link href="/pricing" className="font-medium text-accent hover:underline">
            Compare plans in detail
          </Link>
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- final cta */

function FinalCta() {
  return (
    <section>
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-text">Create your workspace in a few minutes</h2>
          <p className="mt-4 text-base leading-relaxed text-text-muted">
            Pick your industry, name your company, and Purnit provisions the roles, navigation and dashboards around it.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="interactive-press inline-flex h-11 w-full items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-accent-fg transition-colors duration-[var(--duration-base)] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 sm:w-auto"
            >
              Get started free
            </Link>
            <Link
              href="/pricing"
              className="interactive-press inline-flex h-11 w-full items-center justify-center rounded-md border border-border bg-surface px-6 text-sm font-medium text-text transition-colors duration-[var(--duration-base)] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 sm:w-auto"
            >
              See pricing
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
