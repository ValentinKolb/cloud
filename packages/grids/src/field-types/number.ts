import { z } from "zod";
import { fail, ok, type FieldTypeHandler } from "./types";

const NumberConfigSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    integerOnly: z.boolean().optional(),
  })
  // min must not exceed max. Otherwise every value fails validation
  // and the field is permanently broken until the config is fixed.
  .superRefine((data, ctx) => {
    if (data.min !== undefined && data.max !== undefined && data.min > data.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "min cannot exceed max",
        path: ["min"],
      });
    }
  });

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

    let n: number;
    if (typeof raw === "number") {
      n = raw;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return required ? fail("required") : ok(null);
      n = Number(trimmed);
    } else {
      return fail("must be a number");
    }

    if (!Number.isFinite(n)) return fail("must be a finite number");
    if (config.integerOnly && !Number.isInteger(n)) return fail("must be an integer");
    if (config.min !== undefined && n < config.min) return fail(`min ${config.min}`);
    if (config.max !== undefined && n > config.max) return fail(`max ${config.max}`);

    return ok(n);
  },
};
