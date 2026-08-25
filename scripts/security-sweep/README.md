# Role-based authorization sweep

The live counterpart to the authorization invariants enforced in CI
(`ARCHITECTURE.md` §15.1). The Jest suites prove the *rules* hold in the code;
these prove the *system* holds when a real person signs in over real HTTP.

They exist because the two vulnerabilities this suite was written to look for
were both invisible to code review — including my own reading of the very
controller that had one. See the Stage E entry in `CHANGELOG.md`.

## What each one proves

| Script | Proves |
|---|---|
| `read-sweep.mjs` | For all 25 roles × 5 domains: the navigation the API delivers matches what pruning should independently produce; **every page absent from a role's nav returns 404 by direct URL**; every page present returns 200; guarded data sources refuse without their grant. |
| `write-sweep.mjs` | For all 25 roles: each of the ~105 permission-gated mutations is refused **iff** the role lacks the permission. ~2,500 authorization decisions. |
| `ownership-sweep.mjs` | The 29 mutations with no `requiredPermission` really are protected by ownership/scope: a real low-privilege user attempts each against a real admin's resource and must be refused. |
| `teardown.mjs` | Destroys the throwaway `StageE *` workspaces and their Supabase Auth users. Run it when you are done. |

## Running them

Needs a running API on `localhost:4000` and the repo `.env` (real Supabase —
these create real tenants and real Auth users, then delete them).

```bash
pnpm --filter @purnit/api exec tsx scripts/security-sweep/build-mutation-map.mts   # writes mutation-map.json
node scripts/security-sweep/read-sweep.mjs        # creates the throwaway workspaces
node scripts/security-sweep/write-sweep.mjs       # reuses them
node scripts/security-sweep/ownership-sweep.mjs   # reuses them
node scripts/security-sweep/teardown.mjs          # removes them
```

Run them in that order: `read-sweep` creates the workspaces the other two reuse.
A full pass is roughly 45 minutes, most of it the write sweep.

## Three things that make the results trustworthy

These are easy to get wrong in a way that produces a green run proving nothing.

1. **A payload that 400s tested nothing.** `MutationsController` parses
   `inputSchema` *before* `checkRequiredPermission`, so a malformed payload is
   rejected before the gate is ever reached. Payloads are synthesised from each
   schema's JSON Schema form, and the handful of cross-field `.refine()` rules
   JSON Schema cannot express are listed explicitly in `payloads.mjs`. The write
   sweep counts a 400 as `untested`, never as a pass and never as a leak.
2. **A refusal must be the *right* refusal.** `checkRequiredPermission` throws
   `Missing permission "x:y"`, and only that exact message counts as a gate
   refusal — an inner scope check that legitimately 403s is not the thing under
   test and must not be allowed to look like one.
3. **The ownership sweep runs an owner positive-control first.** If the admin
   cannot make the same call, the payload is wrong and the low-privilege user's
   "refusal" is meaningless. That case is reported as a broken test.

`mutation-map.json` is built by importing the real modules rather than parsing
source. An earlier `awk` version mis-attributed `inventoryItem.adjustStock` to
`invoice:update` and missed every factory-created mutation (`user.invite`,
`account.deleteSelf`, all billing, all AI) — a verification of authorization
cannot rest on a heuristic reading of the thing it verifies.

## Side effects deliberately not exercised

13 mutations do real external work on their authorised path — Resend email,
Stripe calls, Supabase Auth deletion, AI provider calls, or changing an
identifier the sweep depends on. Only their **refusal** direction is exercised
(nothing fires, since the refusal precedes `preResolve`). They are listed in
`payloads.mjs` as `NO_EXECUTE`, counted, and reported — never silently skipped.
