import { markdown } from "@valentinkolb/cloud/shared";
import { MarkdownView, ProgressBar } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { createMemo, For, type JSX, Show } from "solid-js";
import type { FormatSpec } from "../../../contracts";
import type { Field, GridRecord } from "../../../service";
import { BarcodeDisplay } from "./BarcodeCell";
import { type FieldDisplayIntent, type RelationDisplayItem, relationIds, resolveFieldDisplay } from "./field-display";
import { RecordLink } from "./RecordLink";
import { SelectValueBadges } from "./select-badges";

type FieldValueMode = "table" | "card" | "detail";

type FieldValueProps = {
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

const defaultEmpty = (field: Field, mode: FieldValueMode): JSX.Element | string => {
  if (mode === "table" && field.type !== "lookup") return "";
  return "—";
};

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

function RelationValue(
  props: FieldValueProps & { items: RelationDisplayItem[]; targetTableId?: string; emptyValue: JSX.Element | string },
) {
  return (
    <Show when={props.items.length > 0} fallback={props.emptyValue}>
      <span class="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <For each={props.items}>
          {(item, index) =>
            item.linkable ? (
              <RecordLink
                label={item.label}
                targetTableId={props.targetTableId}
                targetTableShortId={props.targetTableId ? props.tableShortIds?.[props.targetTableId] : undefined}
                targetRecordId={item.id}
                baseId={props.baseId}
                comma={index() < props.items.length - 1}
              />
            ) : (
              <span>{item.label}</span>
            )
          }
        </For>
      </span>
    </Show>
  );
}

function ProgressValue(props: { intent: Extract<FieldDisplayIntent, { kind: "progress" }> }) {
  const percent = () => Math.round(props.intent.ratio * 100);
  return (
    <span class="flex min-w-36 items-center gap-3">
      <ProgressBar value={percent()} size="sm" class="w-32 shrink-0" />
      <Show when={props.intent.label}>{(text) => <span class="whitespace-nowrap tabular-nums text-primary">{text()}</span>}</Show>
    </span>
  );
}

export function FieldValue(props: FieldValueProps) {
  const mode = () => props.mode ?? "table";
  const emptyValue = () => props.empty ?? defaultEmpty(props.field, mode());
  const display = createMemo(() =>
    resolveFieldDisplay({
      field: props.field,
      value: props.value,
      record: props.record,
      fieldsByTable: props.fieldsByTable,
      relationLabels: props.relationLabels,
      dateConfig: props.dateConfig,
      format: props.format,
      relationValueMode: props.relationValueMode,
    }),
  );

  const renderRawValue = () => {
    const intent = display();
    if (intent.kind === "empty") return emptyValue();
    if (intent.kind === "relation") {
      return <RelationValue {...props} items={intent.items} targetTableId={intent.targetTableId} emptyValue={emptyValue()} />;
    }
    if (intent.kind === "select") return <SelectValueBadges items={intent.items} empty={emptyValue()} />;
    if (intent.kind === "markdown") {
      return intent.text.trim() ? (
        <MarkdownView html={markdown.render(intent.text)} smallHeadings class={props.markdownClass ?? "text-sm"} />
      ) : (
        emptyValue()
      );
    }
    if (intent.kind === "barcode") {
      return (
        <BarcodeDisplay
          value={intent.value}
          format={intent.format}
          size={mode() === "detail" ? "detail" : "table"}
          showOpenAction={props.showBarcodeOpenAction}
        />
      );
    }
    if (intent.kind === "progress") return <ProgressValue intent={intent} />;
    return intent.text || emptyValue();
  };

  const renderLookup = () => {
    const value = renderRawValue();
    const intent = display();
    if (!props.linkLookup || props.field.type !== "lookup" || intent.kind === "barcode" || intent.kind === "empty") return value;
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
