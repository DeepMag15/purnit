import type { ReactNode } from "react";
import { Icon } from "../ui/Icon";
import { LEGAL } from "./legal";

/**
 * Go-Live, Phase 02 — shared chrome for the Terms and Privacy documents.
 *
 * The draft banner is not decoration and must not be quietly removed later:
 * these documents were drafted to describe what the product genuinely does,
 * but they have not been reviewed by a lawyer. Saying so in the document
 * itself is the honest thing to do while the company is pre-launch.
 */
export function LegalShell({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
      <h1 className="text-balance text-4xl font-semibold tracking-tight text-text">{title}</h1>
      <p className="mt-4 text-base leading-relaxed text-text-muted">{summary}</p>
      <p className="mt-4 text-sm text-text-muted">
        Last updated <time dateTime={LEGAL.lastUpdated}>{LEGAL.lastUpdated}</time>
      </p>

      <div className="mt-8 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4">
        <Icon name="gavel" size={18} className="mt-0.5 shrink-0 text-warning" />
        <div className="text-sm leading-relaxed text-text">
          <p className="font-semibold">Draft — pending legal review</p>
          <p className="mt-1 text-text-muted">
            This document describes how {LEGAL.productName} actually works, but it has not yet been reviewed by a qualified lawyer and the
            company details below are still being finalized. It is published for transparency, not as a finished agreement.
          </p>
        </div>
      </div>

      <div className="legal-body mt-12">{children}</div>

      <div className="mt-14 border-t border-border pt-6 text-sm text-text-muted">
        <p>
          <strong className="font-semibold text-text">{LEGAL.legalEntity}</strong>
          <br />
          {LEGAL.registeredAddress}
        </p>
      </div>
    </div>
  );
}

/** A numbered clause. Numbering is real structure here — legal documents are
 * cited by section, so the numbers carry information rather than decorate. */
export function Clause({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const id = `section-${n}`;
  return (
    <section id={id} className="scroll-mt-20 border-t border-border py-8 first:border-t-0 first:pt-0">
      <h2 className="flex gap-3 text-lg font-semibold tracking-tight text-text">
        <span className="tabular-nums text-text-muted">{n}.</span>
        <a href={`#${id}`} className="hover:underline">
          {title}
        </a>
      </h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-text-muted [&_a]:font-medium [&_a]:text-accent [&_a:hover]:underline [&_li]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-text [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
