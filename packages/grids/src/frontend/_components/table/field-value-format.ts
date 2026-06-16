import type { DateContext } from "@valentinkolb/stdlib";
import { type FormatSpec, FormatSpecSchema } from "../../../contracts";
import { effectiveDisplayField } from "../../../lookup-display";
import type { Field, GridRecord } from "../../../service";
import { barcodeValueText, canRenderBarcode } from "./BarcodeRendering";
import { formatCell } from "./format-cell";

export const valueToLabelPart = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(valueToLabelPart).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.label === "string") return obj.label;
    if (typeof obj.amount === "string" || typeof obj.amount === "number") return String(obj.amount);
  }
  return "";
};

export const expandedRecordLabel = (expanded: Record<string, unknown> | undefined): string => {
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

export const isMarkdownLongtext = (field: Field): boolean =>
  field.type === "longtext" && Boolean((field.config as { markdown?: boolean }).markdown);

const relationLabel = (
  id: string,
  props: Pick<
    {
      record?: GridRecord;
      relationLabels?: Record<string, string>;
    },
    "record" | "relationLabels"
  >,
): string => props.relationLabels?.[id] ?? expandedRecordLabel(props.record?.expanded?.[id]);

export const formatFieldValueText = (props: {
  field: Field;
  value: unknown;
  record?: GridRecord;
  fieldsByTable?: Record<string, Field[]>;
  relationLabels?: Record<string, string>;
  dateConfig?: DateContext;
  format?: FormatSpec;
}): string => {
  const { field, value } = props;
  if (value === null || value === undefined || value === "") return "";
  if (field.type === "relation")
    return relationIds(value)
      .map((id) => relationLabel(id, props))
      .filter(Boolean)
      .join(", ");
  const displayField = field.type === "lookup" ? effectiveDisplayField(field, props.fieldsByTable) : field;
  const format = fieldDisplayFormat(field, props.format);
  if (format?.kind === "barcode" && canRenderBarcode(displayField.type)) return barcodeValueText(value);
  if (isMarkdownLongtext(displayField)) return valueToLabelPart(value);
  if (displayField.type === "select" && !Array.isArray(value))
    return formatCell([value], displayField.type, displayField.config, format, props.dateConfig);
  return formatCell(value, displayField.type, displayField.config, format, props.dateConfig);
};
