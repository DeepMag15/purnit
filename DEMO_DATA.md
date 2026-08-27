# Demo Data — Login Credentials

Generated demo dataset covering all 5 industry blueprints. Each company (tenant) has
**6 users** (1 Admin + 5 workers in different roles), **18 projects**, and **3–5 tasks per user**.

All accounts share the same password: **`Demo@12345`**

## How to log in

1. Go to `/login`.
2. Enter the **Workspace ID** for the company you want (see each section below).
3. Enter the user's **Email**.
4. Enter the password: `Demo@12345`.

No password change is required on first login — every account logs straight into the workspace.

---

## IT — Nimbus Technologies

**Workspace ID:** `nimbus-technologies`

| Email | Password | Role | Name |
|---|---|---|---|
| admin@nimbustech.demo | Demo@12345 | Company Admin | Alex Morgan |
| executive@nimbustech.demo | Demo@12345 | Executive | Jordan Blake |
| manager@nimbustech.demo | Demo@12345 | Manager | Taylor Reed |
| lead@nimbustech.demo | Demo@12345 | Lead | Casey Kim |
| practitioner@nimbustech.demo | Demo@12345 | Practitioner | Riley Chen |
| intern@nimbustech.demo | Demo@12345 | Intern | Sam Patel |

**Domain data:** a real org hierarchy — Technology (department group) containing Engineering, QA, and DevOps departments, with a "Platform Team" under Engineering. Jordan Blake (Executive) sits at the Technology group level and shows as "CTO"; Taylor Reed (Manager) and Casey Kim (Lead) are in Engineering ("Engineering Manager"/"Tech Lead"); Riley Chen (Practitioner) is in QA ("QA Engineer"); Sam Patel (Intern) is in DevOps. Try `admin@nimbustech.demo` and open the HR / Org Chart page, or `manager@nimbustech.demo` to see department-scoped visibility in action.

---

## Healthcare — Riverside Medical Center

**Workspace ID:** `riverside-medical-center`

| Email | Password | Role | Name |
|---|---|---|---|
| admin@riversidemedical.demo | Demo@12345 | Hospital Administrator | Morgan Ellis |
| doctor1@riversidemedical.demo | Demo@12345 | Doctor | Dr. Priya Nair |
| doctor2@riversidemedical.demo | Demo@12345 | Doctor | Dr. Marcus Webb |
| nurse1@riversidemedical.demo | Demo@12345 | Nurse | Elena Cruz |
| nurse2@riversidemedical.demo | Demo@12345 | Nurse | James Okafor |
| receptionist@riversidemedical.demo | Demo@12345 | Receptionist | Grace Liu |

> Receptionist deliberately has no Projects/Tasks access — that's a real RBAC design choice, not a bug (front-desk staff never join a chart's Project).

**Domain data:** 14 patients (each with their own chart of Documents/Discussion), 27 appointments across the 2 doctors, spread across the past and next month with a realistic status mix (scheduled/completed/cancelled/no-show). A few patients are unassigned to any doctor. Try `doctor1@riversidemedical.demo` to see one doctor's own patient load, or `admin@riversidemedical.demo` for the full roster.

---

## Education — Crestwood Academy

**Workspace ID:** `crestwood-academy`

| Email | Password | Role | Name |
|---|---|---|---|
| admin@crestwoodacademy.demo | Demo@12345 | School Administrator | Dana Whitfield |
| teacher1@crestwoodacademy.demo | Demo@12345 | Teacher | Olivia Bennett |
| teacher2@crestwoodacademy.demo | Demo@12345 | Teacher | Noah Fitzgerald |
| ta1@crestwoodacademy.demo | Demo@12345 | Teaching Assistant | Maya Singh |
| ta2@crestwoodacademy.demo | Demo@12345 | Teaching Assistant | Ethan Brooks |
| registrar@crestwoodacademy.demo | Demo@12345 | Registrar | Chloe Adams |

> Registrar deliberately has no Projects/Tasks access, same "structurally excluded" pattern as Receptionist above.

**Domain data:** 8 courses (4 taught by each teacher), 24 students, 60 enrollments (2-3 courses per student), 32 assignments (4 per course), and 139 grades — a real gradebook, not fully filled in (past-due assignments are ~80% graded, future ones are ungraded, matching a real in-progress term). Try `teacher1@crestwoodacademy.demo` to see just their own courses' gradebook, or `registrar@crestwoodacademy.demo` for the full student roster with zero gradebook access.

---

## Finance — Alder Financial Group

**Workspace ID:** `alder-financial-group`

| Email | Password | Role | Name |
|---|---|---|---|
| admin@alderfinancial.demo | Demo@12345 | Finance Director | Harper Collins |
| accountant1@alderfinancial.demo | Demo@12345 | Accountant | Nathan Price |
| accountant2@alderfinancial.demo | Demo@12345 | Accountant | Isabella Ruiz |
| billingclerk@alderfinancial.demo | Demo@12345 | Billing Clerk | Lucas Grant |
| salesrep1@alderfinancial.demo | Demo@12345 | Account Manager | Zoe Harrington |
| salesrep2@alderfinancial.demo | Demo@12345 | Account Manager | Owen Mitchell |

> Only the Accountant can both create invoices AND record payments — Billing Clerk can invoice but never record a payment, Account Manager sees only their own clients' invoices. Real segregation-of-duties, worth trying both accounts back to back.

**Domain data:** 14 clients (split across the 2 Account Managers), 24 invoices with realistic multi-line-item billing (retainers, consulting hours, licenses), and 11 payments. Invoice statuses cover the full lifecycle: drafts, paid-in-full, partially paid, unpaid-but-not-yet-due, genuinely overdue (past due date, zero payment), and a couple voided. Try `accountant1@alderfinancial.demo` for the full invoice/payment picture, or `salesrep1@alderfinancial.demo` to see the client-confidentiality scope in action (all clients visible, but only their own clients' invoices).

---

## Manufacturing — Ironclad Manufacturing Co

**Workspace ID:** `ironclad-manufacturing-co`

| Email | Password | Role | Name |
|---|---|---|---|
| admin@ironcladmfg.demo | Demo@12345 | Plant Manager | Frank Delgado |
| planner1@ironcladmfg.demo | Demo@12345 | Production Planner | Wanda Osei |
| planner2@ironcladmfg.demo | Demo@12345 | Production Planner | Derek Novak |
| procurement@ironcladmfg.demo | Demo@12345 | Procurement Officer | Amara Johnson |
| warehouse1@ironcladmfg.demo | Demo@12345 | Warehouse Staff | Tomas Vargas |
| warehouse2@ironcladmfg.demo | Demo@12345 | Warehouse Staff | Nina Kowalski |

> Three-way-match control: Procurement Officer orders but can't receive; Warehouse Staff receives but can't order; Production Planner schedules but can't complete a work order. Only Warehouse Staff holds both `purchaseOrder:receive` and `workOrder:complete`.

**Domain data:** 8 suppliers, 20 inventory items (14 raw materials + 6 finished goods), 24 BOM lines (each finished good has a real 3-5 component recipe), 16 purchase orders, and 16 work orders — full status spread (draft/submitted/received/cancelled for POs, planned/in_progress/completed/cancelled for work orders). 4 items are deliberately sitting at or below their reorder point, so the Analytics dashboard's low-stock signal has something real to show. Try `admin@ironcladmfg.demo` or `planner1@ironcladmfg.demo` and open an inventory item's Bill of Materials tab.

---

## What's populated

**Universal (all 5 domains):**
- **30 users** across 5 tenants (6 per tenant), each with a real role from that domain's blueprint.
- **90 projects** (18 per tenant), owned/shared across each tenant's users with realistic, domain-flavored names.
- **~118 tasks** (3–5 per user), assigned via `assigneeId`, spread across statuses (`todo` / `in_progress` / `done`) and priorities (`low` / `medium` / `high`).

**Domain-specific** (see each domain's own section above for details):
- **IT** — a real department/team org hierarchy (4 departments, 1 team) with all 5 workers placed into it.
- **Healthcare** — 14 patients, 27 appointments.
- **Education** — 8 courses, 24 students, 60 enrollments, 32 assignments, 139 grades.
- **Finance** — 14 clients, 24 invoices, 11 payments, covering the full invoice-lifecycle status spread.
- **Manufacturing** — 8 suppliers, 20 inventory items, 24 BOM lines, 16 purchase orders, 16 work orders.

Every number above was generated by directly replicating each domain's own real mutation logic (backing
Projects for Patients/Courses/Clients/Inventory Items, server-computed invoice/PO totals, etc.) rather than
raw inserts, and was live-verified by logging in as real accounts across all 5 domains and confirming the
data is visible through the actual RBAC-scoped data sources — not just present in the database.
