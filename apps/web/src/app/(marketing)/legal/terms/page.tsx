import type { Metadata } from "next";
import Link from "next/link";
import { Clause, LegalShell } from "../../../../marketing/LegalShell";
import { LEGAL } from "../../../../marketing/legal";

export const metadata: Metadata = {
  title: "Terms of Service — Purnit",
  description: "The terms under which Purnit workspaces are provided, including subscriptions, seats, acceptable use and termination.",
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      summary={`These terms govern your use of ${LEGAL.productName}. They describe what we provide, what you agree to, and how either of us can end the arrangement.`}
    >
      <Clause n={1} title="Who these terms are between">
        <p>
          These terms are an agreement between <strong>{LEGAL.legalEntity}</strong> (&ldquo;we&rdquo;, &ldquo;us&rdquo;) and the
          organization that creates a workspace (&ldquo;you&rdquo;, &ldquo;your organization&rdquo;).
        </p>
        <p>
          The person who signs up becomes their organization&rsquo;s first Company Admin and accepts these terms on the
          organization&rsquo;s behalf. If you are doing that, you confirm you are authorized to do so.
        </p>
      </Clause>

      <Clause n={2} title="What we provide">
        <p>
          {LEGAL.productName} is a multi-tenant software service. When you create a workspace you choose an industry blueprint, and we
          provision navigation, roles, permissions and modules around it. Your organization&rsquo;s data is isolated from every other
          organization&rsquo;s.
        </p>
        <p>
          We may add, change or remove features. If we remove something you are actively relying on, we will make a reasonable effort to
          tell you in advance.
        </p>
      </Clause>

      <Clause n={3} title="Accounts, workspaces and seats">
        <ul>
          <li>
            Each workspace has a unique Workspace ID, and every person logs in with that ID, their email and their password. You are
            responsible for keeping credentials secure.
          </li>
          <li>
            A <strong>seat</strong> is one person who can log in. Your plan determines how many seats you have; once they are all in use,
            further invitations are blocked until you add seats or remove someone.
          </li>
          <li>
            Your Company Admins control who is invited, what role they hold, and what they can access. We do not manage your
            organization&rsquo;s internal permissions for you.
          </li>
        </ul>
      </Clause>

      <Clause n={4} title="Subscriptions, billing and trials">
        <ul>
          <li>Paid plans are billed per seat, monthly or yearly, in advance. Prices are shown on our <Link href="/pricing">pricing page</Link>.</li>
          <li>
            Paid plans include a 14-day free trial. We collect a payment method when you subscribe so service is not interrupted, but you
            are not charged until the trial ends. Cancel before then and you pay nothing.
          </li>
          <li>
            <strong>Upgrades</strong> and <strong>added seats</strong> take effect immediately and are charged on a prorated basis.
          </li>
          <li>
            <strong>Downgrades</strong> and <strong>seat reductions</strong> take effect at the end of your current billing period. We do
            not refund the remainder of a period you have already paid for.
          </li>
          <li>
            If a payment fails, we will notify your admins and retry. We do not suspend a workspace immediately for a single failed
            payment, but we may suspend it if the balance remains unpaid.
          </li>
          <li>Payments are processed by Stripe. We never receive or store your full card details.</li>
        </ul>
      </Clause>

      <Clause n={5} title="Cancellation and termination">
        <ul>
          <li>
            You can cancel at any time from your billing settings. Cancellation takes effect at the end of the current period, and your
            workspace then reverts to the Free plan rather than being deleted.
          </li>
          <li>
            You can delete your account or your entire workspace from within the product. Deletion is described in our{" "}
            <Link href="/legal/privacy">Privacy Policy</Link>.
          </li>
          <li>
            We may suspend or terminate a workspace that breaches section 6, that remains unpaid, or where we are legally required to.
            Except in urgent cases, we will tell you first and give you a chance to fix the problem.
          </li>
        </ul>
      </Clause>

      <Clause n={6} title="Acceptable use">
        <p>You agree not to use {LEGAL.productName} to:</p>
        <ul>
          <li>break the law, or store data you have no right to store;</li>
          <li>attempt to access another organization&rsquo;s workspace or data, or probe for ways to do so;</li>
          <li>interfere with the service&rsquo;s operation, or work around usage limits such as seat counts or AI message caps;</li>
          <li>upload malware, or content that infringes someone else&rsquo;s rights.</li>
        </ul>
        <p>
          Security research is welcome, but please contact us at {LEGAL.contactEmail} before testing anything against production, and never
          against a workspace you do not own.
        </p>
      </Clause>

      <Clause n={7} title="Your data and your content">
        <p>
          <strong>Your data stays yours.</strong> We do not claim ownership of anything your organization puts into {LEGAL.productName}, and
          we do not sell it or use it to train AI models.
        </p>
        <p>
          You grant us only the permission we need to actually run the service: to store your data, process it to provide features you use,
          and share it with the subprocessors listed in our <Link href="/legal/privacy">Privacy Policy</Link>.
        </p>
        <p>You can export your data from within the product at any time while your workspace is active.</p>
      </Clause>

      <Clause n={8} title="AI features">
        <p>
          The AI assistant answers questions using your organization&rsquo;s own data. Before any record is sent to a model, it is re-checked
          against the permissions of the person asking — the assistant cannot surface something you could not already open yourself.
        </p>
        <p>
          The assistant may propose actions, such as creating a task or approving a request. It never carries one out without your explicit
          confirmation.
        </p>
        <p>
          <strong>AI output can be wrong.</strong> Treat it as a starting point, not as advice. Do not rely on it for decisions with legal,
          financial, medical or safety consequences without checking the underlying records yourself.
        </p>
      </Clause>

      <Clause n={9} title="Availability and support">
        <p>
          We work to keep {LEGAL.productName} available and reliable, but we do not currently offer a contractual uptime guarantee. Planned
          maintenance will be announced where practical.
        </p>
        <p>
          Support is provided by email. Response-time commitments described on the pricing page are goals we intend to meet, not contractual
          service levels, unless we have signed a separate agreement with you.
        </p>
      </Clause>

      <Clause n={10} title="Liability">
        <p>
          {LEGAL.productName} is provided as-is. To the fullest extent the law allows, we are not liable for indirect or consequential
          losses, including lost profits or lost data, and our total liability in any 12-month period is limited to what you paid us in that
          period.
        </p>
        <p>Nothing here limits liability that cannot legally be limited.</p>
      </Clause>

      <Clause n={11} title="Changes to these terms">
        <p>
          We may update these terms. For material changes we will give notice in the product or by email before they take effect. Continuing
          to use {LEGAL.productName} after that means you accept the updated terms.
        </p>
      </Clause>

      <Clause n={12} title="Governing law and contact">
        <p>These terms are governed by the laws of {LEGAL.governingLaw}.</p>
        <p>Questions about these terms: {LEGAL.contactEmail}</p>
      </Clause>
    </LegalShell>
  );
}
