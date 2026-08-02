import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

// First-ever lint pass on this codebase — deliberately the conservative
// `recommended` presets (not `strict`/`stylistic`), to keep the initial
// violation surface manageable on a mature, ~30-module codebase. Tightening
// later is easy; walking back a wall of day-one violations is not.
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/.turbo/**",
      "apps/api/src/generated/**",
      "infra/jitsi/docker-jitsi-meet/**",
      "pnpm-lock.yaml",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { process: "readonly", console: "readonly", Buffer: "readonly", __dirname: "readonly" },
    },
    rules: {
      // Prefixing an intentionally-unused parameter/variable with `_` is the
      // established convention throughout this codebase (e.g. resolver
      // signatures that don't use every argument) — off entirely would miss
      // real dead code, the default would flag a normal, deliberate pattern.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // --- apps/web: React/Next-specific rules ---
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { react: reactPlugin, "react-hooks": reactHooksPlugin, "@next/next": nextPlugin },
    languageOptions: {
      globals: { window: "readonly", document: "readonly", navigator: "readonly", localStorage: "readonly", fetch: "readonly" },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      // New JSX transform — no `React` import needed/used anywhere in this codebase.
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      // App Router only, no pages/ directory anywhere in this project — this
      // rule's own directory probe otherwise warns on every single file.
      "@next/next/no-html-link-for-pages": "off",
      // These three rules are eslint-plugin-react-hooks' newer, much
      // stricter "React Compiler" checks (distinct from the classic
      // rules-of-hooks-only linting). Running them for the first time on
      // this codebase surfaced ~12 hits across many already-shipped, already
      // browser-tested modules (deriving default UI state from fetched data
      // via setState-in-effect; a couple of Date.now() reads during render;
      // one deliberate latest-value ref-during-render pattern) — each is a
      // real behavioral refactor with its own regression risk, not a
      // mechanical fix, and out of scope for this stabilization pass. Off
      // for now, not silently — revisit as a dedicated future pass.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
    },
    settings: { react: { version: "detect" } },
  },
  // --- CommonJS config files (not part of either app's own module system).
  {
    files: ["**/jest.config.js"],
    languageOptions: {
      globals: { module: "writable", require: "readonly", __dirname: "readonly" },
    },
  },
  // --- apps/api: Node/NestJS — decorators rely on classes referenced only
  // via metadata (constructor-injected types, @Injectable()), which this
  // rule can't see.
  {
    files: ["apps/api/**/*.ts"],
    rules: {
      "@typescript-eslint/no-extraneous-class": "off",
    },
  },
  // --- Test files: relax a couple of rules that fight normal test patterns.
  {
    files: ["**/*.spec.ts", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
