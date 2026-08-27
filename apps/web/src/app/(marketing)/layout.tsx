import type { ReactNode } from "react";
import { MarketingHeader } from "../../marketing/MarketingHeader";
import { MarketingFooter } from "../../marketing/MarketingFooter";

/**
 * Go-Live, Phase 02 — the public site's shell.
 *
 * A route group, so `/`, `/pricing`, `/industries/*` and `/legal/*` share a
 * header and footer without adding a path segment. Auth routes (`/login`,
 * `/signup`) deliberately stay outside it: a signup wizard with a marketing
 * nav bar inviting you to leave mid-flow is a worse funnel, not a more
 * consistent one.
 *
 * The root layout already supplies the theme provider, fonts and toasts, so
 * this adds only the chrome.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-fg"
      >
        Skip to content
      </a>
      <MarketingHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
