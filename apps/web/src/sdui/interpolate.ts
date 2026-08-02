export function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** Replaces "{{path.to.value}}" tokens in a string using dot-path lookup
 * against `context`. Unknown paths render as an empty string rather than
 * leaving the raw token visible or throwing. */
export function interpolate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const value = getByPath(context, path);
    return value === undefined || value === null ? "" : String(value);
  });
}
