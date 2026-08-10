"use client";

import { useState } from "react";

type Validator<V> = (value: V) => string | undefined;
type Validators<T extends object> = { [K in keyof T]?: Validator<T[K]> };

/**
 * A validator-map-based field-error hook — deliberately works against a
 * composite's own existing separate field `useState`s (collected into a
 * plain object literal only at the `validate()` call site), not a combined
 * "form values" object. Existing composites (PatientsWorkspace etc.) each
 * hand-declare one useState per field; migrating every one onto a single
 * values object would be a bigger rewrite than this phase's own
 * "small, additive infrastructure" scope allows.
 *
 * Bound to `object` rather than `Record<string, unknown>` deliberately — a
 * plain field-shape interface (no index signature, exactly what a real
 * composite's own fields look like) doesn't satisfy `Record<string,
 * unknown>` as a generic constraint, caught by typecheck while writing this.
 */
export function useFormValidation<T extends object>(validators: Validators<T>) {
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof T, string>>>({});

  function validate(fields: T): boolean {
    const errors: Partial<Record<keyof T, string>> = {};
    for (const key in validators) {
      const validator = validators[key];
      const message = validator?.(fields[key]);
      if (message) errors[key] = message;
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function clearFieldError(key: keyof T) {
    setFieldErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  return { fieldErrors, validate, clearFieldError, reset: () => setFieldErrors({}) };
}
