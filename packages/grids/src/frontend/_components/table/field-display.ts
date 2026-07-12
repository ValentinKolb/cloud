import type { DateContext } from "@valentinkolb/stdlib";
import { type FormatSpec, FormatSpecSchema } from "../../../contracts";
import { effectiveDisplayField } from "../../../lookup-display";
import type { Field, GridRecord } from "../../../service";
import { barcodeValueText, canRenderBarcode } from "./BarcodeRendering";
import { formatCell, progressRatio } from "./format-cell";
import { type SelectBadgeItem, selectBadgeItems } from "./select-badge-utils";

export type RelationDisplayItem = { id: string; label: string; linkable: boolean };

export type FieldDisplayIntent =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "markdown"; text: string }
  | { kind: "select"; items: SelectBadgeItem[]; text: string }
  | { kind: "relation"; items: RelationDisplayItem[]; targetTableId?: string }
  | { kind: "barcode"; value: string; format: Extract<FormatSpec, { kind: "barcode" }> }
  | { kind: "progress"; ratio: number; label: string; text: string; format: Extract<FormatSpec, { kind: "progress" }> };

export type ResolveFieldDisplayOptions = {
  field: Field;
  value: unknown;
  record?: GridRecord;
  fieldsByTable?: Record<string, Field[]>;
  relationLabels?: Record<string, string>;
  dateConfig?: DateContext;
  format?: FormatSpec;
  relationValueMode?: "ids" | "labels";
};

const valueToLabelPart = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(valueToLabelPart).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object.label === "string") return object.label;
    if (typeof object.amount === "string" || typeof object.amount === "number") return String(object.amount);
  }
  return "";
};

const expandedRecordLabel = (expanded: Record<string, unknown> | undefined): string => {
  if (!expanded) return "Unknown record";
  const parts = Object.values(expanded).map(valueToLabelPart).filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Untitled record";
};

export const relationIds = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return typeof value === "string" && value.length > 0 ? [value] : [];
};

export const fieldDisplayFormat = (field: Field, override?: FormatSpec): FormatSpec | undefined => {
  if (override) return override;
  const parsed = FormatSpecSchema.safeParse((field.config as { format?: unknown }).format);
  return parsed.success ? parsed.data : undefined;
};

const isMarkdownLongtext = (field: Field): boolean =>
  field.type === "longtext" && Boolean((field.config as { markdown?: boolean }).markdown);

const relationLabel = (id: string, options: ResolveFieldDisplayOptions): string =>
  options.relationLabels?.[id] ?? expandedRecordLabel(options.record?.expanded?.[id]);

export const resolveFieldDisplay = (options: ResolveFieldDisplayOptions): FieldDisplayIntent => {
  const { field, value } = options;
  if (value === null || value === undefined || value === "") return { kind: "empty" };

  if (field.type === "relation") {
    if (options.relationValueMode === "labels") {
      const label = valueToLabelPart(value);
      return label ? { kind: "relation", items: [{ id: label, label, linkable: false }] } : { kind: "empty" };
    }
    return {
      kind: "relation",
      items: relationIds(value).map((id) => ({ id, label: relationLabel(id, options), linkable: true })),
      targetTableId: (field.config as { targetTableId?: string }).targetTableId,
    };
  }

  const displayField = field.type === "lookup" ? effectiveDisplayField(field, options.fieldsByTable) : field;
  const format = fieldDisplayFormat(field, options.format);

  if (displayField.type === "select") {
    return {
      kind: "select",
      items: selectBadgeItems(value, displayField.type, displayField.config),
      text: formatCell(Array.isArray(value) ? value : [value], displayField.type, displayField.config),
    };
  }
  if (isMarkdownLongtext(displayField)) return { kind: "markdown", text: valueToLabelPart(value) };
  if (format?.kind === "barcode" && canRenderBarcode(displayField.type)) {
    return { kind: "barcode", value: barcodeValueText(value), format };
  }
  if (format?.kind === "progress" && (displayField.type === "percent" || displayField.type === "formula")) {
    const ratio = progressRatio(value, displayField.type, displayField.config);
    const percent = Math.round(ratio * 100);
    const text = formatCell(value, displayField.type, displayField.config, undefined, options.dateConfig);
    const label = format.label === "none" ? "" : format.label === "value" ? text : `${percent}%`;
    return { kind: "progress", ratio, label, text, format };
  }
  return { kind: "text", text: formatCell(value, displayField.type, displayField.config, format, options.dateConfig) };
};

export const fieldDisplayText = (intent: FieldDisplayIntent): string => {
  if (intent.kind === "empty") return "";
  if (intent.kind === "relation")
    return intent.items
      .map((item) => item.label)
      .filter(Boolean)
      .join(", ");
  if (intent.kind === "select") return intent.text;
  if (intent.kind === "barcode") return intent.value;
  if (intent.kind === "progress") return intent.text;
  return intent.text;
};
