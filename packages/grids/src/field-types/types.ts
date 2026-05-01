import type { z } from "zod";

export type ValidateResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): ValidateResult<T> => ({ ok: true, value });
export const fail = (error: string): ValidateResult<never> => ({ ok: false, error });

export type FieldTypeHandler = {
  type: string;
  /** Zod schema for the field's config blob (what's saved in fields.config). */
  configSchema: z.ZodTypeAny;
  /** Whether users can submit values via API/forms. False for system fields and autonumber. */
  userInput: boolean;
  /**
   * Validate + normalize a raw API value to its canonical JSONB form.
   * `null` / `undefined` / empty strings collapse to `null` unless `required`.
   */
  validate(raw: unknown, config: unknown, required: boolean): ValidateResult<unknown>;
};
