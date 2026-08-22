import type { Metadata } from "next";
import Link from "next/link";
import { Clause, LegalShell } from "../../../../marketing/LegalShell";
import { LEGAL, SUBPROCESSORS } from "../../../../marketing/legal";

export const metadata: Metadata = {
  title: "Privacy Policy — Purnit",
  description:
    "What data Purnit stores, how tenant isolation works, which subprocessors receive data, how AI features handle your records, and how to export or delete your data.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      summary={`What ${LEGAL.productName} stores, who else touches it, and how you get it back or delete it. Written to describe what the product actually does rather than to cover every theoretical case.`}
    >
      <Clause n={1} title="Who controls the data">
        <p>
          For data your organization puts into its workspace — records, documents, messages — <strong>your organization is the controller</strong>{" "}
          and we are the processor. We handle that data on your instructions, which in practice means providing the features you use.
        </p>
        <p>
          For a small amount of data we need to run the business — your billing contact, your account email, error logs — we are the
          controller.
        </p>
      </Clause>

      <Clause n={2} title="What we store">
        <ul>
          <li>
            <strong>Account data:</strong> name, email address, job title, department and team placement, reporting line, role assignments,
            and whether an account is active.
          </li>
          <li>
            <strong>Workspace data:</strong> everything your organization creates — projects, tasks, calendar events, documents, messages,
            comments, attendance and leave records, and the industry-specific records for your blueprint (for example patients, students,
            invoices or work orders).
          </li>
          <li>
            <strong>Files:</strong> documents you upload, stored in a private bucket and served only through short-lived links generated per
            request.
          </li>
          <li>
            <strong>Billing data:</strong> your plan, seat count, subscription status and billing history. Card details are held by Stripe,
            not by us.
          </li>
          <li>
            <strong>Operational data:</strong> authentication events, an append-only audit log of sensitive actions, and technical error
            reports.
          </li>
        </ul>
        <p>
          We do <strong>not</strong> use advertising or analytics tracking cookies. The only things stored in your browser are your login
          session token and your theme preference.
        </p>
      </Clause>

      <Clause n={3} title="How your data is kept separate from other organizations">
        <p>This is the part most worth being specific about, because it is the risk that matters most in a multi-tenant product.</p>
        <ul>
          <li>
            Every record carries the identifier of the organization it belongs to, and the database enforces an isolation policy on every
            such table using PostgreSQL row-level security. That check runs inside the database, independently of our application code.
          </li>
          <li>
            Separately, the server computes what each person is allowed to see and removes everything else before responding. Data you lack
            permission for is not sent to your browser and hidden — it is never sent.
          </li>
          <li>Every read and write re-checks organization and scope at the moment it runs, rather than trusting an earlier decision.</li>
        </ul>
        <p>
          The effect is defense in depth: a mistake in one layer does not by itself expose another organization&rsquo;s data. We do not claim
          this makes a breach impossible — no one honestly can — only that isolation does not depend on any single piece of code being
          correct.
        </p>
      </Clause>

      <Clause n={4} title="How AI features use your data">
        <p>
          When you ask the AI assistant a question, we search your workspace for relevant records, then <strong>re-check every candidate
          against your own permissions</strong> before any of it is sent to a model. The assistant cannot show you something you could not
          already open yourself.
        </p>
        <p>Only the content relevant to your specific request is sent — never your whole workspace.</p>
        <p>
          <strong>Your data is not used to train AI models.</strong> We use the providers&rsquo; standard API endpoints, which do not train
          on submitted content.
        </p>
      </Clause>

      <Clause n={5} title="Who else receives data">
        <p>We share data only with the providers we need to run the service:</p>
        <div className="not-prose my-5 overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-sunk">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Provider</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Purpose</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Data involved</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 align-top font-medium text-text">{s.name}</td>
                  <td className="px-4 py-3 align-top text-text-muted">{s.purpose}</td>
                  <td className="px-4 py-3 align-top text-text-muted">{s.data}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          We do not sell your data, and we do not share it with advertisers. If we are legally compelled to disclose something, we will tell
          you unless we are prohibited from doing so.
        </p>
      </Clause>

      <Clause n={6} title="Where data is stored and for how long">
        <p>Data is stored with our database provider in a single region. We can tell you which region on request.</p>
        <ul>
          <li>Active workspace data is kept for as long as your workspace exists.</li>
          <li>
            Deleted records are first marked as deleted and hidden from the product, then permanently purged after <strong>30 days</strong>.
            That window exists so an accidental deletion can be undone.
          </li>
          <li>Billing records are kept as long as tax and accounting rules require, even after a workspace closes.</li>
        </ul>
      </Clause>

      <Clause n={7} title="Your rights, and how to actually use them">
        <p>Rather than asking you to email us and wait, these are features in the product:</p>
        <ul>
          <li>
            <strong>Export.</strong> You can export your own data — your profile and the records you created — as a structured file from your
            account settings.
          </li>
          <li>
            <strong>Deletion.</strong> You can delete your own account. A Company Admin can close the entire workspace, which deletes every
            member&rsquo;s data along with it.
          </li>
          <li>
            <strong>Correction.</strong> Most personal details are editable directly in your profile.
          </li>
        </ul>
        <p>
          Where your organization controls the data, we may need to direct a request to your Company Admin rather than act on it ourselves.
          For anything else, contact {LEGAL.privacyEmail}.
        </p>
      </Clause>

      <Clause n={8} title="Security">
        <ul>
          <li>Data is encrypted in transit, and at rest by our database provider.</li>
          <li>Authentication is handled by a dedicated identity provider; we never store your password.</li>
          <li>Organizations can require sign-in through their own identity provider using enterprise SSO.</li>
          <li>Sensitive actions are recorded in an append-only audit log.</li>
          <li>Secrets are held in the hosting platform&rsquo;s secret store, never in our source code.</li>
        </ul>
        <p>
          If we become aware of a breach affecting your data, we will notify you promptly with what we know and what we are doing about it.
        </p>
      </Clause>

      <Clause n={9} title="Children">
        <p>
          {LEGAL.productName} is a workplace product and is not directed at children. Where an Education customer stores student records,
          that organization is the controller of those records and is responsible for the consents required in its jurisdiction.
        </p>
      </Clause>

      <Clause n={10} title="Changes and contact">
        <p>
          We will update this policy as the product changes, and will note the date at the top. For material changes we will give notice in
          the product or by email.
        </p>
        <p>
          Privacy questions: {LEGAL.privacyEmail}
          <br />
          General contact: {LEGAL.contactEmail}
        </p>
        <p>
          See also our <Link href="/legal/terms">Terms of Service</Link>.
        </p>
      </Clause>
    </LegalShell>
  );
}
