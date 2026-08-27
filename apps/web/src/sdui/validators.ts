// A handful of common, composable validators matching useFormValidation's
// own `(value) => string | undefined` contract exactly — not a validation-
// schema DSL. A composite with a genuinely unusual validation need just
// writes its own inline validator against the same contract.

export function required(message = "Required"): (value: unknown) => string | undefined {
  return (value) => {
    if (value === undefined || value === null) return message;
    if (typeof value === "string" && value.trim() === "") return message;
    return undefined;
  };
}

// A no-op on an empty string — deferring the "is it present at all"
// question to required(), so the two compose independently on an optional
// email field that's only validated as an email when something was typed.
export function email(message = "Enter a valid email"): (value: unknown) => string | undefined {
  return (value) => {
    if (typeof value !== "string" || value === "") return undefined;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? undefined : message;
  };
}

export function minLength(min: number, message = `Must be at least ${min} characters`): (value: unknown) => string | undefined {
  return (value) => {
    if (typeof value !== "string") return undefined;
    return value.length < min ? message : undefined;
  };
}
