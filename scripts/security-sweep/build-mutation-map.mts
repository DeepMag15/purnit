import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { pathToFileURL } from "node:url";

/**
 * Stage E, write sweep — the authoritative mutation → permission map, built by
 * importing the real modules rather than regex-matching source.
 *
 * A first attempt parsed `*.mutations.ts` with awk and mis-attributed
 * `inventoryItem.adjustStock` to `invoice:update` (it is `inventoryItem:update`),
 * over-counting the registry by 20 on bogus `name:` matches inside resolvers.
 * A verification of authorization cannot rest on a heuristic reading of the
 * thing it verifies. This also yields each `inputSchema` as JSON Schema, which
 * is what lets the sweep synthesise payloads that actually reach the
 * permission check.
 */
const root = path.resolve("../../apps/api/src");
const files: string[] = [];
(function walk(d: string) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".mutations.ts")) files.push(p);
  }
})(root);

// A permissive stub: every property access, call and construction returns
// itself, so a factory can destructure or chain on its deps without throwing.
const stub: unknown = new Proxy(function () {} as object, {
  get: () => stub,
  apply: () => stub,
  construct: () => stub as object,
});

const out: Record<string, unknown> = {};
let importFailures = 0;
let factoryFailures = 0;

for (const f of files) {
  let mod: Record<string, unknown>;
  try {
    mod = await import(pathToFileURL(f).href);
  } catch (e) {
    console.error(`  !! import failed ${path.relative(root, f)}: ${(e as Error).message.slice(0, 100)}`);
    importFailures++;
    continue;
  }

  const candidates: unknown[] = [];
  for (const v of Object.values(mod)) {
    // Definitions needing injected services (Supabase, Stripe, Resend, Storage,
    // the AI provider) are exported as `createXMutation(deps)` factories. The
    // factory only closes over its deps — nothing is dereferenced until
    // `resolve()` runs — so calling it with the stub yields the real
    // definition. Without this, `user.invite`, `account.deleteSelf`,
    // `document.getFileUrl`, `meeting.getJoinInfo` and the whole billing and
    // AI sets are silently absent from the map, which is how the first version
    // of this script reported 114 mutations instead of the real total.
    if (typeof v === "function" && /^create.*Mutations?$/.test(v.name)) {
      try {
        const r = (v as (...a: unknown[]) => unknown)(stub, stub, stub, stub, stub, stub);
        if (Array.isArray(r)) candidates.push(...r);
        else candidates.push(r);
      } catch (e) {
        console.error(`  !! factory ${v.name} threw: ${(e as Error).message.slice(0, 90)}`);
        factoryFailures++;
      }
      continue;
    }
    candidates.push(v);
  }

  for (const v of candidates) {
    const d = v as { name?: unknown; inputSchema?: unknown; requiredPermission?: unknown; resolve?: unknown };
    if (!d || typeof d !== "object") continue;
    if (typeof d.name !== "string" || !d.inputSchema || typeof d.resolve !== "function") continue;
    let json: unknown;
    try {
      json = z.toJSONSchema(d.inputSchema as z.ZodType, { io: "input", unrepresentable: "any" });
    } catch (e) {
      json = { __error: (e as Error).message.slice(0, 120) };
    }
    out[d.name] = {
      requiredPermission: typeof d.requiredPermission === "string" ? d.requiredPermission : null,
      file: path.relative(root, f).split(path.sep).join("/"),
      schema: json,
    };
  }
}

fs.writeFileSync("../../scripts/security-sweep/mutation-map.json", JSON.stringify(out, null, 2));
const names = Object.keys(out);
const gated = names.filter((n) => (out[n] as { requiredPermission: string | null }).requiredPermission);
console.log(`${names.length} mutations from ${files.length} files`);
console.log(`  gated: ${gated.length}   ungated: ${names.length - gated.length}`);
console.log(`  import failures: ${importFailures}   factory failures: ${factoryFailures}`);
console.log(`  schema conversion failures: ${names.filter((n) => JSON.stringify((out[n] as { schema: unknown }).schema).includes("__error")).length}`);
