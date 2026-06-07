import type { Field } from "../../../service";

export const FIELD_TYPE_ICONS: Record<string, string> = {
  text: "ti ti-typography",
  longtext: "ti ti-align-left",
  number: "ti ti-number",
  decimal: "ti ti-decimal",
  boolean: "ti ti-checkbox",
  date: "ti ti-calendar",
  select: "ti ti-tags",
  id: "ti ti-id",
  percent: "ti ti-percentage",
  duration: "ti ti-clock-hour-4",
  json: "ti ti-braces",
  file: "ti ti-paperclip",
  relation: "ti ti-link",
  lookup: "ti ti-corner-down-right",
  rollup: "ti ti-math-function",
  formula: "ti ti-calculator",
  created_at: "ti ti-clock-plus",
  updated_at: "ti ti-clock-edit",
  created_by: "ti ti-user-plus",
  updated_by: "ti ti-user-edit",
};

export const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Text",
  longtext: "Long text",
  number: "Number",
  decimal: "Decimal",
  boolean: "Boolean",
  date: "Date",
  select: "Select",
  id: "ID",
  percent: "Percent",
  duration: "Duration",
  json: "JSON",
  file: "File",
  relation: "Relation",
  lookup: "Lookup",
  rollup: "Rollup",
  formula: "Formula",
  created_at: "Created at",
  updated_at: "Updated at",
  created_by: "Created by",
  updated_by: "Updated by",
};

export const fieldTypeLabel = (type: string): string => FIELD_TYPE_LABELS[type] ?? type;

export const fieldTypeIcon = (type: string, customIcon?: string | null): string => customIcon || FIELD_TYPE_ICONS[type] || "ti ti-columns";

export const fieldOption = (field: Field, description = "Column") => ({
  id: field.id,
  label: field.name,
  description: `${description} · ${fieldTypeLabel(field.type)}`,
  icon: fieldTypeIcon(field.type, field.icon),
});
