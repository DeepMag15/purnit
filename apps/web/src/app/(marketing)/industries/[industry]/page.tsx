import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "../../../../ui/Icon";
import { CAPABILITIES, INDUSTRIES, industryBySlug } from "../../../../marketing/content";

/** All five blueprints are known at build time, so every industry page is a
 * real static route rather than rendered on demand. */
export function generateStaticParams() {
  return INDUSTRIES.map((i) => ({ industry: i.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ industry: string }> }): Promise<Metadata> {
  const { industry: slug } = await params;
  const industry = industryBySlug(slug);
  if (!industry) return { title: "Industry not found — Purnit" };
  return {
    title: `${industry.name} — Purnit`,
    description: industry.summary,
  };
}

export default async function IndustryPage({ params }: { params: Promise<{ industry: string }> }) {
  const { industry: slug } = await params;
  const industry = industryBySlug(slug);
  if (!industry) notFound();

  const others = INDUSTRIES.filter((i) => i.slug !== industry.slug);

  return (
    <>
      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_50%_-10%,var(--color-accent)_0%,transparent_65%)] opacity-[0.08]"
        />
        <div className="relative mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <nav aria-label="Breadcrumb" className="mb-8">
            <Link href="/#industries" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text">
              <Icon name="arrow_back" size={15} />
              All industries
            </Link>
          </nav>

          <div className="max-w-3xl">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-accent ring-1 ring-border">
              <Icon name={industry.icon} size={22} />
            </span>
            <h1 className="mt-6 text-balance text-4xl font-semibold leading-tight tracking-tight text-text sm:text-[2.75rem]">
              {industry.name}
            </h1>
            <p className="mt-3 text-lg text-text-muted">{industry.tagline}</p>
            <p className="mt-6 text-base leading-relaxed text-text-muted">{industry.intro}</p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href={`/signup?industry=${encodeURIComponent(industry.key)}`}
                className="interactive-press inline-flex h-11 items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-accent-fg transition-colors duration-[var(--duration-base)] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                Create a {industry.name} workspace
              </Link>
              <Link
                href="/pricing"
                className="interactive-press inline-flex h-11 items-center justify-center rounded-md border border-border bg-surface px-6 text-sm font-medium text-text transition-colors duration-[var(--duration-base)] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                See pricing
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* What this blueprint adds */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] lg:items-start">
            <div>
              <h2 className="text-balance text-2xl font-semibold tracking-tight text-text">What this workspace opens with</h2>
              <div className="mt-8 space-y-5">
                {industry.highlights.map((h) => (
                  <div key={h.title} className="rounded-xl border border-border bg-surface p-6">
                    <h3 className="text-[15px] font-semibold text-text">{h.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-text-muted">{h.body}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-xl border border-border bg-surface p-6">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Industry modules</h3>
                <ul className="mt-4 space-y-2.5">
                  {industry.modules.map((m) => (
                    <li key={m} className="flex gap-2.5 text-sm text-text">
                      <Icon name="check" size={16} className="mt-0.5 shrink-0 text-success" />
                      <span>{m}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 border-t border-border pt-4 text-xs leading-relaxed text-text-muted">
                  Plus every core module — projects, calendar, documents, chat, analytics and the AI assistant.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-surface p-6">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Roles provisioned</h3>
                <ol className="mt-4 space-y-2">
                  {industry.roles.map((role, index) => (
                    <li key={role} className="flex items-center gap-3 text-sm text-text">
                      <span className="w-4 shrink-0 text-right text-xs tabular-nums text-text-muted">{index + 1}</span>
                      <span>{role}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-4 border-t border-border pt-4 text-xs leading-relaxed text-text-muted">
                  Each role inherits from the one below it and adds only what its job needs. You can clone and customize any of them.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Shared platform reminder */}
      <section className="border-b border-border bg-surface-sunk">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="max-w-2xl">
            <h2 className="text-balance text-2xl font-semibold tracking-tight text-text">The same platform underneath</h2>
            <p className="mt-4 text-base leading-relaxed text-text-muted">
              The {industry.name} blueprint changes what your workspace is about. It does not change what it is built on.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <div key={c.key} className="rounded-xl border border-border bg-surface p-5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-surface-hover text-text-muted">
                  <Icon name={c.icon} size={17} />
                </span>
                <h3 className="mt-3 text-sm font-semibold text-text">{c.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{c.summary}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Other industries */}
      <section>
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <h2 className="text-balance text-2xl font-semibold tracking-tight text-text">Other industries</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {others.map((i) => (
              <Link
                key={i.slug}
                href={`/industries/${i.slug}`}
                className="interactive-lift group rounded-xl border border-border bg-surface p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-surface-hover text-text-muted transition-colors duration-[var(--duration-base)] group-hover:text-accent">
                  <Icon name={i.icon} size={17} />
                </span>
                <h3 className="mt-3 text-sm font-semibold text-text">{i.name}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{i.tagline}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
