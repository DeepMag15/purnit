"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "../ui/Icon";
import { NAV_LINKS } from "./content";

/**
 * Go-Live, Phase 02 — the public site's header.
 *
 * Client-side only because of the mobile disclosure and the scroll state;
 * everything it renders is otherwise static. Uses `next/link` throughout,
 * per the standing rule from the Frontend Redesign: a plain `<a href>` to an
 * internal route causes a full browser navigation, which was a real,
 * measured bug in the workspace sidebar once.
 */
export function MarketingHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // The header sits on the hero's own background at rest and only earns a
  // border and blur once content is behind it — elevation is earned, never
  // decorative (the app's own elevation doctrine, applied here).
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={[
        "sticky top-0 z-50 transition-colors duration-[var(--duration-base)]",
        scrolled ? "glass-panel border-b border-border" : "border-b border-transparent",
      ].join(" ")}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-fg">
            <Icon name="auto_awesome" size={15} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-text">Purnit</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm text-text-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link
            href="/login"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-text-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="interactive-press inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-sm font-medium text-accent-fg transition-colors duration-[var(--duration-base)] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            Get started
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 md:hidden"
        >
          <Icon name={open ? "close" : "menu"} size={20} />
        </button>
      </div>

      {open && (
        <div className="border-t border-border bg-surface md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-5 py-4 sm:px-8" aria-label="Main">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm text-text-muted hover:bg-surface-hover hover:text-text"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="rounded-md border border-border px-3 py-2 text-center text-sm font-medium text-text hover:bg-surface-hover"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                onClick={() => setOpen(false)}
                className="rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-accent-fg hover:bg-accent-hover"
              >
                Get started
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
