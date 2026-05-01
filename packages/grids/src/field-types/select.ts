import { z } from "zod";
import { fail, ok, type FieldTypeHandler } from "./types";

const SelectOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  color: z.string().optional(),
});

const SingleSelectConfigSchema = z.object({
  options: z.array(SelectOptionSchema),
});

const MultiSelectConfigSchema = z.object({
  options: z.array(SelectOptionSchema),
  minSelected: z.number().int().min(0).optional(),
  maxSelected: z.number().int().min(1).optional(),
});

export const singleSelectHandler: FieldTypeHandler = {
  type: "single-select",
  configSchema: SingleSelectConfigSchema,
  userInput: true,
  validate(raw, configRaw, required) {
    const parsed = SingleSelectConfigSchema.safeParse(configRaw ?? {});
    if (!parsed.success) return fail("invalid field config");
    const ids = new Set(parsed.data.options.map((o) => o.id));

    if (raw === null || raw === undefined || raw === "") {
      return required ? fail("required") : ok(null);
    }
    if (typeof raw !== "string") return fail("must be an option id");
    if (!ids.has(raw)) return fail(`unknown option "${raw}"`);
    return ok(raw);
  },
};

export const multiSelectHandler: FieldTypeHandler = {
  type: "multi-select",
  configSchema: MultiSelectConfigSchema,
  userInput: true,
  validate(raw, configRaw, required) {
    const parsed = MultiSelectConfigSchema.safeParse(configRaw ?? {});
    if (!parsed.success) return fail("invalid field config");
    const config = parsed.data;
    const ids = new Set(config.options.map((o) => o.id));

    if (raw === null || raw === undefined) {
      return required ? fail("required") : ok(null);
    }
    if (!Array.isArray(raw)) return fail("must be an array of option ids");

    const seen = new Set<string>();
    for (const item of raw) {
      if (typeof item !== "string") return fail("each entry must be an option id");
      if (!ids.has(item)) return fail(`unknown option "${item}"`);
      seen.add(item);
    }
    const deduped = Array.from(seen);

    if (deduped.length === 0) return required ? fail("required") : ok(null);
    if (config.minSelected !== undefined && deduped.length < config.minSelected) {
      return fail(`min ${config.minSelected} selected`);
    }
    if (config.maxSelected !== undefined && deduped.length > config.maxSelected) {
      return fail(`max ${config.maxSelected} selected`);
    }
    return ok(deduped);
  },
};
