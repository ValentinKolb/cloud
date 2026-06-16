import { markdown } from "@valentinkolb/cloud/shared";
import { MarkdownView, ProgressBar } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { For, type JSX, Show } from "solid-js";
import { type FormatSpec, FormatSpecSchema } from "../../../contracts";
import { effectiveDisplayField } from "../../../lookup-display";
import type { Field, GridRecord } from "../../../service";
import { BarcodeDisplay, barcodeValueText, canRenderBarcode } from "./BarcodeCell";
import { formatCell, progressRatio } from "./format-cell";
import { RecordLink } from "./RecordLink";
import { SelectValueBadges } from "./select-badges";

type FieldValueMode = "table" | "card" | "detail";

export type FieldValueProps = {
  field: Field;
  value: unknown;
  record?: GridRecord;
  allFields?: Field[];
  baseId?: string;
  tableShortIds?: Record<string, string>;
  fieldsByTable?: Record<string, Field[]>;
  relationLabels?: Record<string, string>;
  dateConfig?: DateContext;
  format?: FormatSpec;
  mode?: FieldValueMode;
  empty?: JSX.Element | string;
  markdownClass?: string;
  linkLookup?: boolean;
  relationValueMode?: "ids" | "labels";
  showBarcodeOpenAction?: boolean;
};

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

const defaultEmpty = (field: Field, mode: FieldValueMode): JSX.Element | string => {
  if (mode === "table" && field.type !== "lookup") return "";
  return "—";
};

const relationLabel = (id: string, props: Pick<FieldValueProps, "record" | "relationLabels">): string =>
  props.relationLabels?.[id] ?? expandedRecordLabel(props.record?.expanded?.[id]);

const lookupTarget = (props: FieldValueProps): { relationField: Field; targetId: string; targetTableId?: string } | null => {
  if (!props.record || !props.allFields) return null;
  const relationFieldId = (props.field.config as { relationFieldId?: string }).relationFieldId;
  const relationField = relationFieldId
    ? props.allFields.find((field) => field.id === relationFieldId && field.type === "relation" && !field.deletedAt)
    : undefined;
  if (!relationField) return null;
  const linked = props.record.data[relationField.id];
  const targetId = relationIds(linked)[0];
  if (!targetId) return null;
  return { relationField, targetId, targetTableId: (relationField.config as { targetTableId?: string }).targetTableId };
};

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

function RelationValue(props: FieldValueProps & { ids: string[]; emptyValue: JSX.Element | string }) {
  const targetTableId = () => (props.field.config as { targetTableId?: string }).targetTableId;
  return (
    <Show when={props.ids.length > 0} fallback={props.emptyValue}>
      <span class="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <For each={props.ids}>
          {(id, index) => (
            <RecordLink
              label={relationLabel(id, props)}
              targetTableId={targetTableId()}
              targetTableShortId={targetTableId() ? props.tableShortIds?.[targetTableId()!] : undefined}
              targetRecordId={id}
              baseId={props.baseId}
              comma={index() < props.ids.length - 1}
            />
          )}
        </For>
      </span>
    </Show>
  );
}

function RelationLabelValue(props: FieldValueProps & { emptyValue: JSX.Element | string }) {
  const text = () => valueToLabelPart(props.value);
  return (
    <Show when={text()} fallback={props.emptyValue}>
      {(label) => <span>{label()}</span>}
    </Show>
  );
}

function ProgressValue(props: FieldValueProps & { format: Extract<FormatSpec, { kind: "progress" }> }) {
  const ratio = () => progressRatio(props.value, props.field.type, props.field.config);
  const percent = () => Math.round(ratio() * 100);
  const label = () =>
    props.format.label === "none"
      ? ""
      : props.format.label === "value"
        ? formatCell(props.value, props.field.type, props.field.config, undefined, props.dateConfig)
        : `${percent()}%`;
  return (
    <span class="flex min-w-36 items-center gap-3">
      <ProgressBar value={percent()} size="sm" class="w-32 shrink-0" />
      <Show when={label()}>{(text) => <span class="whitespace-nowrap tabular-nums text-primary">{text()}</span>}</Show>
    </span>
  );
}

export function FieldValue(props: FieldValueProps) {
  const mode = () => props.mode ?? "table";
  const emptyValue = () => props.empty ?? defaultEmpty(props.field, mode());
  const displayField = () => (props.field.type === "lookup" ? effectiveDisplayField(props.field, props.fieldsByTable) : props.field);
  const format = () => fieldDisplayFormat(props.field, props.format);
  const isEmpty = () => props.value === null || props.value === undefined || props.value === "";

  const renderRawValue = () => {
    const fmt = format();
    const field = displayField();
    if (isEmpty()) return emptyValue();
    if (props.field.type === "relation") {
      return props.relationValueMode === "labels" ? (
        <RelationLabelValue {...props} emptyValue={emptyValue()} />
      ) : (
        <RelationValue {...props} ids={relationIds(props.value)} emptyValue={emptyValue()} />
      );
    }
    if (field.type === "select")
      return <SelectValueBadges value={props.value} type={field.type} fieldConfig={field.config} empty={emptyValue()} />;
    if (isMarkdownLongtext(field)) {
      return typeof props.value === "string" && props.value.trim() ? (
        <MarkdownView html={markdown.render(props.value)} smallHeadings class={props.markdownClass ?? "text-sm"} />
      ) : (
        emptyValue()
      );
    }
    if (fmt?.kind === "barcode" && canRenderBarcode(field.type)) {
      return (
        <BarcodeDisplay
          value={props.value}
          format={fmt}
          size={mode() === "detail" ? "detail" : "table"}
          showOpenAction={props.showBarcodeOpenAction}
        />
      );
    }
    if (fmt?.kind === "progress" && (field.type === "percent" || field.type === "formula")) {
      return <ProgressValue {...props} field={field} format={fmt} />;
    }
    return formatCell(props.value, field.type, field.config, fmt, props.dateConfig) || emptyValue();
  };

  const renderLookup = () => {
    const value = renderRawValue();
    if (!props.linkLookup || props.field.type !== "lookup" || format()?.kind === "barcode" || isEmpty()) return value;
    const target = lookupTarget(props);
    if (!target?.targetTableId || !props.baseId) return value;
    if (typeof value === "string") {
      return (
        <RecordLink
          label={value}
          targetTableId={target.targetTableId}
          targetTableShortId={props.tableShortIds?.[target.targetTableId]}
          targetRecordId={target.targetId}
          baseId={props.baseId}
        />
      );
    }
    return (
      <a
        href={`/app/grids/${props.baseId}/table/${props.tableShortIds?.[target.targetTableId] ?? target.targetTableId}?record=${target.targetId}`}
        class="inline-flex items-baseline gap-1 hover:underline"
        onClick={(event) => event.stopPropagation()}
        title="Open this record in the linked table"
      >
        <i class="ti ti-arrow-up-right text-[10px] text-dimmed self-center" />
        <span>{value}</span>
      </a>
    );
  };

  return <>{props.field.type === "lookup" ? renderLookup() : renderRawValue()}</>;
}
