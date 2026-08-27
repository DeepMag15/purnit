/**
 * Hand-maintained catalog of the mutations the AI assistant is allowed to
 * *propose* calling on the user's behalf (Phase D, tool-calling) — the
 * single source of truth for what the model can offer as a tool. Mirrors
 * `rbac/permission-catalog.ts`'s own shape and reasoning: this is a
 * security-relevant surface, so it must be auditable in one diff, not
 * discoverable only by grepping every `*.mutations.ts` file for an opt-in
 * flag.
 *
 * Nothing here executes anything by itself — every proposed call still goes
 * through mandatory human confirmation (`aiToolCall.confirm`) and a fresh
 * `checkRequiredPermission` re-check against the *confirming* user's
 * *current* permissions before the target mutation's real `resolve()` ever
 * runs. This list only controls what the model may *suggest*.
 *
 * ⚠️ Standing maintenance obligation: every entry must resolve to a real,
 * currently-registered `MutationRegistry` name — enforced at boot via
 * `AiAssistantRegistrar.onApplicationBootstrap()`, which crashes the app on
 * a typo'd or since-removed entry rather than failing silently later.
 *
 * v1 ("moderate" tier, chosen by the user of 3 options): all low-risk,
 * ownership-gated creates/self-updates, plus a curated slice of medium-risk
 * business actions with clear "do this for me" phrasing and contained
 * consequences. Deliberately excluded from this pass: anything moving money
 * or physical stock (`payment.record`, `purchaseOrder.receive`,
 * `workOrder.complete`, `inventoryItem.adjustStock`), sensitive
 * reassignment (`patient.assignDoctor`, `client.assignAccountManager`),
 * and — regardless of tier — every auth/RBAC/tenant-config/org-structure/
 * destructive mutation (`user.*`, `role.*`, `delegation.*`,
 * `featureFlag.set`, `tenant.*`, `workspaceConfig.*`, `department.*`/
 * `team.*`, every `*.delete`). Revisit once this tier has earned trust in
 * real use, not speculatively now.
 */

export interface AllowlistedTool {
  /** Must exactly match a MutationRegistry-registered name. */
  mutationName: string;
  /** LLM-facing — "what this tool does," not user-facing copy. */
  description: string;
}

export const AI_TOOL_ALLOWLIST: readonly AllowlistedTool[] = [
  // Low-risk: ownership-gated creates / self-scoped updates.
  { mutationName: "task.create", description: "Create a new task in a project." },
  { mutationName: "task.updateStatus", description: "Update a task's status (e.g. mark it in progress, done, or blocked)." },
  { mutationName: "task.updateDueDate", description: "Change a task's due date." },
  { mutationName: "leave.submit", description: "Submit a new leave request for time off." },
  { mutationName: "leave.cancel", description: "Cancel a pending or approved leave request." },
  { mutationName: "comment.create", description: "Post a comment on a project, task, or document." },
  { mutationName: "message.send", description: "Send a chat message in an existing conversation or channel." },
  { mutationName: "conversation.createDm", description: "Start a new direct-message conversation with another user." },
  { mutationName: "conversation.markRead", description: "Mark a chat conversation as read." },
  { mutationName: "notification.markRead", description: "Mark a single notification as read." },
  { mutationName: "notification.markAllRead", description: "Mark all of the user's notifications as read." },
  { mutationName: "calendarEvent.create", description: "Create a new calendar event." },
  { mutationName: "meeting.create", description: "Schedule a new meeting." },
  { mutationName: "dashboardLayout.save", description: "Save the user's current dashboard widget layout." },
  { mutationName: "dashboardLayout.reset", description: "Reset the user's dashboard layout back to the default." },
  { mutationName: "aiConversation.create", description: "Start a new AI assistant conversation." },
  { mutationName: "announcement.create", description: "Post a new company or department announcement." },

  // Medium-risk, curated: real business actions with contained consequences.
  { mutationName: "task.reassign", description: "Reassign a task to a different team member." },
  { mutationName: "leave.approve", description: "Approve a pending leave request." },
  { mutationName: "leave.reject", description: "Reject a pending leave request." },
  { mutationName: "deal.create", description: "Create a new CRM deal or sales opportunity." },
  { mutationName: "deal.updateStage", description: "Move a CRM deal to a different pipeline stage." },
  { mutationName: "invoice.create", description: "Create a new invoice for a client." },
  { mutationName: "purchaseOrder.create", description: "Create a new purchase order with a supplier." },
  { mutationName: "purchaseOrder.updateStatus", description: "Update a purchase order's status (e.g. submit it for approval)." },
  { mutationName: "workOrder.create", description: "Create a new manufacturing work order." },
  { mutationName: "workOrder.updateStatus", description: "Update a work order's status (e.g. start production)." },
  { mutationName: "appointment.updateStatus", description: "Update an appointment's status (e.g. mark it completed or cancelled)." },
  { mutationName: "patient.updateStatus", description: "Update a patient's status." },
  { mutationName: "enrollment.enroll", description: "Enroll a student in a course." },
  { mutationName: "grade.record", description: "Record a new grade for a student's assignment." },
  { mutationName: "project.addMember", description: "Add a member to a project." },
  { mutationName: "meeting.cancel", description: "Cancel a scheduled meeting." },
];
