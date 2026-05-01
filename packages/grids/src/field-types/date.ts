import { z } from "zod";
import { fail, ok, type FieldTypeHandler } from "./types";

const DateConfigSchema = z.object({
  includeTime: z.boolean().optional(),
  min: z.string().optional(),
  max: z.string().optional(),
});

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const parseAndCanonicalize = (raw: string, includeTime: boolean): string | null => {
  if (includeTime) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  // Date-only: accept "YYYY-MM-DD" if it round-trips through Date, else
  // fall back to full ISO parsing + truncation. The round-trip catches
  // syntactically-valid-but-impossible dates like "2026-13-99".
  if (DATE_ONLY_RE.test(raw)) {
    const d = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    if (d.toISOString().slice(0, 10) !== raw) return null;
    return raw;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

export const dateHandler: FieldTypeHandler = {
  type: "date",
  configSchema: DateConfigSchema,
  userInput: true,
  validate(raw, configRaw, required) {
    const parsed = DateConfigSchema.safeParse(configRaw ?? {});
    if (!parsed.success) return fail("invalid field config");
    const config = parsed.data;

    if (raw === null || raw === undefined || raw === "") {
      return required ? fail("required") : ok(null);
    }
    if (typeof raw !== "string") return fail("must be an ISO 8601 string");

    const canonical = parseAndCanonicalize(raw, config.includeTime ?? false);
    if (canonical === null) return fail("invalid date");

    if (config.min !== undefined) {
      const cMin = parseAndCanonicalize(config.min, config.includeTime ?? false);
      if (cMin === null) return fail("invalid min in field config");
      if (canonical < cMin) return fail(`min ${config.min}`);
    }
    if (config.max !== undefined) {
      const cMax = parseAndCanonicalize(config.max, config.includeTime ?? false);
      if (cMax === null) return fail("invalid max in field config");
      if (canonical > cMax) return fail(`max ${config.max}`);
    }

    return ok(canonical);
  },
};
