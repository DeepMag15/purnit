import { config as loadEnv } from "dotenv";
import pg from "pg";
loadEnv({ path: "D:/Purnit/.env", quiet: true });
const c = new pg.Client({ connectionString: process.env.DIRECT_URL });
await c.connect();

// Age the closed throwaway workspace past the 30-day window.
const aged = await c.query(`
  update tenants set deleted_at = now() - interval '31 days'
  where name like 'DataProt Delete %' and deleted_at is not null returning id, name`);
console.log("backdated closed workspace:", aged.rows.map(r => r.name).join(", ") || "(none)");

const before = await c.query(`
  select (select count(*) from tenants)::int tenants,
         (select count(*) from users)::int users,
         (select count(*) from roles)::int roles`);
console.log("before purge:", JSON.stringify(before.rows[0]));
await c.end();
