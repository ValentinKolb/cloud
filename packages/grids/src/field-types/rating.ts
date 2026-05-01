import { z } from "zod";
import { fail, ok, type FieldTypeHandler } from "./types";

const RatingConfigSchema = z.object({
  scale: z.number().int().min(2).max(10).default(5),
});

export const ratingHandler: FieldTypeHandler = {
  type: "rating",
  configSchema: RatingConfigSchema,
  userInput: true,
  validate(raw, configRaw, required) {
    const parsed = RatingConfigSchema.safeParse(configRaw ?? {});
    if (!parsed.success) return fail("invalid field config");
    const max = parsed.data.scale;

    if (raw === null || raw === undefined || raw === "") {
      return required ? fail("required") : ok(null);
    }
    const n = typeof raw === "string" ? Number(raw.trim()) : (raw as number);
    if (!Number.isInteger(n)) return fail("must be an integer");
    if (n < 0 || n > max) return fail(`must be between 0 and ${max}`);
    if (n === 0) return required ? fail("required") : ok(null);
    return ok(n);
  },
};
