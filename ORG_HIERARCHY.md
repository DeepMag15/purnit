# Antigravity — Organizational Hierarchy & Authority Model

> **Purpose of this file:** the canonical design for how a real IT company's org structure — authority, reporting, permissions, approvals, and assignment — maps onto the platform, and the standard every future module (Projects, Tasks, HR, CRM, Calendar, Meetings, Chat, Documents, Analytics, Notifications, AI Assistant) must comply with.
>
> **Status:** **Approved. Phase 1 (the RBAC/schema core) is implemented and live-verified** — see §16 for the as-built implementation record, including three real bugs found and fixed live during that work. Phases beyond Phase 1 (full department taxonomies actually populated by real Admins, a second real bonus-permission consumer beyond HR, Leave/Performance-Review/CRM/etc.) remain future work.
>
> **Compliance rule, stated up front because it governs everything below:** every future module — Projects, Tasks, HR, CRM, Calendar, Meetings, Chat, Documents, Analytics, Notifications, AI Assistant — **must** authorize through this same tier ladder, the same 5-value scope enum (§7), and the same manager-chain approval routing (§9). No module introduces its own permission model, its own notion of scope, or its own approval-routing logic. If a module seems to need something this document doesn't cover, that's a signal to extend this document first, not to build a parallel mechanism.

---

## 1. The core idea: two independent dimensions, not one

A real IT company isn't one ladder (Intern → ... → Admin) and isn't N totally separate ladders per department either. It's **one common reporting/authority spine, crossed with department-specific job titles and responsibilities**:

- **Authority Tier** (vertical axis) — a small, fixed set of *scope widths*, *approval authority*, and *management scope* that mean the same thing everywhere in the company. This is what RBAC actually keys off, and it's identical whether you're in Engineering, HR, or Sales.
- **Department Type** (horizontal axis) — what a department *does*. It determines job titles, day-to-day responsibilities, and a small set of department-specific bonus permissions layered on top of the tier's common floor. It does **not** change scope width, reporting shape, or how approvals route.

This crossing is why the design scales to every future module without combinatorial explosion: a module only ever needs to reason about **7 tiers × a generic scope enum**, never about "Engineering Manager" as a special case distinct from "Sales Manager." It's also why the same model scales from a 10-person startup to a 500-person enterprise (§6) — tiers and departments are populated only as far as a company actually needs.

```
                    Company Admin  (tenant-wide, flat — unchanged from today)
                          │
              ┌───────────┼───────────┬─────────────┐
         Executive    Executive    Executive     (no Executive —
         (CTO)        (CHRO)       (COO)          Finance's Dept Head
              │            │            │          reports straight to
      ┌───────┼───────┐    │       ┌────┴────┐      Company Admin — see §3)
 Dept Head Dept Head Dept  Dept Head Dept Head Dept Head
 (Engineer- (QA)     Head  (HR)    (Recruit-  (Operations) (Support)
  ing)               (DevOps)              ment)
        │
     Manager            ← team scope, within one department
        │
      Lead              ← team scope, elevated (optional rung)
        │
  Senior Practitioner   ← team scope, elevated (optional rung)
        │
     Practitioner       ← own scope, base individual contributor
        │
     Intern             ← own scope, most restricted
```

A department **is not required to use every rung.** HR might go Department Head → Manager → Practitioner (Lead and Senior Practitioner tiers simply unused). Engineering might use all seven. The ladder is a menu of available authority levels, not a mandatory structure every department must fully populate.

---

## 2. The Authority Tier ladder (canonical — same everywhere)

| Tier | Scope width | Reports to | Management scope (who they can manage) | Approval authority | Key decision rights |
|---|---|---|---|---|---|
| **Company Admin** | Tenant-wide | — (top) | Anyone in the tenant | Final escalation for anything, tenant-wide | All CRUD on all resources, any role assignment, delegation, billing/settings, org structure itself |
| **Executive** *(new)* | **Department-subtree** — their assigned department **and all of its child departments** | Company Admin | Anyone within their subtree | Escalation for their subtree, before it reaches Company Admin | Create/manage departments within their subtree; approve cross-department initiatives and budgets spanning their subtree |
| **Department Head** | Single department (exact match) | Their Executive, if one exists; otherwise Company Admin directly | Anyone within their one department | Escalation for their department, before it reaches their Executive/Admin | Manage their department's teams/roster; create/delete projects in their department; own department-level policy |
| **Manager** | Team (one or more teams within the department) | Department Head (or the Executive/Admin above them, if no Head) | Members of their team(s) | **Default first approver** for their direct reports (§9) — leave, performance review, expense, any future approval workflow | Create/assign projects and tasks within their team; day-to-day people management — this is the tier that normally holds the direct-manager relationship (§8) |
| **Lead** *(optional rung)* | Team | Manager | — (elevated IC, not a people-manager tier) | None (not a people-manager tier — see note below) | Reassign/prioritize tasks within the team; technical/functional direction; no hiring or role-assignment authority |
| **Senior Practitioner** *(optional rung)* | Team | Lead, or Manager if no Lead exists | — | None | Update/reassign tasks within the team; mentor; no create-level authority on Projects |
| **Practitioner** | Own | Senior Practitioner / Lead / Manager (whichever exists) | — | None | Execute assigned work; create/update within their own scope only |
| **Intern** | Own (narrowest) | Same as Practitioner | — | None | Read/update only their own assigned tasks |

**On "approval authority" vs. management scope:** these are deliberately two different columns. *Management scope* is a permission-system concept (which rows this tier's RBAC grants reach). *Approval authority* is about §9's manager-chain routing — a Lead has broader task-management rights than a Practitioner, but **no approval authority**, because a Lead is not necessarily anyone's `managerId`. Approval authority tracks the manager-chain, not the tier ladder directly — see §8–§9 for why this distinction matters and is load-bearing, not a nuance to gloss over.

**Reporting-line rule:** authority always flows to the nearest tier *above* that actually exists in that department. If a department has no Executive, its Department Head reports straight to Company Admin. If a team has no Lead, its Senior Practitioners report straight to the Manager. Nothing breaks by omitting a rung — this mirrors real small-department reality directly.

This table **is** the RBAC design: tiers map onto the existing `extends`-chain mechanism (`Company Admin` unchanged; `Executive` and the rest slot into the chain in this order), with one structural change (§7) and one new scope value (§8).

---

## 3. Executive Groupings — cross-department oversight, concretely

The Executive tier's entire purpose is overseeing more than one department at once. A tenant's actual grouping is configurable (§13), but a real IT company typically looks like this:

| Executive title | Departments in subtree | Rationale |
|---|---|---|
| **CTO** | Engineering, QA, DevOps | All three own different parts of "build and run the product" — a CTO needs visibility and escalation authority across all of them, not just Engineering. |
| **CHRO / VP People** | HR, Recruitment | People operations and hiring are two sides of the same function; headcount planning needs both under one escalation point. |
| **COO** | Operations, Support | Both are "keep the company/product running for others" functions — facilities/procurement and customer-facing support share an operational escalation lens. |
| **VP Sales / CRO** | Sales, Marketing | Revenue generation and demand generation are tightly coupled; pipeline and campaign strategy need one owner above both. |
| *(no Executive)* | Finance | Not every department needs an Executive above it. Finance's Department Head can report straight to Company Admin — a valid, common shape at any company size, not a gap. See §6 for when adding an Executive over a single department (rather than skipping the tier) is still worth it purely for escalation-authority signaling. |

None of this is hardcoded — a tenant can group departments under Executives however its real org actually works (e.g., a company might instead put DevOps under COO alongside Support, if that's how its incident-response ownership is actually split). This table is the reference default a fresh IT-industry blueprint ships with, not a constraint on what a tenant can configure.

---

## 4. Department Taxonomy & Responsibilities

For each department: which tiers it actually uses, the department's own job titles, and concrete real-world responsibilities per tier. Tiers not listed for a department are simply unused there (§1) — this is not an oversight, it's the intended "menu, not requirement" behavior.

### 4.1 Engineering *(under CTO)*

| Tier | Title | Core responsibilities |
|---|---|---|
| Department Head | **Engineering Head** | Owns technical roadmap and architecture direction for the whole department; manages Engineering Managers; final in-department approval escalation; approves department-wide tooling/vendor decisions. |
| Manager | **Engineering Manager** | Owns one or more teams (e.g., "Payments," "Platform"); sprint/delivery ownership; is the direct manager (§8) for their reports — approves their leave, runs their performance reviews; hiring input for their team. |
| Lead | **Tech Lead** *(specialty title at the Lead rung — see §5's note on lateral titles)* | Technical direction for a team; code-review standards; breaks down and reassigns tasks; no people-management or approval authority. |
| Senior Practitioner | **Senior Software Engineer** | Owns complex tasks end-to-end; mentors; reassigns/updates tasks within the team. |
| Practitioner | **Software Engineer** | Executes assigned tasks; updates status on own work. |
| Intern | **Intern** | Executes assigned tasks under a Senior/Lead mentor; own-scope only. |

### 4.2 QA *(under CTO)*

| Tier | Title | Core responsibilities |
|---|---|---|
| Department Head | **QA Head** | Owns quality strategy and release-gating policy across the department; manages QA Managers. |
| Manager | **QA Manager** | Manages QA teams per product area; resourcing across test cycles; direct manager for their reports. |
| Lead | **QA Lead** | Test-plan ownership and defect-triage direction for a team. |
| Senior Practitioner | **Senior QA Engineer** | Owns complex/automation test suites; mentors. |
| Practitioner | **QA Engineer** | Executes test cases, logs and verifies defects. |
| Intern | **Intern** | Executes assigned test cases under supervision. |

### 4.3 DevOps *(under CTO)*

| Tier | Title | Core responsibilities |
|---|---|---|
| Department Head | **DevOps Head** | Owns infrastructure/reliability strategy and incident-response policy; approves production-access grants department-wide. |
| Manager | **DevOps Manager** | Manages the infra/platform team; owns on-call rotation; direct manager for their reports. |
| Senior Practitioner | **Senior DevOps Engineer** | Builds/maintains CI/CD and infra-as-code; leads incident response. *(No Lead rung — DevOps teams are typically small and flat enough that Manager → Senior is sufficient.)* |
| Practitioner | **DevOps Engineer** | Maintains pipelines/infra; responds to on-call incidents. |
| Intern | **Intern** | Assists under supervision; own-scope only. |

### 4.4 HR *(under CHRO)*

| Tier | Title | Core responsibilities |
|---|---|---|
| Department Head | **HR Head** | Owns HR policy tenant-wide; final escalation for HR grievances; manages HR Managers. |
| Manager | **HR Manager** | Day-to-day people-ops for their assigned employee population; **approves leave and coordinates performance-review cycles as the direct manager for many non-Engineering/non-Sales employees** (see §9's note on HR as a cross-cutting approver); handles org placement (`user.assignDepartment`). |
| Practitioner | **HR Executive** | Onboarding/offboarding paperwork, employee-record maintenance, first-line query handling. *(No Lead/Senior rung — HR departments are typically flatter than Engineering; this is intentional, not a gap.)* |
| Intern | **Intern** | Assists with HR administrative tasks under supervision. |

### 4.5 Recruitment *(under CHRO)*

| Tier | Title | Core responsibilities |
|---|---|---|
| Department Head | **Recruitment Head** | Owns hiring strategy; headcount-planning liaison with Department Heads/Executives tenant-wide. |
| Manager | **Recruitment Manager** | Manages the recruiter pool; owns requisition-approval workflow; direct manager for their reports. |
| Practitioner | **Recruiter** | Sources/screens candidates, coordinates interviews. |

### 4.6 Operations *(under COO)*

| Tier | Title | Core responsibilities |
|---|---|---|
| Department Head | **Operations Head** | Owns cross-functional process and vendor management; budget-oversight liaison. |
| Manager | **Operations Manager** | Manages facilities/procurement/admin-ops team; direct manager for their reports. |
| Practitioner | **Operations Executive** | Executes day-to-day administrative/operational tasks. |

### 4.7 Support *(under COO)*

| Tier | Title | Core responsibilities |
|---|---|---|
| Department Head | **Support Head** | Owns SLA and escalation policy; authority over customer-facing incident communication. |
| Manager | **Support Manager** | Manages support shifts/queues; escalation triage; direct manager for their reports. |
| Senior Practitioner | **Senior Support Engineer** | Handles complex tickets; owns the handoff to Engineering when an issue is actually a bug (a real cross-department touchpoint — see note below). |
| Practitioner | **Support Engineer** | Handles day-to-day tickets within SLA. |
| Intern | **Intern** | Handles simple tickets under supervision. |

> **Cross-department note (flagged, not designed here):** Support escalating a ticket into an Engineering bug is a real, common cross-department handoff that neither the manager chain nor department scope alone models cleanly today (it's not an approval, and it's not a same-department reassignment). This is exactly the kind of thing a future Support/Ticketing module's own design session needs to solve deliberately — noted here so it isn't rediscovered as a surprise later, not designed now (per §12's scoping).

### 4.8 Sales *(under VP Sales/CRO)*

| Tier | Title | Core responsibilities |
|---|---|---|
| Department Head | **Sales Head** | Owns revenue targets and territory strategy tenant-wide; approves large/strategic deals. |
| Manager | **Sales Manager** | Manages a sales team/territory; pipeline review; approves discounts within policy; direct manager for their reports. |
| Senior Practitioner | **Senior Sales Executive** | Manages key accounts; closes larger deals; mentors. |
| Practitioner | **Sales Executive** | Manages accounts; closes deals within their pipeline. |
| Intern | **Intern** | Supports account research/outreach under supervision. |

### 4.9 Marketing *(under VP Sales/CRO)*

| Tier | Title | Core responsibilities |
|---|---|---|
| Department Head | **Marketing Head** | Owns brand and campaign strategy tenant-wide. |
| Manager | **Marketing Manager** | Executes campaigns within an approved budget; direct manager for their reports. |
| Practitioner | **Marketing Executive** | Produces campaign/content execution work. |

### 4.10 Finance *(no Executive — Department Head reports straight to Company Admin)*

| Tier | Title | Core responsibilities |
|---|---|---|
| Department Head | **Finance Head** | Owns financial policy, budget approval authority tenant-wide, reporting to Company Admin directly (§3). |
| Manager | **Finance Manager** | Manages the accounting/finance team; direct manager for their reports. |
| Practitioner | **Finance Executive** | Handles day-to-day bookkeeping/invoicing/reporting tasks. |

This taxonomy is the **reference fixture** a fresh IT-industry blueprint ships with — a tenant can rename, add, remove, or re-tier any department (§13), the same way blueprint content has always been a starting point, not a constraint, elsewhere in this system.

---

## 5. Where lateral/specialty titles fit (e.g., "Project Manager")

A real org sometimes has a *lateral* title (delivery/schedule ownership) alongside the people-manager rung — e.g., "Project Manager" as a Lead-tier specialty specific to Engineering (or, in a services-heavy company, its own thing sitting alongside Tech Lead). Department types are free to insert this kind of specialty title at whichever rung fits (usually Lead) — it's a labeling/specialty choice within a department, not a new universal tier, and it doesn't get its own row in §2's table. If a department needs two genuinely distinct Lead-tier specialties (e.g., both a Tech Lead and a Project Manager on the same team, with different focuses but the same scope width and no people-management authority), that's two title labels at the same tier, not two tiers.

---

## 6. Scaling: startups vs. enterprises

The same 7-tier ladder and department-taxonomy mechanism serves both ends without changing shape — only how many rungs and departments are actually populated changes.

**A 12-person startup** might look like:
- Company Admin (the founder)
- Engineering Head (also personally doing Manager/Lead/Senior-level work — one person occupying the top of the ladder, with Practitioners/Interns reporting straight to them; Manager/Lead/Senior Practitioner rungs simply unused)
- One Sales Executive, one HR Executive, both reporting directly to Company Admin (no Department Head, no Executive tier needed at all yet — those departments might not even formally exist as `Department` rows until there's a second person in them)

**A 500-person enterprise** might look like:
- Company Admin
- CTO (Executive) over Engineering + QA + DevOps, each with a real Engineering Head/QA Head/DevOps Head, each with multiple Managers, each with Leads/Senior Practitioners/Practitioners/Interns fully populated
- CHRO (Executive) over HR + Recruitment
- COO (Executive) over Operations + Support
- VP Sales (Executive) over Sales + Marketing
- Finance Head reporting straight to Company Admin (no Executive — a deliberate choice per §3, not a gap)

**The scaling mechanism is entirely "don't create the rows you don't need yet."** No schema change, no different code path, no "startup mode" flag — a startup's org chart is just a small instance of the same model, and it grows into the enterprise shape by adding Department/Team/User rows and populating previously-unused tiers, not by migrating to a different structure. This is the same principle §1 already establishes for individual departments (HR skipping Lead/Senior), applied at the whole-company level.

---

## 7. What this changes structurally, concretely

- **New `Department.type` field** (free-text or small lookup, tenant-editable — same "structured, not hardcoded" philosophy as everything else in the Configuration Engine). Drives the label/responsibility tables in §4.
- **New `Executive` tier** inserted into the `extends` chain between Company Admin and Department Head.
- **A department can optionally have a `parentId`-based subtree** that an Executive is scoped over (this already exists as `Department.parentId` — it's just never been scope-aware until now, see §8).
- **Everything else about the existing ladder (Manager ≈ today's Project Manager/Team Lead tiers, Lead, Senior Practitioner ≈ Senior Employee, Practitioner ≈ Employee, Intern) is a relabeling and minor re-slotting of what's already built**, not a rewrite. HR Manager's existing special-cased `department:manage:tenant`/`user:manage:tenant` grants (§31 in CONTEXT.md) become the seed for how department-specific bonus permissions (§4) work generally, rather than a one-off exception.

---

## 8. The Executive tier needs department-subtree scope — a real, currently-missing capability

Today, `isRowInScope()`, `tasksWhere()`, and `projectsWhere()` all do **exact** `departmentId` equality. `Department.parentId` exists and is displayed (§21 in CONTEXT.md), but nothing walks it — a Department Head over a parent department cannot already see a child department's data, by explicit prior design choice.

An Executive's whole purpose (oversee Engineering **and** QA **and** DevOps as one CTO) requires a genuinely new scope value:

**New scope enum: `"own" | "team" | "department" | "department-subtree" | "tenant"`** — a superset of today's four, inserting the new value between `department` and `tenant`. **This exact enum is what every future module (§0's compliance rule) must reuse — no module invents its own scope granularity.**

`department-subtree` resolution means: "is this row's department equal to mine, **or** a descendant of mine (walking `parentId` down)?" Two implementation options, deliberately **not decided here** (an implementation-time call, not a design one):
- **Recursive query at check time** (a recursive CTE walking `parentId`) — simplest, no new tables, fine at the department-tree sizes real tenants will have.
- **Materialized closure table** (`DepartmentClosure(ancestorId, descendantId)`, maintained on department create/reparent) — faster reads, more moving parts on writes.

Recommendation when this is actually built: start with the recursive-query approach (matches this project's consistent "don't optimize before it's needed" pattern elsewhere) and revisit only if department trees turn out to be deep/wide enough to matter.

---

## 9. The manager/reports-to relationship — the primary mechanism for approvals and workflows

Role tier and department/team placement answer **"what can this person do."** They do not answer **"who is this specific person's boss"** — and approvals (leave, performance review, and any future approval-shaped workflow) must route to one specific person, not "anyone senior enough." **This is the single most important mechanism in this document for anything workflow-shaped** — every future approval, review, or escalation feature is built on top of it, not on the tier ladder directly.

**New field: `User.managerId`** (self-referential, nullable FK to `User`). Independent of role and department:

- Set explicitly when someone is placed into a team/department (UI should default-suggest that team's Manager-tier person, or the Department Head if no team Manager exists yet — but it's always an editable, explicit field, never silently re-derived).
- **Does not have to match the org chart exactly.** A Senior Developer's `managerId` is normally their Engineering Manager, but the field exists precisely so exceptions (a Practitioner reporting directly to a Department Head in a very small department, a dotted-line report, an HR Manager acting as the manager-of-record for an employee whose actual team lead isn't people-management-authorized, etc.) are representable without distorting the tier/department model.
- Drives 1:1s and "my manager" views in future Calendar/Chat modules, in addition to approval routing.
- **Every future module that needs "who approves this" or "who is this person's boss" reads `managerId` — never re-derives it from role/department.** This is the compliance rule from the top of this document, restated at the point where it matters most.

---

## 10. Approval-routing principle (generic — governs Leave, Performance Review, and any future approval workflow)

One rule, reused everywhere an approval-shaped workflow is ever built:

1. **Default approver = the requester's `managerId`.**
2. **Escalation walks the manager chain** (my manager's manager, and so on) — **not** the role-tier ladder. A request never jumps straight to "whoever has the highest role" — it climbs the actual reporting line.
3. **Department Head (their department), Executive (their subtree), and Company Admin (tenant-wide) always retain override visibility and action rights within their scope**, as a safety valve (e.g., a manager is on leave themselves, or a request has sat too long) — but they are never the *first* approver by default.

This is deliberately the only piece of "workflow" logic in this document — no Leave or Performance Review data model is specified here (out of scope per §12). Whichever module implements either feature later **must** implement exactly this routing rule rather than inventing its own (per §0's compliance rule).

---

## 11. Task, project, and assignment principles (reconciling with what's already built)

- **Project/Task scope reuses the same 5-value enum (§8)** as everything else — no bespoke scoping logic per module. `project:create`/`task:create` at Manager tier and above; `task:update`/`task:reassign` flow the same way they do today (§31 in CONTEXT.md), just against the new tier names.
- **Assignment is still top-down through the org structure**: Department Head/Executive/Manager create and assign; Lead/Senior Practitioner reassign and prioritize within their team; Practitioner/Intern execute and update status on what's assigned to them. This is already exactly how Projects/Tasks work today (`ProjectMember`, `task.reassign`, scope-gated `task:update`) — no change to the mechanism, only to which tier label sits where.
- **`ProjectMember`/task assignment remain independent of the manager chain.** Being someone's manager doesn't automatically make you a project member or a task's assignee — those are still explicit, per the existing model. The manager chain is for approvals and reporting-line views, not project staffing.

---

## 12. Deliberately out of scope for this document

Per the agreed scoping, this document defines **the hierarchy and the principles every module must respect** — not concrete data models for modules that don't exist yet:

- **Leave and Performance Review** — no schema here. Whichever module builds these must follow §10's routing principle; the actual request/approval/history schema is that module's own dedicated design session.
- **CRM, Calendar, Meetings, Chat, Documents, Analytics** — each gets its own future design session. The only commitment this document makes on their behalf (and it *is* a commitment, per §0): **reuse the same 5-value scope enum** (§8) rather than inventing per-module scoping, and **default to the org graph (manager, team, department) for sensible defaults** (e.g., "meet with my manager," "share with my team") without treating that as a hard permission gate the way data mutations are.
- **AI Assistant** — one hard rule, stated now because it's cheap to get wrong later: **the assistant always operates under the invoking user's own effective permissions.** It never sees or acts on anything that user's own RBAC wouldn't already allow directly. No separate "AI can see everything" mode.
- **Notifications** — no structural change. Approval-shaped events (once built) target `managerId` and escalate the same way §10 describes; everything else about notifications (§18 in CONTEXT.md — ownership-based, no permission gate) is unchanged.
- **The Support→Engineering ticket-escalation gap** flagged in §4.7 — a real future design question, not resolved here.
- **The exact list of department types and their bonus permissions** — §4's taxonomy is the reference default, not a hardcoded constraint. A tenant's actual department roster (and eventually, which bonus permissions each type carries) should stay tenant-configurable, the same philosophy as blueprint overrides elsewhere in this system.

---

## 13. Platform Owner — explicitly a separate, future subsystem, not designed here

"Platform Owner" (Antigravity's own staff, sitting above every customer tenant) is a **cross-tenant** concept — a fundamentally different subsystem from everything above, which is entirely about one tenant's internal org chart. It implies its own internal-staff authentication, support/impersonation tooling, and cross-tenant access model, none of which exists today and none of which this document attempts to design. It's noted here only so it isn't confused with `Company Admin` (which remains the top of a single tenant's own hierarchy, unchanged). Treat this the same way Stripe billing is already treated in `CONTEXT.md` §3 (decision 9): a real, deliberately deferred future initiative, not a gap in this design.

---

## 14. What survives unchanged from today's system

- Company Admin's flat, bypass-everything nature (§31's `sourceBlueprintRoleId === "role.admin"` check).
- The `extends`-chain materialization mechanism itself (`resolveBlueprintRoles`, `materializeBlueprintRoles`) — tiers slot into it; it isn't replaced.
- `isRoleAssignable`'s "walk up your own chain" direction for who-can-assign-what-role.
- Delegation (Company Admin granting extra runtime privileges, e.g. `user:invite`, to a specific role) remains its own explicitly deferred stage (§31 in CONTEXT.md), unaffected by this document — it composes cleanly with tiers exactly as it would have with the old flat roles.
- `ProjectMember`, `task.reassign`, notifications, Settings, HR module mechanics — all unchanged in mechanism; only role/tier labels change.

---

## 15. Next steps

1. ~~A dedicated plan-mode session designs the concrete migration~~ — **done, see §16.**
2. ~~`CONTEXT.md`/`ARCHITECTURE.md` get updated to reference this document~~ — **done** (`CONTEXT.md` §34/§36, `ARCHITECTURE.md` §5.4–§5.9).
3. **Every future module design is checked against §0 and §8–§12's principles before it's approved** — this remains a standing item in every future stage's completion criteria (see `CONTEXT.md`'s working agreement). Still applies going forward: nothing about Phase 1 shipping changes this rule.

---

## 16. Implementation record — Phase 1 (2026-07-17, complete)

The RBAC/schema core is live and verified across all 3 real tenants (`yash-1`, `magar-limited`, `new-start-limited`). Full detail: `CONTEXT.md` §36, `CHANGELOG.md`'s matching session entry, `ARCHITECTURE.md` §5.4–§5.9. Summary:

- **The 7-tier ladder, `Executive` tier, and Department Type mechanism (§1–§7) are built exactly as designed** — all existing blueprint role `id`s unchanged (only labels, and `role.hr-manager`'s `extends` target, changed), zero `RoleAssignment` disruption, confirmed live before/after reseeding all 3 real tenants.
- **The generic department-type bonus-permission engine you asked for (§3/§4, overriding the simpler one-off recommendation) turned out to need no new runtime mechanism at all** — bonus permissions are just an ordinary extends-chain blueprint role (today: `role.hr-manager`), reusing the exact same mechanism the tier ladder itself already uses. Confirmed during implementation, not assumed.
- **`department-subtree` scope (§8) is live and was verified under real authentication** — a real Executive-tier user, having completed the full invite → first-login → password-change flow, successfully created a department within their own subtree and was correctly rejected creating one outside it.
- **`User.managerId` (§9) exists and is settable** (`user.setManager`) but has zero real consumers yet — no approval workflow has been built to route through it. That's expected; it was built ahead of its first consumer, deliberately, per §9's own framing.
- **Three real bugs found and fixed during live verification, none of them design flaws — all implementation-level**: (1) the department-type label materialization initially did 47 sequential DB round-trips, which 500'd every fresh signup by exceeding a transaction timeout — fixed with one batched query; (2) `user.invite`'s own transaction could hit the same timeout class when an external email-provider call was slow, leaving an orphaned Supabase Auth account — mitigated with a longer timeout, with the real fix (moving external I/O out of the transaction) flagged as a genuine follow-up; (3) the label overlay initially could display a bonus-permission-carrying label ("HR Manager") on someone who didn't actually hold the bonus-granting role — fixed to check the user's real role id, not just their tier and department type.
- **Not yet exercised with real usage**: no real tenant has populated a full department taxonomy of its own (Sales/Marketing/Finance/etc.) or placed a real person at the Executive tier outside of throwaway-tenant verification. The mechanism is proven; real-world usage is still ahead.
- **Addendum (2026-07-18, Sidebar Navigation Phase 1)**: the workspace sidebar's nav visibility now derives from this exact tier/permission model — no separate nav-visibility concept was introduced. A role-grouped nav restructure (an "HR" group and a "Workspace Administration" group, per §3/§4's department taxonomy) reuses existing tier permissions (`user:manage`, `department:manage`, `settings:manage`, `role:manage`, `project:create`) with zero new grants, and a page/nav permission-sync fix ensures a page's own access now always matches its nav visibility. Full detail: `CONTEXT.md` §41, `ARCHITECTURE.md` §6.9/§7.8.
- **Addendum (2026-07-19, Company Administration Submodule C: Organization Lifecycle)**: full department/team edit/archive/delete/move/assign-head/assign-manager capability was added reusing `department:manage` exactly as it already existed here — **no new permission triple, no change to the authority model, confirmed at doc-update time rather than assumed at planning time.** The one genuinely new piece of authority-adjacent logic (`resolveDepartmentTierRole`, resolving a department-type role override before falling back to the plain tier role when assigning a head/manager) is a direct reuse of this document's own §3/§4 `DepartmentTypeRoleLabel` mechanism, not a new one. Full detail: `CONTEXT.md` §45, `ARCHITECTURE.md` §8.1/§9.1.
