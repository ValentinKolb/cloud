import type { DateContext } from "@valentinkolb/stdlib";
import type { AggregationSpec, GroupBySpec } from "../../../contracts";
import type { Field } from "../../../service";
import { formatFieldValueText } from "./field-value-format";
import { formatCell } from "./format-cell";

const groupFieldForDisplay = (field: Field, spec: GroupBySpec): Field =>
  spec.granularity ? { ...field, config: { ...field.config, includeTime: false } } : field;

export const formatGroupValue = (options: {
  value: unknown;
  spec: GroupBySpec;
  field?: Field;
  relationLabels?: Record<string, string>;
  dateConfig?: DateContext;
}): string => {
  if (!options.field) return options.value == null ? "Unknown" : String(options.value);
  if (options.value === null || options.value === undefined) return "—";
  return (
    formatFieldValueText({
      field: groupFieldForDisplay(options.field, options.spec),
      value: options.value,
      format: options.spec.format,
      relationLabels: options.relationLabels,
      dateConfig: options.dateConfig,
    }) || String(options.value)
  );
};

export const formatAggregationValue = (options: {
  value: unknown;
  spec: AggregationSpec;
  field?: Field;
  dateConfig?: DateContext;
}): string => {
  const { value, spec } = options;
  if (value === null || value === undefined) return "—";
  if (spec.format) {
    if (options.field) {
      return formatFieldValueText({ field: options.field, value, format: spec.format, dateConfig: options.dateConfig }) || String(value);
    }
    return formatCell(value, "number", {}, spec.format, options.dateConfig) || String(value);
  }
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
};
