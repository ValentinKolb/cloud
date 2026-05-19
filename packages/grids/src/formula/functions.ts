import Decimal from "decimal.js";
import { decimalResult, isNullish, toDecimalValue, toNumber } from "./numeric";
import { formulaError, isFormulaError, type Literal } from "./types";

/** Return value from any function — either a literal, an error sentinel,
 *  or null. */
export type FnReturn = Literal | ReturnType<typeof formulaError>;

const num = (v: unknown): number | null => {
  return toNumber(v);
};

const str = (v: unknown): string => {
  if (isNullish(v)) return "";
  if (typeof v === "string") return v;
  return String(v);
};

const bool = (v: unknown): boolean => {
  if (isNullish(v)) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  return Boolean(v);
};

const ymd = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const LOCAL_DATE_LIKE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?$/;

const parseDateLike = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v !== "string") return null;
  const local = LOCAL_DATE_LIKE_RE.exec(v);
  if (local) {
    const [, y, m, d, hh = "00", mm = "00", ss = "00"] = local;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    const hour = Number(hh);
    const minute = Number(mm);
    const second = Number(ss);
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (Number.isNaN(date.getTime())) return null;
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() + 1 !== month ||
      date.getUTCDate() !== day ||
      date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute ||
      date.getUTCSeconds() !== second
    ) {
      return null;
    }
    return date;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ─────────────────────────────────────────────────────────────────
// Function library — one entry per supported call. Each fn receives
// already-evaluated arguments (any nested formula errors propagate).
// ─────────────────────────────────────────────────────────────────

type FnImpl = (args: unknown[]) => FnReturn;

const decimalArgs = (args: unknown[]) => {
  const values = args.map(toDecimalValue).filter((v): v is NonNullable<ReturnType<typeof toDecimalValue>> => v !== null);
  return {
    values,
    exact: values.some((v) => v.exact),
  };
};

const oneDecimal = (v: unknown): NonNullable<ReturnType<typeof toDecimalValue>> | null => toDecimalValue(v);

const numericResult = (value: Decimal, exact: boolean): FnReturn => decimalResult(value, exact);

const avgFn: FnImpl = (args) => {
  const { values, exact } = decimalArgs(args);
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc.plus(v.decimal), new Decimal(0));
  return numericResult(sum.div(values.length), exact);
};

export const FN_LIBRARY: Record<string, FnImpl> = {
  // ── Math ────────────────────────────────────────────────────────
  ABS: ([v]) => {
    const d = oneDecimal(v);
    return d === null ? null : numericResult(d.decimal.abs(), d.exact);
  },
  ROUND: ([v, places]) => {
    const d = oneDecimal(v);
    if (d === null) return null;
    const p = num(places) ?? 0;
    const placesInt = Math.trunc(p);
    if (placesInt < 0) {
      const factor = new Decimal(10).pow(Math.abs(placesInt));
      return numericResult(d.decimal.div(factor).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(factor), d.exact);
    }
    return numericResult(d.decimal.toDecimalPlaces(placesInt, Decimal.ROUND_HALF_UP), d.exact);
  },
  FLOOR: ([v]) => {
    const d = oneDecimal(v);
    return d === null ? null : numericResult(d.decimal.floor(), d.exact);
  },
  CEIL: ([v]) => {
    const d = oneDecimal(v);
    return d === null ? null : numericResult(d.decimal.ceil(), d.exact);
  },
  SQRT: ([v]) => {
    const d = oneDecimal(v);
    if (d === null) return null;
    if (d.decimal.isNegative()) return formulaError("NON_NUMERIC");
    return numericResult(d.decimal.sqrt(), d.exact);
  },
  POW: ([base, exp]) => {
    const b = oneDecimal(base);
    const e = oneDecimal(exp);
    if (b === null || e === null) return null;
    return numericResult(b.decimal.pow(e.decimal), b.exact || e.exact);
  },
  MOD: ([a, b]) => {
    const left = oneDecimal(a);
    const right = oneDecimal(b);
    if (left === null || right === null) return null;
    if (right.decimal.isZero()) return formulaError("DIV_ZERO");
    return numericResult(left.decimal.mod(right.decimal), left.exact || right.exact);
  },
  SUM: (args) => {
    const { values, exact } = decimalArgs(args);
    if (values.length === 0) return null;
    return numericResult(
      values.reduce((sum, v) => sum.plus(v.decimal), new Decimal(0)),
      exact,
    );
  },
  AVG: avgFn,
  MEAN: avgFn,
  COUNT: (args) => args.filter((v) => !isNullish(v) && v !== "").length,
  MEDIAN: (args) => {
    const { values, exact } = decimalArgs(args);
    if (values.length === 0) return null;
    const sorted = values.map((v) => v.decimal).sort((a, b) => a.comparedTo(b));
    const mid = Math.floor(sorted.length / 2);
    const value = sorted.length % 2 === 0 ? sorted[mid - 1]!.plus(sorted[mid]!).div(2) : sorted[mid]!;
    return numericResult(value, exact);
  },
  MIN: (args) => {
    const { values, exact } = decimalArgs(args);
    if (values.length === 0) return null;
    return numericResult(Decimal.min(...values.map((v) => v.decimal)), exact);
  },
  MAX: (args) => {
    const { values, exact } = decimalArgs(args);
    if (values.length === 0) return null;
    return numericResult(Decimal.max(...values.map((v) => v.decimal)), exact);
  },
  PERCENT: ([part, total]) => {
    const p = oneDecimal(part);
    const t = oneDecimal(total);
    if (p === null || t === null) return null;
    if (t.decimal.isZero()) return formulaError("DIV_ZERO");
    return numericResult(p.decimal.div(t.decimal).times(100), p.exact || t.exact);
  },

  // ── Text ────────────────────────────────────────────────────────
  CONCAT: (args) => args.map(str).join(""),
  LEN: ([v]) => str(v).length,
  LOWER: ([v]) => str(v).toLowerCase(),
  UPPER: ([v]) => str(v).toUpperCase(),
  TRIM: ([v]) => str(v).trim(),
  LEFT: ([v, count]) => str(v).slice(0, Math.max(0, Math.floor(num(count) ?? 0))),
  RIGHT: ([v, count]) => {
    const take = Math.max(0, Math.floor(num(count) ?? 0));
    return take === 0 ? "" : str(v).slice(-take);
  },
  SUBSTRING: ([v, start, length]) => {
    const s = str(v);
    const from = Math.max(0, Math.floor(num(start) ?? 0));
    const len = Math.max(0, Math.floor(num(length) ?? 0));
    return s.slice(from, from + len);
  },
  REPLACE: ([v, search, replacement]) => {
    const needle = str(search);
    if (needle.length === 0) return str(v);
    return str(v).replaceAll(needle, str(replacement));
  },

  // ── Logic ───────────────────────────────────────────────────────
  IF: ([cond, then, otherwise]) => (bool(cond) ? (then as Literal) : (otherwise as Literal)),
  IFEMPTY: ([value, fallback]) => (isNullish(value) || value === "" ? (fallback as Literal) : (value as Literal)),
  IFERROR: ([value]) => value as Literal,
  AND: (args) => args.every(bool),
  OR: (args) => args.some(bool),
  NOT: ([v]) => !bool(v),
  ISBLANK: ([v]) => isNullish(v) || v === "",
  CONTAINS: ([haystack, needle]) => str(haystack).includes(str(needle)),

  // ── Date ────────────────────────────────────────────────────────
  TODAY: () => ymd(new Date()),
  NOW: () => new Date().toISOString(),
  YEAR: ([v]) => {
    const d = parseDateLike(v);
    return d === null ? null : d.getUTCFullYear();
  },
  MONTH: ([v]) => {
    const d = parseDateLike(v);
    return d === null ? null : d.getUTCMonth() + 1;
  },
  DAY: ([v]) => {
    const d = parseDateLike(v);
    return d === null ? null : d.getUTCDate();
  },
  DATEADD: ([dateArg, count, unit]) => {
    const d = parseDateLike(dateArg);
    if (d === null) return null;
    const n = num(count);
    if (n === null) return null;
    const u = String(unit ?? "days").toLowerCase();
    const next = new Date(d.getTime());
    if (u === "days" || u === "day") next.setUTCDate(next.getUTCDate() + n);
    else if (u === "months" || u === "month") next.setUTCMonth(next.getUTCMonth() + n);
    else if (u === "years" || u === "year") next.setUTCFullYear(next.getUTCFullYear() + n);
    else if (u === "hours" || u === "hour") next.setUTCHours(next.getUTCHours() + n);
    else if (u === "minutes" || u === "minute") next.setUTCMinutes(next.getUTCMinutes() + n);
    else return formulaError("DATEADD_BAD_UNIT");
    return ymd(next);
  },
  DATEDIFF: ([from, to, unit]) => {
    const a = parseDateLike(from);
    const b = parseDateLike(to);
    if (a === null || b === null) return null;
    const ms = b.getTime() - a.getTime();
    const u = String(unit ?? "days").toLowerCase();
    if (u === "days" || u === "day") return Math.floor(ms / (1000 * 60 * 60 * 24));
    if (u === "hours" || u === "hour") return Math.floor(ms / (1000 * 60 * 60));
    if (u === "minutes" || u === "minute") return Math.floor(ms / (1000 * 60));
    if (u === "seconds" || u === "second") return Math.floor(ms / 1000);
    return formulaError("DATEDIFF_BAD_UNIT");
  },
};

export const knownFunction = (name: string): boolean => name.toUpperCase() in FN_LIBRARY;

export { isFormulaError };
