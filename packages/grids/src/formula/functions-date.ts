import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import { dates } from "@valentinkolb/stdlib";
import { type FormulaFunction, type FormulaRuntimeContext, formulaNumber } from "./function-runtime";
import { formulaError } from "./types";

const DATE_LIKE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:[zZ]|[+-]\d{2}:?\d{2})$/;

type FormulaDateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
type FormulaDateValue = { instant: Date; parts: FormulaDateParts; hasTime: boolean; instantBacked: boolean };

const formulaTimeZone = (context: FormulaRuntimeContext): string => normalizeTimeZone(context.dateConfig?.timeZone, "UTC");
const pad2 = (value: number): string => String(value).padStart(2, "0");
const dateFromParts = (parts: FormulaDateParts): Date =>
  new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));

const isValidParts = (parts: FormulaDateParts): boolean => {
  const date = dateFromParts(parts);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() + 1 === parts.month &&
    date.getUTCDate() === parts.day &&
    date.getUTCHours() === parts.hour &&
    date.getUTCMinutes() === parts.minute &&
    date.getUTCSeconds() === parts.second
  );
};

const partsInput = (parts: FormulaDateParts): string =>
  `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;

const localPartsForInstant = (date: Date, timeZone: string): FormulaDateParts | null => {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string): number => Number(formatted.find((item) => item.type === type)?.value);
  const parts = {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
  return isValidParts(parts) ? parts : null;
};

const parseDateLike = (value: unknown, context: FormulaRuntimeContext): FormulaDateValue | null => {
  const timeZone = formulaTimeZone(context);
  if (value instanceof Date) {
    const parts = localPartsForInstant(value, timeZone);
    return parts ? { instant: value, parts, hasTime: true, instantBacked: true } : null;
  }
  if (typeof value !== "string") return null;
  if (INSTANT_RE.test(value)) {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return null;
    const parts = localPartsForInstant(instant, timeZone);
    return parts ? { instant, parts, hasTime: true, instantBacked: true } : null;
  }
  const local = DATE_LIKE_RE.exec(value);
  if (!local) return null;
  const [, year, month, day, hour = "00", minute = "00", second = "00"] = local;
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
  if (!isValidParts(parts)) return null;
  const hasTime = value.includes("T");
  const instant = hasTime
    ? new Date(dates.zonedDateTimeToInstant(partsInput(parts), timeZone, { disambiguation: "compatible" }))
    : dateFromParts(parts);
  return { instant, parts, hasTime, instantBacked: hasTime };
};

const dateKey = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const DATE_FORMULA_FUNCTIONS: Record<string, FormulaFunction> = {
  TODAY: (_args, context) => dates.formatDateKey(context.now ?? new Date(), { ...context.dateConfig, timeZone: formulaTimeZone(context) }),
  NOW: (_args, context) => (context.now ?? new Date()).toISOString(),
  YEAR: ([value], context) => parseDateLike(value, context)?.parts.year ?? null,
  MONTH: ([value], context) => parseDateLike(value, context)?.parts.month ?? null,
  DAY: ([value], context) => parseDateLike(value, context)?.parts.day ?? null,
  DATEADD: ([dateArg, count, unit], context) => {
    const date = parseDateLike(dateArg, context);
    const amount = formulaNumber(count);
    if (date === null || amount === null) return null;
    const normalizedUnit = String(unit ?? "days").toLowerCase();
    const next = dateFromParts(date.parts);
    if (normalizedUnit === "days" || normalizedUnit === "day") next.setUTCDate(next.getUTCDate() + amount);
    else if (normalizedUnit === "months" || normalizedUnit === "month") next.setUTCMonth(next.getUTCMonth() + amount);
    else if (normalizedUnit === "years" || normalizedUnit === "year") next.setUTCFullYear(next.getUTCFullYear() + amount);
    else if (normalizedUnit === "hours" || normalizedUnit === "hour") next.setUTCHours(next.getUTCHours() + amount);
    else if (normalizedUnit === "minutes" || normalizedUnit === "minute") next.setUTCMinutes(next.getUTCMinutes() + amount);
    else return formulaError("DATEADD_BAD_UNIT");

    const parts = {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
      hour: next.getUTCHours(),
      minute: next.getUTCMinutes(),
      second: next.getUTCSeconds(),
    };
    const timeUnit = normalizedUnit === "hours" || normalizedUnit === "hour" || normalizedUnit === "minutes" || normalizedUnit === "minute";
    if (!date.instantBacked && !date.hasTime && !timeUnit) return dateKey(next);
    return dates.zonedDateTimeToInstant(partsInput(parts), formulaTimeZone(context), { disambiguation: "compatible" });
  },
  DATEDIFF: ([from, to, unit], context) => {
    const left = parseDateLike(from, context);
    const right = parseDateLike(to, context);
    if (left === null || right === null) return null;
    const normalizedUnit = String(unit ?? "days").toLowerCase();
    if (normalizedUnit === "days" || normalizedUnit === "day") {
      const leftDay = Date.UTC(left.parts.year, left.parts.month - 1, left.parts.day);
      const rightDay = Date.UTC(right.parts.year, right.parts.month - 1, right.parts.day);
      return Math.floor((rightDay - leftDay) / (1000 * 60 * 60 * 24));
    }
    const milliseconds = right.instant.getTime() - left.instant.getTime();
    if (normalizedUnit === "hours" || normalizedUnit === "hour") return Math.floor(milliseconds / (1000 * 60 * 60));
    if (normalizedUnit === "minutes" || normalizedUnit === "minute") return Math.floor(milliseconds / (1000 * 60));
    if (normalizedUnit === "seconds" || normalizedUnit === "second") return Math.floor(milliseconds / 1000);
    return formulaError("DATEDIFF_BAD_UNIT");
  },
};
