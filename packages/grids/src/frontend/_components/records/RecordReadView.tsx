import { Placeholder } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { For, type JSX, Show } from "solid-js";
import type { ColumnSpec, FormatSpec } from "../../../contracts";
import { effectiveDisplayField } from "../../../lookup-display";
import type { Field, GridRecord } from "../../../service";
import { barcodeValueText, canRenderBarcode } from "../table/BarcodeRendering";
import { FieldValue } from "../table/FieldValue";
import { fieldDisplayFormat, formatFieldValueText } from "../table/field-value-format";

type RecordReadViewMode = "live" | "trash" | "snapshot";

type RecordReadViewProps = {
  baseId: string;
  tableId: string;
  tableName: string;
  fields: Field[];
  record: GridRecord;
  mode?: RecordReadViewMode;
  headerMeta?: JSX.Element;
  headerActions?: JSX.Element;
  relationLabels?: Record<string, string>;
  tableShortIds?: Record<string, string>;
  fieldsByTable?: Record<string, Field[]>;
  viewColumns?: ColumnSpec[];
  dateConfig?: DateContext;
  renderFileField?: (field: Field, record: GridRecord) => JSX.Element;
};

type RecordTitleInput = Pick<RecordReadViewProps, "fields" | "record" | "fieldsByTable" | "relationLabels" | "dateConfig" | "viewColumns">;

const visibleFieldsFor = (fields: Field[]) => fields.filter((field) => !field.deletedAt);

const titleFieldFor = (fields: Field[]) =>
  fields.find((field) => field.presentable && !["longtext", "json", "file", "relation"].includes(field.type)) ??
  fields.find((field) => field.type === "text");

const formatFor = (field: Field, viewColumns?: ColumnSpec[]): FormatSpec | undefined => {
  const column = viewColumns?.find((item) => !("kind" in item) && item.fieldId === field.id);
  return fieldDisplayFormat(field, column?.format);
};

export const recordDisplayTitle = (input: RecordTitleInput): string => {
  const titleField = titleFieldFor(visibleFieldsFor(input.fields));
  if (titleField) {
    const value = input.record.data[titleField.id];
    if (typeof value === "string" && value.length > 0) return value;
    const formatted = formatFieldValueText({
      field: titleField,
      value,
      record: input.record,
      fieldsByTable: input.fieldsByTable,
      relationLabels: input.relationLabels,
      dateConfig: input.dateConfig,
      format: formatFor(titleField, input.viewColumns),
    });
    if (formatted) return formatted;
  }
  return "Untitled record";
};

export default function RecordReadView(props: RecordReadViewProps) {
  const mode = () => props.mode ?? "live";
  const visibleFields = () => visibleFieldsFor(props.fields);
  const titleField = () => titleFieldFor(visibleFields());
  const bodyFields = () => {
    const titleId = titleField()?.id;
    return visibleFields().filter((field) => field.id !== titleId);
  };
  const fieldFormat = (field: Field): FormatSpec | undefined => formatFor(field, props.viewColumns);
  const fieldBarcodeFormat = (field: Field): Extract<FormatSpec, { kind: "barcode" }> | undefined => {
    const format = fieldFormat(field);
    return format?.kind === "barcode" ? format : undefined;
  };
  const isComputedField = (field: Field) => ["formula", "lookup", "rollup"].includes(field.type);
  const isBarcodeDisplayField = (field: Field, record: GridRecord) => {
    const format = fieldBarcodeFormat(field);
    if (!format) return false;
    if (!canRenderBarcode(effectiveDisplayField(field, props.fieldsByTable).type)) return false;
    return barcodeValueText(record.data[field.id]).trim().length > 0;
  };
  const barcodeFields = () => bodyFields().filter((field) => isBarcodeDisplayField(field, props.record));
  const barcodeFieldIds = () => new Set(barcodeFields().map((field) => field.id));
  const detailsFields = () =>
    bodyFields().filter((field) => !barcodeFieldIds().has(field.id) && !["longtext", "json", "file", "relation"].includes(field.type));
  const relationFields = () => bodyFields().filter((field) => field.type === "relation");
  const textBlockFields = () => bodyFields().filter((field) => ["longtext", "json"].includes(field.type));
  const fileFields = () => bodyFields().filter((field) => field.type === "file");
  const hasBodyFields = () =>
    barcodeFields().length > 0 ||
    detailsFields().length > 0 ||
    relationFields().length > 0 ||
    textBlockFields().length > 0 ||
    fileFields().length > 0;

  const detailIcon = (field: Field) => {
    if (field.icon) return field.icon;
    if (isComputedField(field)) return "ti ti-math-function";
    const name = field.name.toLowerCase();
    if (name.includes("price")) return "ti ti-currency-euro";
    if (name.includes("discount")) return "ti ti-percentage";
    if (name.includes("published") || field.type === "date" || field.type === "datetime") return "ti ti-calendar";
    if (name.includes("stock") || field.type === "boolean") return "ti ti-check";
    if (name.includes("tag") || field.type.includes("select")) return "ti ti-tags";
    if (name.includes("sku")) return "ti ti-barcode";
    if (field.type === "number" || field.type === "percent") return "ti ti-hash";
    return "ti ti-info-circle";
  };

  const renderField = (field: Field, record: GridRecord) => {
    if (field.type === "file" && props.renderFileField) return props.renderFileField(field, record);
    return (
      <FieldValue
        field={field}
        value={record.data[field.id]}
        record={record}
        allFields={props.fields}
        baseId={props.baseId}
        tableShortIds={props.tableShortIds}
        fieldsByTable={props.fieldsByTable}
        relationLabels={props.relationLabels}
        dateConfig={props.dateConfig}
        format={fieldFormat(field)}
        mode="detail"
        empty="—"
        linkLookup={mode() !== "snapshot"}
        relationValueMode={mode() === "snapshot" ? "labels" : "ids"}
        showBarcodeOpenAction={mode() !== "snapshot"}
      />
    );
  };

  const defaultHeaderMeta = () => (
    <div class="mt-1 flex items-center gap-1.5 text-[11px] text-dimmed">
      <Show when={mode() === "trash"}>
        <span class="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <i class="ti ti-trash" /> deleted
        </span>
        <span>·</span>
      </Show>
      <Show when={mode() === "snapshot"}>
        <span class="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
          <i class="ti ti-camera" /> snapshot
        </span>
        <span>·</span>
      </Show>
      <span class="truncate">{props.tableName}</span>
      <span>·</span>
      <span>v{props.record.version}</span>
      <span>·</span>
      <span class="font-mono">{props.record.id.slice(0, 8)}</span>
    </div>
  );

  const renderDetailsPaperTile = (field: Field) => (
    <div class="paper min-w-0 p-3">
      <div
        class={`flex min-w-0 items-center gap-1.5 truncate text-[11px] font-medium uppercase tracking-wide ${
          isComputedField(field) ? "text-blue-500" : "text-dimmed"
        }`}
      >
        <i class={`${detailIcon(field)} shrink-0`} />
        {field.name}
      </div>
      <div class="mt-1 min-w-0 break-words text-sm font-semibold leading-5 text-primary">{renderField(field, props.record)}</div>
    </div>
  );

  const Section = (sectionProps: { title: string; children: JSX.Element }) => (
    <section class="paper p-4 flex flex-col gap-3">
      <h3 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary">{sectionProps.title}</h3>
      {sectionProps.children}
    </section>
  );

  const renderBarcodePaper = (field: Field) => {
    const format = fieldBarcodeFormat(field);
    if (!format) return null;
    return (
      <section class="paper p-4 flex flex-col gap-3">
        <div class="flex min-w-0 items-center gap-1.5 truncate text-[11px] font-medium uppercase tracking-wide text-dimmed">
          <i class={`${detailIcon(field)} shrink-0`} />
          {field.name}
        </div>
        <FieldValue
          field={field}
          value={props.record.data[field.id]}
          record={props.record}
          allFields={props.fields}
          baseId={props.baseId}
          tableShortIds={props.tableShortIds}
          fieldsByTable={props.fieldsByTable}
          relationLabels={props.relationLabels}
          dateConfig={props.dateConfig}
          format={format}
          mode="detail"
          empty="—"
          linkLookup={mode() !== "snapshot"}
          showBarcodeOpenAction={mode() !== "snapshot"}
        />
      </section>
    );
  };

  return (
    <>
      <section class="paper p-4">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-lg font-semibold leading-tight text-primary">
              {recordDisplayTitle({
                fields: props.fields,
                record: props.record,
                fieldsByTable: props.fieldsByTable,
                relationLabels: props.relationLabels,
                dateConfig: props.dateConfig,
                viewColumns: props.viewColumns,
              })}
            </h2>
            {props.headerMeta ?? defaultHeaderMeta()}
          </div>
          <Show when={props.headerActions}>{(actions) => <div class="flex shrink-0 items-center gap-0.5">{actions()}</div>}</Show>
        </div>
      </section>

      <Show
        when={hasBodyFields()}
        fallback={
          <Placeholder surface="paper" align="left">
            No fields to show.
          </Placeholder>
        }
      >
        <For each={barcodeFields()}>{(field) => renderBarcodePaper(field)}</For>

        <Show when={detailsFields().length > 0}>
          <div class="grid grid-cols-2 gap-2">
            <For each={detailsFields()}>{(field) => renderDetailsPaperTile(field)}</For>
          </div>
        </Show>

        <Show when={relationFields().length > 0}>
          <Section title="Relations">
            <div class="flex flex-col gap-3">
              <For each={relationFields()}>
                {(field) => (
                  <div class="min-w-0">
                    <p class="text-[11px] font-semibold uppercase tracking-wide text-dimmed">{field.name}</p>
                    <Show when={field.description}>
                      {(description) => <p class="mt-0.5 text-[11px] text-dimmed leading-snug">{description()}</p>}
                    </Show>
                    <div class="mt-1 min-w-0 break-words text-sm text-secondary">{renderField(field, props.record)}</div>
                  </div>
                )}
              </For>
            </div>
          </Section>
        </Show>

        <For each={textBlockFields()}>
          {(field) => (
            <Section title={field.name}>
              <div class="text-sm text-secondary break-words">{renderField(field, props.record)}</div>
            </Section>
          )}
        </For>

        <Show when={fileFields().length > 0}>
          <Section title="Files">
            <div class="flex flex-col gap-3">
              <For each={fileFields()}>
                {(field) => (
                  <div class="min-w-0">
                    <p class="text-[11px] font-semibold uppercase tracking-wide text-dimmed">{field.name}</p>
                    <Show when={field.description}>
                      {(description) => <p class="mt-0.5 text-[11px] text-dimmed leading-snug">{description()}</p>}
                    </Show>
                    <div class="mt-1 min-w-0 break-words text-sm text-secondary">{renderField(field, props.record)}</div>
                  </div>
                )}
              </For>
            </div>
          </Section>
        </Show>
      </Show>
    </>
  );
}
