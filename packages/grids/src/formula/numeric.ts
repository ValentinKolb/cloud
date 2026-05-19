import Decimal from "decimal.js";

export const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;

export type DecimalValue = {
  decimal: Decimal;
  exact: boolean;
};

export const isNullish = (v: unknown): boolean => v === null || v === undefined;

export const isExactShaped = (v: unknown): boolean => {
  if (typeof v === "string") return NUMERIC_STRING.test(v);
  if (typeof v === "object" && v !== null && "amount" in v) return isExactShaped((v as { amount?: unknown }).amount);
  return false;
};

export const toNumber = (v: unknown): number | null => {
  if (isNullish(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object" && v !== null && "amount" in v) return toNumber((v as { amount?: unknown }).amount);
  return null;
};

export const toDecimalValue = (v: unknown): DecimalValue | null => {
  if (isNullish(v)) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return { decimal: new Decimal(String(v)), exact: false };
  }
  if (typeof v === "string") {
    if (!NUMERIC_STRING.test(v)) return null;
    try {
      const decimal = new Decimal(v);
      return decimal.isFinite() ? { decimal, exact: true } : null;
    } catch {
      return null;
    }
  }
  if (typeof v === "boolean") return { decimal: new Decimal(v ? 1 : 0), exact: false };
  if (typeof v === "object" && v !== null && "amount" in v) return toDecimalValue((v as { amount?: unknown }).amount);
  return null;
};

export const decimalToString = (d: Decimal): string => d.toFixed();

export const decimalResult = (d: Decimal, exact: boolean): string | number => (exact ? decimalToString(d) : d.toNumber());
