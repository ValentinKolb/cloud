import { formulaError, isFormulaError, type Literal } from "./types";

/** Return value from any function — either a literal, an error sentinel,
 *  or null. */
export type FnReturn = Literal | ReturnType<typeof formulaError>;

const isNullish = (v: unknown): boolean => v === null || v === undefined;

const num = (v: unknown): number | null => {
  if (isNullish(v)) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
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

const parseDateLike = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ─────────────────────────────────────────────────────────────────
// Function library — one entry per supported call. Each fn receives
// already-evaluated arguments (any nested formula errors propagate).
// ─────────────────────────────────────────────────────────────────

type FnImpl = (args: unknown[]) => FnReturn;

export const FN_LIBRARY: Record<string, FnImpl> = {
  // ── Math ────────────────────────────────────────────────────────
  ABS: ([v]) => {
    const n = num(v);
    return n === null ? null : Math.abs(n);
  },
  ROUND: ([v, places]) => {
    const n = num(v);
    if (n === null) return null;
    const p = num(places) ?? 0;
    const m = 10 ** p;
    return Math.round(n * m) / m;
  },
  FLOOR: ([v]) => {
    const n = num(v);
    return n === null ? null : Math.floor(n);
  },
  CEIL: ([v]) => {
    const n = num(v);
    return n === null ? null : Math.ceil(n);
  },
  MIN: (args) => {
    const ns = args.map(num).filter((n): n is number => n !== null);
    return ns.length === 0 ? null : Math.min(...ns);
  },
  MAX: (args) => {
    const ns = args.map(num).filter((n): n is number => n !== null);
    return ns.length === 0 ? null : Math.max(...ns);
  },

  // ── Text ────────────────────────────────────────────────────────
  CONCAT: (args) => args.map(str).join(""),
  LEN: ([v]) => str(v).length,
  LOWER: ([v]) => str(v).toLowerCase(),
  UPPER: ([v]) => str(v).toUpperCase(),
  TRIM: ([v]) => str(v).trim(),

  // ── Logic ───────────────────────────────────────────────────────
  IF: ([cond, then, otherwise]) => (bool(cond) ? (then as Literal) : (otherwise as Literal)),
  AND: (args) => args.every(bool),
  OR: (args) => args.some(bool),
  NOT: ([v]) => !bool(v),
  ISBLANK: ([v]) => isNullish(v) || v === "",

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
