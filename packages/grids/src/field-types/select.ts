import { z } from "zod";
import { type FieldTypeHandler, fail, ok } from "./types";

const SelectOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  color: z.string().optional(),
  description: z.string().optional(),
});

export const SelectConfigSchema = z
  .object({
    multiple: z.boolean().default(false),
    options: z.array(SelectOptionSchema),
    minSelected: z.number().int().min(0).optional(),
    maxSelected: z.number().int().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.multiple && data.maxSelected !== undefined && data.maxSelected > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "single select cannot allow more than one value",
        path: ["maxSelected"],
      });
    }
    if (!data.multiple && data.minSelected !== undefined && data.minSelected > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "single select cannot require more than one value",
        path: ["minSelected"],
      });
    }
    if (data.minSelected !== undefined && data.maxSelected !== undefined && data.minSelected > data.maxSelected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "minSelected cannot exceed maxSelected",
        path: ["minSelected"],
      });
    }
    if (data.minSelected !== undefined && data.minSelected > data.options.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `minSelected (${data.minSelected}) exceeds number of options (${data.options.length})`,
        path: ["minSelected"],
      });
    }
  });

const normalizeIds = (raw: unknown): string[] | null | "invalid" => {
  if (raw === null || raw === undefined || raw === "") return null;
  if (!Array.isArray(raw)) return "invalid";
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") return "invalid";
    if (item.length > 0) seen.add(item);
  }
  return Array.from(seen);
};

export const selectHandler: FieldTypeHandler = {
  type: "select",
  configSchema: SelectConfigSchema,
  userInput: true,
  validate(raw, configRaw, required) {
    const parsed = SelectConfigSchema.safeParse(configRaw ?? {});
    if (!parsed.success) return fail("invalid field config");
    const config = parsed.data;
    const ids = new Set(config.options.map((o) => o.id));
    const normalized = normalizeIds(raw);

    if (normalized === null) return required ? fail("required") : ok(null);
    if (normalized === "invalid") return fail("must be an array of option ids");
    if (normalized.length === 0) return required ? fail("required") : ok(null);
    if (!config.multiple && normalized.length > 1) return fail("max 1 selected");

    for (const id of normalized) {
      if (!ids.has(id)) return fail(`unknown option "${id}"`);
    }
    if (config.minSelected !== undefined && normalized.length < config.minSelected) {
      return fail(`min ${config.minSelected} selected`);
    }
    if (config.maxSelected !== undefined && normalized.length > config.maxSelected) {
      return fail(`max ${config.maxSelected} selected`);
    }
    return ok(normalized);
  },
};
