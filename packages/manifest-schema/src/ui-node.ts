import { z } from "zod";

export const BindExprSchema = z.union([z.object({ const: z.unknown() }), z.object({ ref: z.string() })]);
export type BindExpr = z.infer<typeof BindExprSchema>;

export const DataBindingSchema = z.union([
  z.object({
    source: z.string(),
    params: z.record(z.string(), BindExprSchema).optional(),
    paginate: z.boolean().optional(),
  }),
  z.object({ const: z.unknown() }),
  z.object({ ref: z.string() }),
]);
export type DataBinding = z.infer<typeof DataBindingSchema>;

const requiredPermissionField = { requiredPermission: z.string().optional() };

export const ActionSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), to: z.string(), ...requiredPermissionField }),
  z.object({ kind: z.literal("mutation"), mutation: z.string(), input: BindExprSchema, ...requiredPermissionField }),
  z.object({ kind: z.literal("openModal"), page: z.string(), ...requiredPermissionField }),
  z.object({ kind: z.literal("openDrawer"), page: z.string(), ...requiredPermissionField }),
  z.object({
    kind: z.literal("aiPrompt"),
    preset: z.string(),
    context: BindExprSchema.optional(),
    ...requiredPermissionField,
  }),
  z.object({ kind: z.literal("download"), export: z.string(), ...requiredPermissionField }),
]);
export type ActionSpec = z.infer<typeof ActionSpecSchema>;

export interface UINode {
  id: string;
  type: string;
  version: number;
  props?: Record<string, unknown>;
  bind?: DataBinding;
  children?: UINode[];
  actions?: ActionSpec[];
  /** "resource:action" — if absent, the node is always visible to any tenant member. */
  requiredPermission?: string;
}

// Recursive (children: UINode[]) — z.lazy() is required for self-reference;
// the explicit z.ZodType<UINode> annotation is required alongside it because
// TypeScript can't infer a recursive type through z.lazy() on its own.
export const UINodeSchema: z.ZodType<UINode> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.string(),
    version: z.number().int(),
    props: z.record(z.string(), z.unknown()).optional(),
    bind: DataBindingSchema.optional(),
    children: z.array(UINodeSchema).optional(),
    actions: z.array(ActionSpecSchema).optional(),
    requiredPermission: z.string().optional(),
  }),
);
