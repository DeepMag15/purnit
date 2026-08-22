import type { ComponentType, ReactNode } from "react";
import type { z } from "zod";
import type { ActionSpec, DataBinding, UINode } from "@purnit/manifest-schema";

/** Every primitive/composite component receives its Zod-validated props
 * spread at the top level, plus these — matching ARCHITECTURE.md §7.5's
 * renderer contract (`{...props} bind={...} actions={...} renderChild={...}`),
 * extended with `childNodes` since the architecture's sketch omits how a
 * container actually knows what to recurse into. */
export interface CommonRenderProps {
  nodeId: string;
  bind?: DataBinding;
  actions?: ActionSpec[];
  childNodes?: UINode[];
  renderChild: (node: UINode) => ReactNode;
}

export interface RegistryEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry entries are necessarily heterogeneous; individual `register()` calls are still type-safe.
  Component: ComponentType<any>;
  schema: z.ZodTypeAny;
}

const registry = new Map<string, RegistryEntry>();

export function registerPrimitive<P extends object>(
  type: string,
  version: number,
  schema: z.ZodType<P>,
  Component: ComponentType<P & CommonRenderProps>,
): void {
  const key = `${type}@${version}`;
  if (registry.has(key)) {
    throw new Error(`Primitive "${key}" is already registered`);
  }
  registry.set(key, { Component: Component as RegistryEntry["Component"], schema });
}

export function getPrimitive(type: string, version: number): RegistryEntry | undefined {
  return registry.get(`${type}@${version}`);
}

/** Test-only: clears the registry so each test file starts fresh. */
export function __resetRegistryForTests(): void {
  registry.clear();
}
