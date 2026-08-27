import Link from "next/link";
import { Icon } from "../ui/Icon";
import { INDUSTRIES } from "./content";

/**
 * Go-Live, Phase 02 — the public site's footer.
 *
 * A server component: nothing here is interactive. The legal links are real
 * routes, not placeholders — an enterprise buyer checks for them, and a dead
 * "Terms" link reads worse than an honestly-labelled draft.
 */
export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-surface-sunk">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-fg">
                <Icon name="auto_awesome" size={15} />
              </span>
              <span className="text-[15px] font-semibold tracking-tight text-text">Purnit</span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-text-muted">
              Enterprise workspaces generated from your industry&rsquo;s blueprint — not assembled by hand.
            </p>
          </div>

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Platform</h2>
            <ul className="mt-4 space-y-2.5">
              {[
                { href: "/#capabilities", label: "Capabilities" },
                { href: "/#security", label: "Security" },
                { href: "/pricing", label: "Pricing" },
              ].map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-text">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Industries</h2>
            <ul className="mt-4 space-y-2.5">
              {INDUSTRIES.map((i) => (
                <li key={i.slug}>
                  <Link
                    href={`/industries/${i.slug}`}
                    className="text-sm text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
                  >
                    {i.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Company</h2>
            <ul className="mt-4 space-y-2.5">
              {[
                { href: "/legal/terms", label: "Terms of Service" },
                { href: "/legal/privacy", label: "Privacy Policy" },
                { href: "/login", label: "Log in" },
                { href: "/signup", label: "Get started" },
              ].map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-text">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-text-muted">&copy; {new Date().getFullYear()} Purnit. All rights reserved.</p>
          <p className="text-xs text-text-muted">Built for organizations that outgrew the generic tool.</p>
        </div>
      </div>
    </footer>
  );
}
