import type { FormatSpec } from "../../service/views";

/**
 * Renders a single field value to its display string. Type-aware:
 *  - boolean → "Yes" / "No"
 *  - select   → option labels, not ids
 *  - decimal with unit → "<amount> <unit>" or "<unit> <amount>"
 *  - duration → HH:MM:SS
 *  - object   → JSON-stringify fallback
 *
 * `format` overrides take precedence for date / decimal / percent.
 * Mismatches (e.g. a date format on a text field) are silently
 * ignored — the renderer falls back to the type-default rendering.
 *
 * Relation values are NOT handled here — they need a label cache from
 * the SSR layer, see DatabaseTable / RecordDetailPanel.
 */
export const formatCell = (value: unknown, type: string, fieldConfig?: Record<string, unknown>, format?: FormatSpec): string => {
  if (value === null || value === undefined || value === "") return "";

  // ── Format-spec wins where types match ──────────────────────────
  if (format) {
    if (format.kind === "date" && (type === "date" || type === "formula") && typeof value === "string") {
      return formatDate(value, format);
    }
    if (format.kind === "decimal" && (type === "number" || type === "decimal" || type === "formula") && typeof value !== "object") {
      return formatDecimal(value as number | string, format);
    }
    if (format.kind === "percent" && (type === "percent" || type === "formula")) {
      return formatPercent(value, format);
    }
  }

  // ── Type-default rendering ──────────────────────────────────────
  if (type === "date" && typeof value === "string") {
    return fieldConfig?.includeTime ? value.replace("T", " ") : value.slice(0, 10);
  }
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "select" && Array.isArray(value)) {
    const options = (fieldConfig?.options as Array<{ id: string; label: string }> | undefined) ?? [];
    return value.map((id) => options.find((o) => o.id === id)?.label ?? String(id)).join(", ");
  }
  if (type === "decimal") {
    const unit = typeof fieldConfig?.unit === "string" ? (fieldConfig.unit as string) : "";
    const unitPosition = fieldConfig?.unitPosition === "prefix" ? "prefix" : "suffix";
    const amount =
      typeof value === "object" && value !== null && "amount" in value
        ? (value as { amount?: string | number }).amount
        : (value as string | number);
    return formatWithUnit(amount, unit, unitPosition);
  }
  if (type === "percent" && typeof value === "number") return `${value}%`;
  if (type === "duration" && typeof value === "number") {
    const h = Math.floor(value / 3600);
    const m = Math.floor((value % 3600) / 60);
    const s = value % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

// ─── format-spec implementations ─────────────────────────────────

const formatDate = (iso: string, spec: Extract<FormatSpec, { kind: "date" }>): string => {
  if (spec.format === "iso") {
    return spec.includeTime ? iso : iso.slice(0, 10);
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (spec.format === "relative") {
    const days = Math.round((Date.now() - d.getTime()) / 86_400_000);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days === -1) return "tomorrow";
    if (days > 0 && days < 30) return `${days}d ago`;
    if (days < 0 && days > -30) return `in ${-days}d`;
    return d.toLocaleDateString();
  }
  if (spec.format === "long") {
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
      ...(spec.includeTime && { hour: "2-digit", minute: "2-digit" }),
    });
  }
  // short — locale-aware
  return spec.includeTime ? d.toLocaleString() : d.toLocaleDateString();
};

const formatDecimal = (v: number | string, spec: Extract<FormatSpec, { kind: "decimal" }>): string => {
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return String(v);
  const fixed = spec.precision !== undefined ? n.toFixed(spec.precision) : String(n);
  if (!spec.thousandsSeparator) return fixed;
  const [int, dec] = fixed.split(".");
  return dec === undefined ? int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${dec}`;
};

const formatPercent = (value: unknown, spec: Extract<FormatSpec, { kind: "percent" }>): string => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return String(value);
  const fixed = spec.precision !== undefined ? n.toFixed(spec.precision) : String(n);
  return `${fixed}%`;
};

export const progressRatio = (value: unknown, type: string, fieldConfig?: Record<string, unknown>): number => {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  const n = Number.isFinite(raw) ? raw : 0;
  const ratio = type === "percent" && fieldConfig?.range !== "fraction" ? n / 100 : n;
  return Math.max(0, Math.min(1, ratio));
};

/**
 * Render a decimal amount with a free-text unit. The amount is the
 * stored decimal (`"12.34"` string or `12.34` number); the unit is
 * whatever the field admin typed in field config ("EUR", "kg", "%",
 * "credits", …) — purely display, no semantics.
 */
const formatWithUnit = (amount: string | number | null | undefined, unit: string, position: "prefix" | "suffix"): string => {
  if (amount === null || amount === undefined || amount === "") return "";
  const text = String(amount);
  if (!unit) return text;
  return position === "prefix" ? `${unit} ${text}` : `${text} ${unit}`;
};
