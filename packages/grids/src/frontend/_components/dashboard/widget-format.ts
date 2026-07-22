import type { DateContext } from "@valentinkolb/stdlib";
import Decimal from "decimal.js";
import type { WidgetValueFormat } from "../../../service";

const DashboardDecimal = Decimal.clone({ precision: 80 });
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const numericText = (value: unknown): string | null => {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return DECIMAL_TEXT.test(trimmed) ? trimmed : null;
};

const fractionDigits = (format: WidgetValueFormat | undefined): { minimumFractionDigits: number; maximumFractionDigits: number } => {
  if (format?.style === "integer") return { minimumFractionDigits: 0, maximumFractionDigits: 0 };
  if (format?.decimalPlaces !== undefined) {
    return { minimumFractionDigits: format.decimalPlaces, maximumFractionDigits: format.decimalPlaces };
  }
  return format?.style === "percent"
    ? { minimumFractionDigits: 0, maximumFractionDigits: 1 }
    : { minimumFractionDigits: 0, maximumFractionDigits: 4 };
};

const roundedInteger = (value: string): string => {
  const decimal = new DashboardDecimal(value);
  const rounded = decimal.toDecimalPlaces(0, Decimal.ROUND_HALF_CEIL);
  return rounded.isZero() && decimal.isNegative() ? "-0" : rounded.toFixed(0);
};

/**
 * Formats dashboard values without converting decimal strings to binary
 * floating-point numbers. Modern Intl implementations accept decimal strings
 * as exact mathematical values, even though older TypeScript libs only typed
 * this parameter as number or bigint.
 */
export const formatWidgetValue = (
  value: unknown,
  format: WidgetValueFormat | undefined,
  dateConfig?: Pick<DateContext, "locale">,
): string => {
  if (value === null || value === undefined) return "—";

  const raw = numericText(value);
  if (raw === null) return String(value);

  const style = format?.style ?? "number";
  const mathematicalValue = style === "integer" ? roundedInteger(raw) : raw;
  const formatted = new Intl.NumberFormat(dateConfig?.locale ?? "en", {
    ...(style === "percent" ? { style: "percent" as const } : {}),
    ...fractionDigits(format),
  }).format(mathematicalValue as `${number}`);

  if (!format?.unit) return formatted;
  return format.unitPosition === "prefix" ? `${format.unit} ${formatted}` : `${formatted} ${format.unit}`;
};
