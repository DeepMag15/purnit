import { config as loadEnv } from "dotenv";
import pg from "pg";
loadEnv({ path: "D:/Purnit/.env", quiet: true });

async function probe(label, url) {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  try {
    await c.connect();
    const r = await c.query(`select current_user u,
      (select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE') tables`);
    console.log(`${label.padEnd(13)} OK   role=${r.rows[0].u}  public tables=${r.rows[0].tables}`);
    await c.end();
    return true;
  } catch (e) {
    console.log(`${label.padEnd(13)} FAIL ${e.code ?? ""} ${String(e.message).slice(0, 70)}`);
    try { await c.end(); } catch {}
    return false;
  }
}

const ok = await probe("DATABASE_URL", process.env.DATABASE_URL);
await probe("DIRECT_URL", process.env.DIRECT_URL);

if (ok) {
  const c = new pg.Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
  await c.connect();
  const t = await c.query(`select industry, count(*)::int tenants from tenants where deleted_at is null group by 1 order by 1`);
  console.log("\n-- your tenants --");
  console.table(t.rows);
  const totals = await c.query(`select
    (select count(*)::int from tenants where deleted_at is null) tenants,
    (select count(*)::int from users where deleted_at is null) users,
    (select count(*)::int from projects) projects,
    (select count(*)::int from tasks) tasks,
    (select count(*)::int from blueprints) blueprints`);
  console.log("totals:", JSON.stringify(totals.rows[0]));
  await c.end();
}
