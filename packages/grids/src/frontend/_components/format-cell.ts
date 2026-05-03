import type { FormatSpec } from "../../service/views";

/**
 * Renders a single field value to its display string. Type-aware:
 *  - boolean → "Yes" / "No"
 *  - select   → option label, not id
 *  - currency → "<amount> <code>"
 *  - duration → HH:MM:SS
 *  - location → label or "lat, lng"
 *  - signature→ ✍ placeholder
 *  - object   → JSON-stringify fallback
 *
 * `format` overrides take precedence for date / decimal / currency /
 * percent. Mismatches (e.g. a date format on a text field) are silently
 * ignored — the renderer falls back to the type-default rendering.
 *
 * Relation values are NOT handled here — they need a label cache from
 * the SSR layer, see `formatRelationCell` in RecordsGrid /
 * RecordDetailPanel.
 */
export const formatCell = (
  value: unknown,
  type: string,
  fieldConfig?: Record<string, unknown>,
  format?: FormatSpec,
): string => {
  if (value === null || value === undefined || value === "") return "";

  // ── Format-spec wins where types match ──────────────────────────
  if (format) {
    if (format.kind === "date" && type === "date" && typeof value === "string") {
      return formatDate(value, format);
    }
    if (format.kind === "decimal" && (type === "number" || type === "decimal") && typeof value !== "object") {
      return formatDecimal(value as number | string, format);
    }
    if (format.kind === "percent" && type === "percent" && typeof value === "number") {
      return formatPercent(value, format);
    }
    if (format.kind === "currency" && type === "currency" && typeof value === "object") {
      return formatCurrency(value as { amount?: string; currency?: string }, format);
    }
  }

  // ── Type-default rendering ──────────────────────────────────────
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "multi-select" && Array.isArray(value)) {
    const options = (fieldConfig?.options as Array<{ id: string; label: string }> | undefined) ?? [];
    return value.map((id) => options.find((o) => o.id === id)?.label ?? String(id)).join(", ");
  }
  if (type === "single-select") {
    const options = (fieldConfig?.options as Array<{ id: string; label: string }> | undefined) ?? [];
    return options.find((o) => o.id === value)?.label ?? String(value);
  }
  if (type === "currency" && typeof value === "object") {
    const obj = value as { amount?: string; currency?: string };
    if (obj.amount !== undefined) return `${obj.amount} ${obj.currency ?? ""}`.trim();
  }
  if (type === "percent" && typeof value === "number") return `${value}%`;
  if (type === "duration" && typeof value === "number") {
    const h = Math.floor(value / 3600);
    const m = Math.floor((value % 3600) / 60);
    const s = value % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  if (type === "location" && typeof value === "object") {
    const obj = value as { lat?: number; lng?: number; label?: string };
    if (obj.label) return obj.label;
    if (obj.lat !== undefined && obj.lng !== undefined) return `${obj.lat}, ${obj.lng}`;
  }
  if (type === "signature" && typeof value === "string" && value.startsWith("data:image/")) {
    return "✍ signature";
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

// ─── format-spec implementations ─────────────────────────────────

const formatDate = (
  iso: string,
  spec: Extract<FormatSpec, { kind: "date" }>,
): string => {
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

const formatDecimal = (
  v: number | string,
  spec: Extract<FormatSpec, { kind: "decimal" }>,
): string => {
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return String(v);
  const fixed = spec.precision !== undefined ? n.toFixed(spec.precision) : String(n);
  if (!spec.thousandsSeparator) return fixed;
  const [int, dec] = fixed.split(".");
  return dec === undefined
    ? int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${dec}`;
};

const formatPercent = (
  n: number,
  spec: Extract<FormatSpec, { kind: "percent" }>,
): string => {
  const fixed = spec.precision !== undefined ? n.toFixed(spec.precision) : String(n);
  return `${fixed}%`;
};

const formatCurrency = (
  obj: { amount?: string; currency?: string },
  spec: Extract<FormatSpec, { kind: "currency" }>,
): string => {
  if (obj.amount === undefined) return "";
  const n = Number(obj.amount);
  const formatted =
    spec.precision !== undefined && Number.isFinite(n)
      ? n.toFixed(spec.precision)
      : obj.amount;
  const sym = spec.symbol ?? obj.currency ?? "";
  return sym ? `${formatted} ${sym}` : formatted;
};
