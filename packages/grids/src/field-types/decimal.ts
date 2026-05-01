import { z } from "zod";
import Decimal from "decimal.js";
import { fail, ok, type FieldTypeHandler } from "./types";

const DecimalConfigSchema = z.object({
  precision: z.number().int().min(1).max(38),
  scale: z.number().int().min(0).max(20),
  min: z.string().optional(),
  max: z.string().optional(),
});

export const decimalHandler: FieldTypeHandler = {
  type: "decimal",
  configSchema: DecimalConfigSchema,
  userInput: true,
  validate(raw, configRaw, required) {
    const parsed = DecimalConfigSchema.safeParse(configRaw ?? {});
    if (!parsed.success) return fail("invalid field config (decimal needs precision + scale)");
    const config = parsed.data;
    if (config.scale > config.precision) return fail("scale must be <= precision");

    if (raw === null || raw === undefined || raw === "") {
      return required ? fail("required") : ok(null);
    }

    let dec: Decimal;
    try {
      // decimal.js accepts string OR number, but we always use string form
      // to avoid float drift. Numbers passed via API JSON come as JS doubles
      // so we stringify them on input — caller-side precision loss is the
      // only thing we can't catch.
      dec = new Decimal(typeof raw === "number" ? String(raw) : (raw as string));
    } catch {
      return fail("must be a decimal number");
    }

    if (!dec.isFinite()) return fail("must be a finite decimal");

    if (dec.decimalPlaces() > config.scale) {
      return fail(`max ${config.scale} decimal places`);
    }

    // Postgres NUMERIC(p,s) stores at most (p - s) digits before the decimal
    // point. `precision(true)` only counts significant digits, so 1000 reports
    // 4 — that fits in p=5 by the abstract count, but laid out with scale=2
    // it becomes "1000.00" which needs 6 total digits and would be rejected
    // by Postgres. Check the integer side explicitly. Zero is a special case:
    // `0` reports precision=1 but represents 0 integer digits.
    const integerDigits = dec.isZero() ? 0 : Math.max(0, dec.precision(true) - dec.decimalPlaces());
    const maxIntegerDigits = config.precision - config.scale;
    if (integerDigits > maxIntegerDigits) {
      return fail(`exceeds precision ${config.precision} (max ${maxIntegerDigits} integer digits)`);
    }

    if (config.min !== undefined) {
      try {
        if (dec.lt(new Decimal(config.min))) return fail(`min ${config.min}`);
      } catch {
        return fail("invalid min in field config");
      }
    }
    if (config.max !== undefined) {
      try {
        if (dec.gt(new Decimal(config.max))) return fail(`max ${config.max}`);
      } catch {
        return fail("invalid max in field config");
      }
    }

    return ok(dec.toFixed(config.scale));
  },
};
