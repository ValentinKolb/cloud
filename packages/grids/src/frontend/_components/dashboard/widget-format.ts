import type { WidgetFormat } from "../../../service";

/**
 * Renders a stat-card / chart-axis number to the user-visible string.
 * Centralised here so the chart layer (P1) and the stat-card layer
 * agree on formatting — a `currency` chart axis and a `currency` stat
 * value should look identical.
 *
 * `null` / `undefined` → "—" (em-dash) so an empty cell is visually
 * distinct from a zero. Errors from the data layer surface with a
 * distinct caller-supplied label, not through this function.
 */
export const formatWidgetValue = (
  value: unknown,
  format: WidgetFormat | undefined,
): string => {
  if (value === null || value === undefined) return "—";

  // Coerce string-numerics (decimal cells store as strings to dodge
  // float drift) to JS numbers for Intl formatting. Genuine non-numeric
  // strings just pass through.
  const asNumber =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)
      ? Number(value)
      : null;

  if (asNumber === null) {
    // Non-numeric value — show as-is. This happens when the user puts
    // `MIN`/`MAX` over a text field, etc.
    return String(value);
  }

  switch (format) {
    case "currency":
      // EUR is the workspace default; we'd take currency from the field
      // config in P2 once we route that metadata through the widget
      // source. For now it's a sensible single-currency assumption.
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(asNumber);
    case "percent":
      // Source values are expected to be fractions (0.19 = 19%) — that
      // matches how the percent field type stores its data.
      return new Intl.NumberFormat(undefined, {
        style: "percent",
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      }).format(asNumber);
    case "integer":
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 0,
      }).format(Math.round(asNumber));
    default:
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 4,
      }).format(asNumber);
  }
};
