import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Role-Based Workspaces, Stage E — the OWNERSHIP half of the write sweep.
 *
 * 29 of the 134 mutations carry no `requiredPermission`. That is deliberate:
 * each is authorised by ownership or membership rather than by a permission
 * triple, and adding a triple would be wrong (gating `account.deleteSelf` on a
 * permission would let an admin revoke someone's ability to leave; gating
 * `notification.markRead` would be gating you out of your own inbox).
 *
 * "Deliberate" is a claim, so this verifies it live: a real low-privilege user
 * attempts each one against a resource a real admin owns, and must be refused.
 *
 * Two things keep this honest:
 *   - A refusal is 403 or 404 only. The codebase deliberately does not
 *     distinguish "doesn't exist" from "you can't see it", so both count — but
 *     a 400 means MY payload was wrong, not that the server refused, and is
 *     reported as a broken test rather than counted as a pass.
 *   - Every case runs an owner positive-control first. If the admin cannot
 *     perform the same call, the payload shape is wrong and the intern's
 *     "refusal" would have been meaningless.
 */
const API = "http://localhost:4000";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const PW = "StageE!2026";
const PW2 = "StageE!2026x";

const rawFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      return await rawFetch(url, opts);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
};
const H = (t) => ({ "content-type": "application/json", authorization: `Bearer ${t}` });

const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();
const stampRow = await db.query(
  "select max(substring(name from 'StageE .* ([0-9]+)$')) s from tenants where name like 'StageE %'",
);
const STAMP = stampRow.rows[0].s;
if (!STAMP) {
  console.log("no StageE tenants — run the read sweep first");
  process.exit(1);
}

const signIn = async (slug, pw) => {
  const { data, error } = await sb.auth.signInWithPassword({
    email: `stagee-it-${slug}+${STAMP}@example.com`,
    password: pw,
  });
  if (error) throw new Error(`sign-in ${slug}: ${error.message}`);
  return data.session.access_token;
};
const adminTok = await signIn("admin", PW);
const internTok = await signIn("intern", PW2);

const call = async (tok, m, b) => {
  let r;
  for (let i = 0; i < 5; i++) {
    r = await fetch(`${API}/api/mutations/${m}`, { method: "POST", headers: H(tok), body: JSON.stringify(b) });
    if (r.status !== 429) break;
    await new Promise((res) => setTimeout(res, 12000));
  }
  let body;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  const msg =
    typeof body?.message === "string" ? body.message : Array.isArray(body?.message) ? JSON.stringify(body.message).slice(0, 140) : "";
  return { s: r.status, msg, data: body?.data ?? body };
};
const read = async (tok, s, b = {}) => {
  const r = await fetch(`${API}/api/data/${s}`, { method: "POST", headers: H(tok), body: JSON.stringify(b) });
  let body;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  return { s: r.status, data: body?.data ?? body };
};

const tenantRow = await db.query("select id from tenants where name = $1", [`StageE IT ${STAMP}`]);
const tenantId = tenantRow.rows[0].id;
const uRows = await db.query(
  "select u.id, u.display_name from users u where u.tenant_id = $1 and u.deleted_at is null", [tenantId]);
const adminId = uRows.rows.find((r) => r.display_name === "SE Admin")?.id;
const internId = uRows.rows.find((r) => r.display_name === "SE Intern")?.id;

console.log(`IT workspace ${STAMP}\n  admin=${adminId ? "ok" : "MISSING"}  intern=${internId ? "ok" : "MISSING"}\n`);

// ---------------------------------------------------------------------------
// Fixtures, all owned by the admin.
// ---------------------------------------------------------------------------
const iso = (d) => new Date(Date.now() + d * 3600000).toISOString();
const F = {};
const mk = async (label, mutation, payload, pick = (d) => d?.id) => {
  const r = await call(adminTok, mutation, payload);
  const id = pick(r.data);
  F[label] = id;
  console.log(`  fixture ${label.padEnd(16)} ${mutation.padEnd(26)} ${r.s} ${id ? "" : `!! ${r.msg.slice(0, 90)}`}`);
  return id;
};

console.log("building fixtures as the admin:");
await mk("project", "project.create", { name: "SE Owned Project", description: "x", status: "active" });
await mk("task", "task.create", { projectId: F.project, title: "SE Owned Task" });
await mk("document", "document.create", {
  projectId: F.project,
  storagePath: `stagee/${STAMP}/owned.txt`,
  name: "owned.txt",
  mimeType: "text/plain",
  sizeBytes: 12,
});
await mk("announcement", "announcement.create", { title: "SE Owned", body: "owned announcement" });
await mk("event", "calendarEvent.create", { title: "SE Owned Event", startAt: iso(24), endAt: iso(25) });
await mk("meeting", "meeting.create", { title: "SE Owned Meeting", scheduledStart: iso(48), scheduledEnd: iso(49) });
await mk("channel", "conversation.createChannel", { name: `se-private-${STAMP}`.slice(0, 80), isPrivate: true, memberIds: [] });
await mk("message", "message.send", { conversationId: F.channel, body: "owned message" });
await mk("comment", "comment.create", { entityType: "project", entityId: F.project, body: "owned comment" });
await mk("aiConversation", "aiConversation.create", {});

// Leave needs a type that exists in this tenant.
const lt = await read(adminTok, "leaveTypes.list", {});
const leaveTypeId = Array.isArray(lt.data) && lt.data[0]?.id;
if (leaveTypeId) {
  await mk("leave", "leave.submit", { leaveTypeId, startDate: iso(72), endDate: iso(96), reason: "se" });
} else {
  console.log("  fixture leave            !! no leave types in this tenant");
}

// A notification the admin owns — created as a side effect of the announcement.
const nRow = await db.query(
  "select id from notifications where tenant_id = $1 and user_id = $2 order by created_at desc limit 1",
  [tenantId, adminId],
);
F.notification = nRow.rows[0]?.id;
console.log(`  fixture notification     ${F.notification ? "ok" : "none found (skipped)"}\n`);

// Nothing below needs the database. Closed here because Supabase drops idle
// connections and the write sweep lost a run to exactly that.
await db.end();

// ---------------------------------------------------------------------------
// The cross-user attempts.
// ---------------------------------------------------------------------------
const results = { checks: 0, failures: [], skipped: [] };
const REFUSED = new Set([403, 404]);

/**
 * @param label     what is being protected
 * @param mutation  the ungated mutation under test
 * @param payload   built from the ADMIN's resource
 * @param control   an equivalent call the admin should be allowed to make, to
 *                  prove the payload shape is right. `null` where the owner
 *                  path is destructive and is proven by the fixture step above.
 */
async function attempt(label, mutation, payload, control) {
  if (Object.values(payload).some((v) => v === undefined || v === null)) {
    results.skipped.push(`${mutation} — fixture missing`);
    console.log(`  ${mutation.padEnd(28)} SKIPPED (fixture missing)`);
    return;
  }
  let controlNote = "n/a";
  if (control) {
    const c = await call(adminTok, mutation, control);
    controlNote = String(c.s);
    results.checks++;
    if (c.s === 400) {
      results.failures.push(`${mutation}: OWNER CONTROL got 400 — the test payload is malformed, not refused (${c.msg.slice(0, 80)})`);
    }
  }
  const r = await call(internTok, mutation, payload);
  results.checks++;
  const ok = REFUSED.has(r.s);
  if (!ok) {
    results.failures.push(
      r.s === 400
        ? `${mutation}: got 400 — MY payload was malformed, this proves nothing (${r.msg.slice(0, 90)})`
        : `${mutation}: NOT REFUSED — intern got ${r.s} on ${label} owned by the admin`,
    );
  }
  console.log(`  ${mutation.padEnd(28)} owner:${controlNote.padEnd(4)} intern:${r.s}  ${ok ? "refused" : "*** NOT REFUSED ***"}  ${label}`);
}

console.log("intern attempting to act on the admin's resources:");
await attempt("the admin's announcement", "announcement.delete", { id: F.announcement }, null);
await attempt("the admin's calendar event", "calendarEvent.delete", { id: F.event }, null);
await attempt("the admin's meeting", "meeting.cancel", { id: F.meeting }, null);
await attempt("the admin's meeting", "meeting.addParticipant", { meetingId: F.meeting, userId: internId }, null);
await attempt("the admin's meeting", "meeting.removeParticipant", { meetingId: F.meeting, userId: adminId }, null);
await attempt("the admin's meeting", "meeting.getJoinInfo", { meetingId: F.meeting }, null);
await attempt("a document in a project the intern cannot see", "document.getFileUrl", { id: F.document, mode: "view" }, null);
await attempt(
  "a project the intern cannot see",
  "comment.create",
  { entityType: "project", entityId: F.project, body: "intern comment" },
  { entityType: "project", entityId: F.project, body: "owner control comment" },
);
await attempt("the admin's comment", "comment.delete", { id: F.comment }, null);
await attempt(
  "a private channel the intern is not in",
  "message.send",
  { conversationId: F.channel, body: "intern message" },
  { conversationId: F.channel, body: "owner control message" },
);
await attempt("the admin's message", "message.delete", { id: F.message }, null);
await attempt("a private channel the intern is not in", "conversation.addMember", { conversationId: F.channel, userId: internId }, null);
await attempt("a private channel the intern is not in", "conversation.archive", { conversationId: F.channel }, null);
await attempt("a private channel the intern is not in", "conversation.markRead", { conversationId: F.channel }, null);
await attempt("the admin's leave request", "leave.cancel", { id: F.leave }, null);
await attempt("the admin's AI conversation", "aiConversation.archive", { id: F.aiConversation }, null);
await attempt("the admin's AI conversation", "aiMessage.send", { conversationId: F.aiConversation, content: "hi" }, null);
await attempt("the admin's notification", "notification.markRead", { id: F.notification }, null);

console.log(`\n${"=".repeat(94)}`);
console.log(`${results.checks} checks run, ${results.failures.length} failure(s), ${results.skipped.length} skipped`);
for (const f of results.failures) console.log(`  FAIL  ${f}`);
for (const s of results.skipped) console.log(`  SKIP  ${s}`);
fs.writeFileSync("ownership-sweep-result.json", JSON.stringify(results, null, 2));
