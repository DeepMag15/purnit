import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Stage E teardown — removes the throwaway `StageE *` workspaces the
 * verification sweep created, and their Supabase Auth users.
 *
 * Deletes run over DIRECT_URL (the `postgres` role, BYPASSRLS) so the rows are
 * actually visible. The retention purge learned this the hard way: run the
 * same deletes as `app_runtime` with no `app.tenant_id` set and every RLS
 * policy matches zero rows, so it reports success having destroyed nothing.
 *
 * Table order comes from repeated passes rather than a hand-kept list — a
 * child table that still has rows fails its parent's delete, so the loop
 * simply retries until a full pass deletes nothing new.
 */
const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();

const { rows: tenants } = await db.query(`select id, name from tenants where name like 'StageE %'`);
if (tenants.length === 0) {
  console.log("no StageE tenants found — nothing to tear down");
  await db.end();
  process.exit(0);
}
const ids = tenants.map((t) => t.id);
console.log(`tearing down ${tenants.length} workspace(s):`);
for (const t of tenants) console.log(`  ${t.name}`);

const { rows: authRows } = await db.query(
  `select auth_user_id from users where tenant_id = any($1) and auth_user_id is not null`, [ids]);
console.log(`  ${authRows.length} Supabase Auth user(s) to remove`);

const { rows: tables } = await db.query(
  `select table_name from information_schema.columns
   where table_schema = 'public' and column_name = 'tenant_id' and table_name <> 'tenants'
   order by table_name`);

let total = 0;
for (let pass = 1; pass <= 12; pass++) {
  let deletedThisPass = 0;
  const blocked = [];
  for (const { table_name: t } of tables) {
    try {
      const r = await db.query(`delete from "${t}" where tenant_id = any($1)`, [ids]);
      deletedThisPass += r.rowCount;
    } catch (e) {
      blocked.push(t);
    }
  }
  total += deletedThisPass;
  console.log(`  pass ${pass}: ${deletedThisPass} row(s) deleted, ${blocked.length} table(s) still blocked`);
  if (deletedThisPass === 0 && blocked.length === 0) break;
  if (deletedThisPass === 0 && blocked.length > 0) {
    console.log(`  !! still blocked: ${blocked.join(", ")}`);
    break;
  }
}

const t0 = await db.query(`delete from tenants where id = any($1)`, [ids]);
console.log(`\n${total} tenant-owned row(s) + ${t0.rowCount} tenant row(s) destroyed`);

// Anything left behind pointing at a tenant that no longer exists.
let orphans = 0;
for (const { table_name: t } of tables) {
  const r = await db.query(`select count(*)::int n from "${t}" where tenant_id = any($1)`, [ids]);
  if (r.rows[0].n > 0) { console.log(`  ORPHAN ${t}: ${r.rows[0].n}`); orphans += r.rows[0].n; }
}
console.log(`orphaned rows remaining: ${orphans}`);

const { rows: remaining } = await db.query(`select count(*)::int n from tenants where deleted_at is null`);
console.log(`tenants remaining: ${remaining[0].n}`);
await db.end();

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
let removed = 0, failed = 0;
for (const { auth_user_id: uid } of authRows) {
  const { error } = await admin.auth.admin.deleteUser(uid);
  if (error) { failed++; console.log(`  auth delete failed for one user: ${error.message}`); } else removed++;
}
console.log(`Supabase Auth users removed: ${removed}${failed ? `, failed: ${failed}` : ""}`);
