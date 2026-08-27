import { Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";

export interface InviteEmailInput {
  to: string;
  employeeName: string;
  companyName: string;
  invitedByName: string;
  workspaceId: string;
  temporaryPassword: string;
  loginUrl: string;
}

export interface ReminderEmailInput {
  to: string;
  recipientName: string;
  itemTitle: string;
  itemType: string; // "meeting" | "calendarEvent" | "task" — free-text, matches CalendarReminder.sourceType
  startAt: Date;
}

// Phase E (proactive digests) — self-contained shape, no import from
// digest-content.ts or any feature module, matching ReminderEmailInput's
// own leaf-module precedent (EmailService never imports a feature module).
export interface DigestEmailCategory {
  count: number;
  items: Array<{ label: string; when: string }>;
}

export interface DigestEmailInput {
  to: string;
  recipientName: string;
  overdueTasks: DigestEmailCategory;
  dueSoonTasks: DigestEmailCategory;
  pendingApprovals: DigestEmailCategory;
  todayEvents: DigestEmailCategory;
  weekEvents: DigestEmailCategory;
}

/**
 * Thin wrapper around Resend — deliberately its own module rather than
 * folded into `auth/`, since ARCHITECTURE §12 already designates email as a
 * future cross-cutting need (notifications) beyond just invites. Requires
 * `RESEND_API_KEY` + `EMAIL_FROM` (a verified sender in the Resend
 * dashboard) — infrastructure only the user can set up, not something code
 * can provision.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend = new Resend(process.env.RESEND_API_KEY);

  /** Never throws — invite creation must never fail because email delivery
   * did. Returns whether it actually sent; the caller surfaces `emailSent:
   * false` to the UI, which still shows the temporary password as a
   * fallback. */
  async sendInviteEmail(input: InviteEmailInput): Promise<boolean> {
    try {
      // The real inviter's own "Name (Role)" as the display name — e.g.
      // "Deep Magar (Company Admin)" or "Yash Chalke (HR Manager)" —
      // alongside a fixed, Resend-verified address. The address is
      // infrastructure only the user can provision (a verified domain); the
      // name is the only part that varies per invite. Stripped of
      // quote/angle-bracket characters to avoid a malformed or injected
      // `From` header from a tenant-supplied display name/role label.
      const fromName = input.invitedByName.replace(/["<>]/g, "");
      const { error } = await this.resend.emails.send({
        from: `"${fromName}" <${process.env.EMAIL_FROM}>`,
        to: input.to,
        subject: `You're invited to ${input.companyName} on Purnit`,
        html: renderInviteEmail(input),
      });
      if (error) throw new Error(error.message);
      return true;
    } catch (err) {
      this.logger.warn(`Invite email to ${input.to} failed: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  /** Never throws — same "delivery failure must never fail the operation"
   * shape as sendInviteEmail. Called by CalendarReminderProcessorService
   * after its own in-app Notification write already succeeded, so a `false`
   * return here is logged, not treated as a job failure. */
  async sendReminderEmail(input: ReminderEmailInput): Promise<boolean> {
    try {
      const { error } = await this.resend.emails.send({
        from: `Purnit <${process.env.EMAIL_FROM}>`,
        to: input.to,
        subject: `Reminder: ${input.itemTitle}`,
        html: renderReminderEmail(input),
      });
      if (error) throw new Error(error.message);
      return true;
    } catch (err) {
      this.logger.warn(`Reminder email to ${input.to} failed: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  /** Never throws — same "delivery failure must never fail the operation"
   * shape as every other email method. Called by DigestProcessorService
   * after its own in-app Notification write (+ the `lastDigestSentAt`
   * claim) already committed, so a `false` return here is logged, not
   * treated as a processing failure — the day is still correctly "used
   * up" even if the email itself never lands. */
  async sendDigestEmail(input: DigestEmailInput): Promise<boolean> {
    try {
      const { error } = await this.resend.emails.send({
        from: `Purnit <${process.env.EMAIL_FROM}>`,
        to: input.to,
        subject: "Your daily digest",
        html: renderDigestEmail(input),
      });
      if (error) throw new Error(error.message);
      return true;
    } catch (err) {
      this.logger.warn(`Digest email to ${input.to} failed: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }
}

const REMINDER_ITEM_LABELS: Record<string, string> = {
  meeting: "Meeting",
  calendarEvent: "Calendar event",
  task: "Task due",
};

function renderReminderEmail(input: ReminderEmailInput): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const label = REMINDER_ITEM_LABELS[input.itemType] ?? "Reminder";
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px;">${esc(label)}: ${esc(input.itemTitle)}</h2>
      <p style="color: #555;">Hi ${esc(input.recipientName)}, this is a reminder that "${esc(input.itemTitle)}" is coming up at <strong>${esc(input.startAt.toLocaleString())}</strong>.</p>
    </div>
  `.trim();
}

const DIGEST_CATEGORY_LABELS: Record<keyof Omit<DigestEmailInput, "to" | "recipientName">, string> = {
  overdueTasks: "Overdue tasks",
  dueSoonTasks: "Due soon",
  pendingApprovals: "Leave requests awaiting your approval",
  todayEvents: "Today",
  weekEvents: "Later this week",
};

function renderDigestEmail(input: DigestEmailInput): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const categoryKeys = Object.keys(DIGEST_CATEGORY_LABELS) as Array<keyof typeof DIGEST_CATEGORY_LABELS>;
  const sections = categoryKeys
    .filter((key) => input[key].count > 0)
    .map(
      (key) => `
      <h3 style="margin: 16px 0 4px; font-size: 15px;">${esc(DIGEST_CATEGORY_LABELS[key])} (${input[key].count})</h3>
      <ul style="margin: 0; padding-left: 20px; color: #555;">
        ${input[key].items.map((item) => `<li>${esc(item.label)} — ${esc(item.when)}</li>`).join("")}
      </ul>
    `,
    )
    .join("");

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px;">Your daily digest</h2>
      <p style="color: #555;">Hi ${esc(input.recipientName)}, here's what's relevant for you today.</p>
      ${sections}
    </div>
  `.trim();
}

function renderInviteEmail(input: InviteEmailInput): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px;">Welcome to ${esc(input.companyName)}</h2>
      <p style="color: #555;">Hi ${esc(input.employeeName)}, <strong>${esc(input.invitedByName)}</strong> has invited you to join ${esc(input.companyName)}'s workspace on Purnit.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr><td style="padding: 6px 0; color: #555;">Workspace ID</td><td style="padding: 6px 0; font-family: monospace;"><strong>${esc(input.workspaceId)}</strong></td></tr>
        <tr><td style="padding: 6px 0; color: #555;">Email</td><td style="padding: 6px 0;">${esc(input.to)}</td></tr>
        <tr><td style="padding: 6px 0; color: #555;">Temporary password</td><td style="padding: 6px 0; font-family: monospace;"><strong>${esc(input.temporaryPassword)}</strong></td></tr>
      </table>
      <p>
        <a href="${esc(input.loginUrl)}" style="display: inline-block; background: #4f46e5; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none;">
          Log in
        </a>
      </p>
      <p style="color: #b45309; font-size: 13px; margin-top: 20px;">
        This temporary password is valid only until your first login, at which point you'll be required to set a new one immediately.
      </p>
    </div>
  `.trim();
}
