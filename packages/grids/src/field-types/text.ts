import { z } from "zod";
import { fail, ok, type FieldTypeHandler } from "./types";

const TextConfigSchema = z.object({
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(1).optional(),
  regex: z.string().optional(),
  multiline: z.boolean().optional(),
});

const validateText = (raw: unknown, configRaw: unknown, required: boolean) => {
  const parsed = TextConfigSchema.safeParse(configRaw ?? {});
  if (!parsed.success) return fail("invalid field config");
  const config = parsed.data;

  if (raw === null || raw === undefined) {
    return required ? fail("required") : ok(null);
  }
  if (typeof raw !== "string") return fail("must be a string");

  // Trimming applies to single-line text only; longtext preserves whitespace.
  const value = config.multiline ? raw : raw.trim();

  if (value.length === 0) return required ? fail("required") : ok(null);

  if (config.minLength !== undefined && value.length < config.minLength) {
    return fail(`min length ${config.minLength}`);
  }
  if (config.maxLength !== undefined && value.length > config.maxLength) {
    return fail(`max length ${config.maxLength}`);
  }
  if (config.regex !== undefined) {
    let re: RegExp;
    try {
      re = new RegExp(config.regex);
    } catch {
      return fail("invalid regex in field config");
    }
    if (!re.test(value)) return fail("regex mismatch");
  }
  return ok(value);
};

export const textHandler: FieldTypeHandler = {
  type: "text",
  configSchema: TextConfigSchema,
  userInput: true,
  validate: validateText,
};

export const longtextHandler: FieldTypeHandler = {
  type: "longtext",
  configSchema: TextConfigSchema,
  userInput: true,
  validate: (raw, configRaw, required) => {
    const parsed = TextConfigSchema.safeParse(configRaw ?? {});
    if (!parsed.success) return fail("invalid field config");
    return validateText(raw, { ...parsed.data, multiline: true }, required);
  },
};
