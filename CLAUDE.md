# Purnit — working rules

Read `CONTEXT.md` first. It is the always-current snapshot of what this project is and where the work stands. `ARCHITECTURE.md` holds the full technical design; `CHANGELOG.md` holds the chronological record.

---

## Documentation discipline (permanent, applies to every change)

**After every major change, update all three documents immediately — in the same working session as the change, not at the end of the module.**

| File | What goes in it |
|---|---|
| `ARCHITECTURE.md` | Architecture, security rules, workflows, module relationships, and important design decisions — including the ones deliberately *not* taken, and why. |
| `CHANGELOG.md` | What was changed, fixed, added or removed, with the reasoning and the verification result. |
| `CONTEXT.md` | Current project state: what is complete, what was decided, what is deferred, and what the next module needs to know. |

The full statement of this rule lives in **ARCHITECTURE.md §1.1**; this file is the reminder that loads every session.

### Why it is a rule

These files are the only durable memory this project has, and every session begins by reading them. Documentation written from memory at the end of a module is written from the *plan* rather than from what shipped, and the gap between the two is where the expensive mistakes live.

Both module reviews so far found doc claims that had quietly become false — each true when written, each still being trusted:

- `student.register`: *"deliberately NO backing Project"* — untrue once Contextual Reporting added one.
- `myAssignments.list`: *"this platform has no student submission model"* — untrue once the Documents review added one.
- ARCHITECTURE.md §15.1 rule 4: *"29 mutations and ~40 data sources"* — actually 33 and 55.

### Three obligations, because each has already been missed once

1. **Update every place a fact lives, not just the nearest one.** A change to Tasks' scope rule belongs in the Tasks module row, not only in the row of the module whose review happened to find it. Grep for what you changed before assuming one edit covered it.
2. **Correct claims your change has falsified.** A doc line that is now wrong is worse than one that is missing, because it is trusted. Fix it in the commit that made it wrong.
3. **Counts are claims too.** Any number in these files is a factual assertion that goes stale silently. Re-derive it; never carry it forward.

**Before moving to the next module**, verify all three files against the actual implementation and report anything intentionally deferred, so a deferral is a recorded decision rather than an omission.

---

## The module-by-module review

Work proceeds one module at a time, and the order is fixed:

**Findings first → approval → implement → verify (backend *and* browser) → update docs → commit.**

- Give the findings report **before** implementing, and wait for approval.
- **Never assume a module works the same way across all five domains** (IT, Healthcare, Education, Finance, Manufacturing). Check each.
- A module is not done until the workflow it belongs to actually works in every domain that has it.
- AI and Analytics are **optional** everywhere — they help when useful, they are never required for a workflow to complete.

The approved target workflow:

> Project → Work/Task → Assignment → user works → progress updates → optional files/evidence/report → **Submit → Review/Approval** → project progress

with the role chain Employee → Lead/Manager → Project Manager → Executive.

---

## Verification

- Findings are produced **against a running system**, not from reading code. The probes live in `scripts/security-sweep/`.
- **The browser catches what the API suite cannot.** Both real bugs in the Projects review and the real UI bug in the Documents review were invisible to a fully green backend suite.
- **Verify that the thing under test is the thing running.** Both servers run compiled builds (`node dist/main`, `next start`) — rebuild and restart before believing a result. A "fix that failed" has twice turned out to be a stale build.
- **A probe failure is usually the probe.** Check the screenshot and the actual grants before reporting a product bug.
- Changing a test to match the implementation is sometimes right and always dangerous — justify it against the written standard (ARCHITECTURE.md §15.1), never against the code you just wrote.

### Local environment notes

- Windows. `pnpm`/`node` come from Volta (`C:\Program Files\Volta`); they are not on the default PATH in a fresh shell.
- Long-running servers must be started in **their own console** (`cmd /c start …`) or they die with the shell.
- Supabase Auth intermittently 500s on signup/invite from this machine (10s connect timeout). `scripts/security-sweep/signup-retry.mjs` retries 5xx and network errors only — never a 4xx, which is a real refusal.

---

## Authorization

`ARCHITECTURE.md §15.1` is the permanent security model — seven rules, and every module inherits them by construction. Two that are easiest to get wrong:

- **Nothing external or irreversible happens before authorization.** Ordering, not presence: a check that runs after the Stripe call is not a check.
- **A boundary enforced in one code path is not a boundary.** Ask which paths reach the resource. A rule expressed as a query filter only protects the queries that use it — a write that builds its own where-clause silently opts out. Prefer sharing the gate object over restating its conditions; two definitions of one rule will drift.

Never fix an authorization finding by adding a permission triple to a role. If a role is refused something it should be able to do, the boundary is drawn in the wrong place.
