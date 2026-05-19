import { z } from "zod";
import { fail, ok, type FieldTypeHandler } from "./types";

const DateConfigSchema = z
  .object({
    includeTime: z.boolean().optional(),
    min: z.string().optional(),
    max: z.string().optional(),
  })
  // min must not exceed max. Pure string compare on ISO date strings
  // is order-correct (lexical = chronological for the date-only / full
  // ISO timestamp shapes we accept), so no parsing needed.
  .superRefine((data, ctx) => {
    if (data.min !== undefined && data.max !== undefined && data.min > data.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "min cannot exceed max",
        path: ["min"],
      });
    }
  });

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})/;
const LOCAL_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?$/;

const isValidDateOnly = (value: string): boolean => {
  if (!DATE_ONLY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

const normalizeLocalDateTime = (raw: string): string | null => {
  if (DATE_ONLY_RE.test(raw)) return isValidDateOnly(raw) ? `${raw}T00:00` : null;
  const match = LOCAL_DATETIME_RE.exec(raw);
  if (!match) return null;
  const [, date, hh, mm, ss, ms] = match;
  if (!date || !isValidDateOnly(date)) return null;
  const hour = Number(hh);
  const minute = Number(mm);
  const second = ss === undefined ? 0 : Number(ss);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  return `${date}T${hh}:${mm}${ss !== undefined ? `:${ss}${ms ?? ""}` : ""}`;
};

const parseAndCanonicalize = (raw: string, includeTime: boolean): string | null => {
  if (includeTime) {
    return normalizeLocalDateTime(raw);
  }
  // Date-only fields keep the calendar date the user supplied. If an
  // API caller sends a timestamp, use its leading YYYY-MM-DD date part
  // instead of converting through UTC and potentially shifting the day.
  const date = DATE_PREFIX_RE.exec(raw)?.[1];
  return date && isValidDateOnly(date) ? date : null;
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
