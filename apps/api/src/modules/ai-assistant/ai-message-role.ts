import { z } from "zod";

/** Phase D — `AiMessage.role` finally validated rather than an unconstrained
 * string with an unchecked cast at every read site. `"tool"` is new: the
 * deterministic (non-LLM) result summary persisted after a confirmed tool
 * call executes (see ai-tool-call.mutations.ts). */
export const AiMessageRoleSchema = z.enum(["user", "assistant", "tool"]);
export type AiMessageRole = z.infer<typeof AiMessageRoleSchema>;
