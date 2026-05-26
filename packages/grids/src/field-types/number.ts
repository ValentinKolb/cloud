import { z } from "zod";
import Decimal from "decimal.js";
import { fail, ok, type FieldTypeHandler } from "./types";

const NumberConfigSchema = z
  .object({
    min: z.union([z.string(), z.number()]).optional(),
    max: z.union([z.string(), z.number()]).optional(),
    precision: z.number().int().min(1).max(38).optional(),
    decimalPlaces: z.number().int().min(0).max(20).optional(),
    /** Legacy input accepted while alpha DBs still contain old decimal configs. */
    scale: z.number().int().min(0).max(20).optional(),
    integerOnly: z.boolean().optional(),
    unit: z.string().min(1).max(20).optional(),
    unitPosition: z.enum(["prefix", "suffix"]).optional(),
  })
  .superRefine((data, ctx) => {
    const places = data.integerOnly ? 0 : (data.decimalPlaces ?? data.scale);
    if (data.precision !== undefined && places !== undefined && places > data.precision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "decimal places cannot exceed precision",
        path: ["decimalPlaces"],
      });
    }

    const min = parseConfigDecimal(data.min);
    const max = parseConfigDecimal(data.max);
    if (data.min !== undefined && min === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "min must be a number", path: ["min"] });
    }
    if (data.max !== undefined && max === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "max must be a number", path: ["max"] });
    }
    if (min !== null && max !== null && min.gt(max)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "min cannot exceed max", path: ["min"] });
    }
  });

const parseConfigDecimal = (value: unknown): Decimal | null => {
  if (value === undefined || value === null || value === "") return null;
  try {
    const d = new Decimal(typeof value === "number" ? String(value) : String(value).trim());
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
};

const parseDecimal = (raw: unknown): Decimal | null => {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return new Decimal(String(raw));
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    try {
      const dec = new Decimal(trimmed);
      return dec.isFinite() ? dec : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && raw !== null && "amount" in raw) return parseDecimal((raw as { amount?: unknown }).amount);
  return null;
};

export const numberHandler: FieldTypeHandler = {
  type: "number",
  configSchema: NumberConfigSchema,
  userInput: true,
  validate(raw, configRaw, required) {
    const parsed = NumberConfigSchema.safeParse(configRaw ?? {});
    if (!parsed.success) return fail("invalid field config");
    const config = parsed.data;

    if (raw === null || raw === undefined || raw === "") {
      return required ? fail("required") : ok(null);
    }

    const dec = parseDecimal(raw);
    if (dec === null) return fail("must be a finite number");

    const places = config.integerOnly ? 0 : (config.decimalPlaces ?? config.scale);
    if (places !== undefined && dec.decimalPlaces() > places) {
      return places === 0 ? fail("must be an integer") : fail(`max ${places} decimal places`);
    }
    if (config.integerOnly && !dec.isInteger()) return fail("must be an integer");

    if (config.precision !== undefined) {
      const maxPlaces = places ?? dec.decimalPlaces();
      const integerDigits = dec.isZero() ? 0 : Math.max(0, dec.precision(true) - dec.decimalPlaces());
      const maxIntegerDigits = config.precision - maxPlaces;
      if (integerDigits > maxIntegerDigits) {
        return fail(`exceeds precision ${config.precision} (max ${maxIntegerDigits} integer digits)`);
      }
    }

    const min = parseConfigDecimal(config.min);
    if (min !== null && dec.lt(min)) return fail(`min ${config.min}`);
    const max = parseConfigDecimal(config.max);
    if (max !== null && dec.gt(max)) return fail(`max ${config.max}`);

    return ok(places !== undefined ? dec.toFixed(places) : dec.toFixed());
  },
};
