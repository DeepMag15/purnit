/**
 * Go-Live, Phase 02 — the public site's content, in one place.
 *
 * Every claim here describes something that is actually built. That is a hard
 * rule, not a stylistic preference: the landing page is the first thing a
 * prospective customer reads, and a feature list that overstates what ships
 * turns into a support problem on day one. When something is genuinely a
 * commitment rather than a feature (support tiers), it is worded as one.
 *
 * Kept as data rather than inline JSX so the landing page, the pricing page
 * and the per-industry pages cannot drift apart — an industry gaining a
 * module should change one entry here, not three templates.
 */

export interface IndustryContent {
  /** Matches the `industry` value the signup flow sends and the blueprint key. */
  key: string;
  /** URL segment for /industries/[industry]. */
  slug: string;
  name: string;
  /** Material Symbols ligature name — see ui/Icon.tsx. */
  icon: string;
  tagline: string;
  /** Landing-page card copy — one sentence, concrete. */
  summary: string;
  /** The industry-specific objects this blueprint adds beyond the shared core. */
  modules: string[];
  /** Roles the blueprint ships with, in seniority order. */
  roles: string[];
  /** Long-form intro for the industry page. */
  intro: string;
  /** Real, specific things this workspace does on day one. */
  highlights: { title: string; body: string }[];
}

export const INDUSTRIES: IndustryContent[] = [
  {
    key: "IT",
    slug: "it",
    name: "IT & Software",
    icon: "terminal",
    tagline: "Projects, delivery and the people doing the work",
    summary: "Project boards, task assignment and delivery tracking, wired to the org chart so scope follows seniority automatically.",
    modules: ["Projects", "Tasks", "Project documents", "Delivery analytics"],
    roles: ["Intern", "Practitioner", "Senior Practitioner", "Lead", "Manager", "Department Head", "Executive", "Company Admin"],
    intro:
      "The blueprint Purnit was first proven on. An IT workspace opens on project boards, task assignment and delivery metrics, with permissions that follow your real reporting structure rather than a flat list of roles.",
    highlights: [
      {
        title: "Boards, tables and lists over the same data",
        body: "Every project and task view is a different lens on one server-authorized query — no exports, no second source of truth.",
      },
      {
        title: "Assignment respects membership",
        body: "A task can only be assigned to someone actually on the project. Enforced server-side, not by a disabled dropdown.",
      },
      {
        title: "Delivery analytics out of the box",
        body: "Completion rates, at-risk projects and workload distribution are computed from your live data, not a separate BI tool you wire up later.",
      },
    ],
  },
  {
    key: "Healthcare",
    slug: "healthcare",
    name: "Healthcare",
    icon: "stethoscope",
    tagline: "Patients, appointments and care records",
    summary: "Patient records, appointment scheduling and care-plan tracking, with role boundaries strict enough that a receptionist never sees a chart.",
    modules: ["Patients", "Appointments", "Medical records", "Care plans"],
    roles: ["Receptionist", "Nurse", "Doctor", "Department Head", "Executive", "Company Admin"],
    intro:
      "The first non-IT blueprint, and the one that proved the model. A Healthcare workspace is built around patients and appointments rather than projects and tasks — and its role boundaries are genuinely structural, not cosmetic.",
    highlights: [
      {
        title: "Structural exclusion, not hidden buttons",
        body: "A Receptionist can register a patient and book appointments but holds no chart-read permission at all. The record is absent from what the server sends them, not hidden by CSS.",
      },
      {
        title: "Appointments are their own object",
        body: "A patient has no login, so appointments are a dedicated model rather than a meeting with an external attendee bolted on.",
      },
      {
        title: "Care plans reuse the task engine",
        body: "Care-plan items are real tracked work with owners and due dates, using the same scheduling and reminder machinery as everything else.",
      },
    ],
  },
  {
    key: "Education",
    slug: "education",
    name: "Education",
    icon: "school",
    tagline: "Students, courses and coursework",
    summary: "Student records, course rosters, assignments and a gradebook, with enrollment data visible only to the roles that should see it.",
    modules: ["Students", "Courses", "Assignments", "Gradebook", "Enrollments"],
    roles: ["Teaching Assistant", "Teacher", "Registrar", "Department Head", "Executive", "Company Admin"],
    intro:
      "An Education workspace opens on students and courses. Teachers manage their own rosters and coursework; enrollment records stay with the roles that administer them.",
    highlights: [
      {
        title: "Enrollment data is separately gated",
        body: "Teachers and TAs can read students without ever holding enrollment-read permission — two different questions, two different grants.",
      },
      {
        title: "Assignments and grading in the same place as the roster",
        body: "Coursework attaches to the course it belongs to, and the gradebook reads from it directly rather than from a parallel spreadsheet.",
      },
      {
        title: "Term scheduling on the shared calendar",
        body: "Course sessions, assignment due dates and staff meetings all land on one calendar, each respecting its own visibility rules.",
      },
    ],
  },
  {
    key: "Finance",
    slug: "finance",
    name: "Finance & Professional Services",
    icon: "account_balance",
    tagline: "Clients, invoices and payments",
    summary: "Client records, invoicing and payment tracking, with revenue analytics that read from live invoices rather than a monthly export.",
    modules: ["Clients", "Invoices", "Payments", "Revenue analytics"],
    roles: ["Analyst", "Billing Clerk", "Account Manager", "Department Head", "Executive", "Company Admin"],
    intro:
      "A Finance workspace is organized around clients and the money they owe. Invoices, payments and account ownership live together, and the dashboards read from them directly.",
    highlights: [
      {
        title: "Billing and client management are separate authorities",
        body: "A Billing Clerk can manage invoices without being able to edit client records — a split that matches how these teams actually work.",
      },
      {
        title: "Currency-aware analytics",
        body: "Revenue, outstanding balances and collection rates are first-class metrics, formatted as money rather than raw numbers.",
      },
      {
        title: "Payments reconcile against invoices",
        body: "A payment belongs to an invoice, so outstanding balance is derived, never manually maintained.",
      },
    ],
  },
  {
    key: "Manufacturing",
    slug: "manufacturing",
    name: "Manufacturing",
    icon: "precision_manufacturing",
    tagline: "Inventory, suppliers, procurement and production",
    summary: "Inventory with bills of materials, supplier records, purchase orders and work orders — the full path from raw stock to finished output.",
    modules: ["Inventory items", "Bills of materials", "Suppliers", "Purchase orders", "Work orders"],
    roles: ["Warehouse Staff", "Procurement Officer", "Production Planner", "Department Head", "Executive", "Company Admin"],
    intro:
      "The most operationally dense blueprint. A Manufacturing workspace covers stock, the components that make up each item, the suppliers you buy from, and the work orders that turn one into the other.",
    highlights: [
      {
        title: "Bills of materials are real structure",
        body: "An inventory item's components are modelled as their own records, so a work order knows what it consumes.",
      },
      {
        title: "Procurement and production are distinct roles",
        body: "Warehouse staff adjust stock; procurement raises purchase orders; planners open work orders. Each holds exactly the authority its job needs.",
      },
      {
        title: "Production scheduling on the shared calendar",
        body: "Work orders and purchase-order delivery dates appear alongside everything else your team is scheduled for.",
      },
    ],
  },
];

export function industryBySlug(slug: string): IndustryContent | undefined {
  return INDUSTRIES.find((i) => i.slug === slug);
}

export interface Capability {
  key: string;
  icon: string;
  title: string;
  summary: string;
  points: string[];
}

/**
 * The five capability areas the platform genuinely has. Ordered by what a
 * buyer evaluates first, not by how impressive they sound — the security
 * section sits high because that is the question that actually blocks
 * enterprise deals.
 */
export const CAPABILITIES: Capability[] = [
  {
    key: "modules",
    icon: "widgets",
    title: "Core workspace modules",
    summary: "The shared foundation every industry gets, regardless of blueprint.",
    points: [
      "Projects, tasks and documents with version history and approvals",
      "Calendar, meetings with video, and attendance tracking",
      "Leave requests routed to a person's real manager, not a role",
      "Channels, direct messages, announcements and threaded comments",
      "Org structure, departments, teams and reporting lines",
    ],
  },
  {
    key: "ai",
    icon: "auto_awesome",
    title: "AI assistant",
    summary: "Grounded in your workspace, and never able to see more than you can.",
    points: [
      "Answers from your own records across more than twenty modules",
      "Every retrieved source is re-checked against your permissions before it reaches the model",
      "Can propose actions — creating a task, approving leave — but never executes without your explicit confirmation",
      "Proactive daily digests of what needs your attention",
      "Runs on Claude, Gemini or OpenAI; switchable per workspace",
    ],
  },
  {
    key: "analytics",
    icon: "insights",
    title: "Analytics & insights",
    summary: "A real BI surface over live data, not a monthly export.",
    points: [
      "Dashboards assembled from a permission-controlled widget catalog",
      "Drag-and-drop layout, saved per person or as a role-wide default",
      "Filter by department, team, project, employee or date range",
      "Kanban and Gantt views for interactive planning",
      "Trend history from daily snapshots, so metrics have a past",
    ],
  },
  {
    key: "collaboration",
    icon: "groups",
    title: "Collaboration",
    summary: "Discussion attached to the work, instead of a separate chat tool.",
    points: [
      "Comment threads with @-mentions on projects and tasks",
      "Channels and direct messages with unread tracking",
      "Company- and department-wide announcements",
      "Meetings with scheduling, participants and video rooms",
      "Presence and status, so you know who is actually around",
    ],
  },
  {
    key: "security",
    icon: "shield_lock",
    title: "Security & access control",
    summary: "Permissions resolved on the server. The browser is never trusted.",
    points: [
      "Seven-tier role hierarchy with scopes from own record to whole organization",
      "Anything you lack permission for is absent from the data sent to you, not hidden in the page",
      "Tenant isolation enforced at the database by row-level security, independent of application code",
      "Per-user permission delegation, granted and revoked without cloning roles",
      "Enterprise SSO through your own identity provider, and an append-only audit log",
    ],
  },
];

/** Pricing-page FAQ. Answers describe real system behaviour, including the
 * parts that are limits rather than features. */
export const PRICING_FAQ: { q: string; a: string }[] = [
  {
    q: "How does per-seat pricing work?",
    a: "You pay for the number of people who can log in. Adding a seat takes effect immediately and is prorated for the rest of your billing period; removing seats takes effect at the end of the period. You cannot reduce below the number of people currently in your workspace.",
  },
  {
    q: "What happens when I reach my seat limit?",
    a: "New invitations are blocked with a message telling you how many seats are in use, and adding more is a single action in your billing settings. Nobody is charged for a seat they did not deliberately buy.",
  },
  {
    q: "Is the trial really free?",
    a: "Yes. Paid plans include a 14-day trial. We collect a card when you sign up so there is no interruption when the trial ends, but you are not charged until day 15, and you can cancel before then at no cost.",
  },
  {
    q: "What does yearly billing save?",
    a: "Two months. The yearly price is ten times the monthly price rather than twelve, and it is charged once per year.",
  },
  {
    q: "Can I change plans later?",
    a: "Upgrades apply immediately and you pay the prorated difference. Downgrades take effect at the end of your current billing period, so you keep what you have already paid for.",
  },
  {
    q: "What happens if a payment fails?",
    a: "Your workspace keeps working. We mark the account past due, notify your admins, and Stripe retries automatically — a declined card does not lock your team out.",
  },
  {
    q: "Can I switch industries after signing up?",
    a: "The industry blueprint is chosen when you create your workspace and determines your starting navigation, roles and modules. Changing it afterwards is not self-serve today — contact us and we will help.",
  },
];

export const NAV_LINKS = [
  { href: "/#capabilities", label: "Platform" },
  { href: "/#industries", label: "Industries" },
  { href: "/pricing", label: "Pricing" },
];
