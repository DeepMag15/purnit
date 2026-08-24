import fs from "node:fs";
import path from "node:path";

/**
 * Test-only loader for the five blueprint fixtures defined in
 * `prisma/seed.ts`.
 *
 * **Why it parses source text instead of importing the module.** `seed.ts` is
 * an ESM script that calls `main()` at load time and uses `import.meta.url`,
 * so importing it from a CommonJS Jest spec both fails to compile and would
 * run the seeder as a side effect. Extracting the literals keeps the seeder
 * untouched — it stays a script, with no export surface or entry guard added
 * purely to satisfy a test.
 *
 * (An entry guard was tried and reverted: `require.main === module` is
 * `undefined` under ESM, so it would have silently disabled seeding.)
 *
 * The literals are pure data — no identifiers, no calls — so evaluating them
 * is safe here and confined to the test build.
 */

const SEED_PATH = path.resolve(__dirname, "../../prisma/seed.ts");

/** Slice out `const NAME = { … }`, skipping strings and comments so that an
 * apostrophe in prose ("ORG_HIERARCHY.md's") can't open a phantom string and
 * swallow the rest of the file. */
function extractLiteral(src: string, name: string): unknown {
  const start = src.indexOf(`const ${name} = {`);
  if (start === -1) throw new Error(`Blueprint ${name} not found in seed.ts`);
  const open = src.indexOf("{", start);
  let depth = 0,
    i = open,
    str: string | null = null,
    escaped = false,
    lineComment = false,
    blockComment = false;

  for (; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (str) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === str) str = null;
      continue;
    }
    if (ch === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      str = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }

  // Pure data literal, test build only — see this module's doc comment.
  return eval("(" + src.slice(open, i) + ")");
}

export interface BlueprintFixture {
  id: string;
  version: number;
  industry: string;
  roles: { id: string; label?: string; rank?: number; extends?: string; permissions?: string[] }[];
  navigation: unknown[];
  dashboards: { default: string };
  modules: string[];
  pages: Record<string, { requiredPermission?: string }>;
}

let cache: Record<string, BlueprintFixture> | null = null;

export function loadBlueprintFixtures(): Record<string, BlueprintFixture> {
  if (cache) return cache;
  const src = fs.readFileSync(SEED_PATH, "utf8");
  cache = {
    IT: extractLiteral(src, "IT_BLUEPRINT_V1") as BlueprintFixture,
    Healthcare: extractLiteral(src, "HEALTHCARE_BLUEPRINT_V1") as BlueprintFixture,
    Education: extractLiteral(src, "EDUCATION_BLUEPRINT_V1") as BlueprintFixture,
    Finance: extractLiteral(src, "FINANCE_BLUEPRINT_V1") as BlueprintFixture,
    Manufacturing: extractLiteral(src, "MANUFACTURING_BLUEPRINT_V1") as BlueprintFixture,
  };
  return cache;
}

/** Walks a blueprint role's `extends` chain exactly as role materialization
 * does, applying `+`/`-` deltas in order. */
export function resolveRolePermissions(roles: BlueprintFixture["roles"], id: string): string[] {
  const seen = new Set<string>();
  const walk = (roleId: string): string[] => {
    const role = roles.find((r) => r.id === roleId);
    if (!role || seen.has(roleId)) return [];
    seen.add(roleId);
    const out = new Set(role.extends ? walk(role.extends) : []);
    for (const p of role.permissions ?? []) {
      if (p.startsWith("+")) out.add(p.slice(1));
      else if (p.startsWith("-")) out.delete(p.slice(1));
      else out.add(p);
    }
    return [...out];
  };
  return walk(id);
}
