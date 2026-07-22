import { Placeholder } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { For, type JSX, Show } from "solid-js";
import type { ColumnSpec, FormatSpec } from "../../../contracts";
import { effectiveDisplayField } from "../../../lookup-display";
import type { Field, GridRecord } from "../../../service";
import { fieldTypeIcon } from "../fields/field-type-meta";
import { barcodeValueText, canRenderBarcode } from "../table/BarcodeRendering";
import { FieldValue } from "../table/FieldValue";
import { fieldDisplayFormatForView, recordDisplayTitle, recordTitleField } from "./record-display";

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
  quickActions?: JSX.Element;
  relationLabels?: Record<string, string>;
  tableShortIds?: Record<string, string>;
  fieldsByTable?: Record<string, Field[]>;
  viewColumns?: ColumnSpec[];
  dateConfig?: DateContext;
  renderFileField?: (field: Field, record: GridRecord) => JSX.Element;
  scrollPreserveKey?: string;
  children?: JSX.Element;
};

const visibleFieldsFor = (fields: Field[]) => fields.filter((field) => !field.deletedAt);

export const hasRecordDetailValue = (value: unknown): boolean => value !== null && value !== undefined && value !== "";

export default function RecordReadView(props: RecordReadViewProps) {
  const mode = () => props.mode ?? "live";
  const visibleFields = () => visibleFieldsFor(props.fields);
  const titleField = () => recordTitleField(visibleFields());
  const bodyFields = () => {
    const titleId = titleField()?.id;
    return visibleFields().filter((field) => field.id !== titleId);
  };
  const fieldFormat = (field: Field): FormatSpec | undefined => fieldDisplayFormatForView(field, props.viewColumns);
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
  const textBlockFields = () =>
    bodyFields().filter((field) => ["longtext", "json"].includes(field.type) && hasRecordDetailValue(props.record.data[field.id]));
  const fileFields = () => bodyFields().filter((field) => field.type === "file");
  const hasBodyFields = () =>
    barcodeFields().length > 0 ||
    detailsFields().length > 0 ||
    relationFields().length > 0 ||
    textBlockFields().length > 0 ||
    fileFields().length > 0;

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
    <div class="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-dimmed">
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

  const detailLabel = () => {
    if (mode() === "snapshot") return "Record snapshot";
    if (mode() === "trash") return "Deleted record";
    return "Record details";
  };

  const identityIcon = () => {
    if (mode() === "snapshot") return "ti-camera";
    if (mode() === "trash") return "ti-trash";
    return "ti-table-row";
  };
  const recordTitle = () =>
    recordDisplayTitle({
      fields: props.fields,
      record: props.record,
      fieldsByTable: props.fieldsByTable,
      relationLabels: props.relationLabels,
      dateConfig: props.dateConfig,
      viewColumns: props.viewColumns,
    });

  const Section = (sectionProps: { title: string; children: JSX.Element }) => (
    <section class="detail-section flex flex-col gap-3">
      <h3 class="detail-section-label mb-0">{sectionProps.title}</h3>
      {sectionProps.children}
    </section>
  );

  const renderBarcodeSection = (field: Field) => {
    const format = fieldBarcodeFormat(field);
    if (!format) return null;
    return (
      <section class="detail-section flex flex-col gap-3">
        <div class="detail-section-label mb-0 flex min-w-0 items-center gap-1.5 truncate">
          <i class={`${fieldTypeIcon(field.type, field.icon)} shrink-0`} />
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
    <div class="flex h-full min-h-0 flex-col">
      <header class="detail-header">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold text-secondary">{detailLabel()}</span>
          <Show when={props.headerActions}>
            {(actions) => (
              <div class="flex shrink-0 items-center gap-0.5" role="group" aria-label="Detail panel actions">
                {actions()}
              </div>
            )}
          </Show>
        </div>

        <div class="mt-4 flex flex-col items-center text-center">
          <span class="app-accent-text flex h-12 w-12 items-center justify-center rounded-[var(--ui-radius-surface)] bg-[var(--ui-selected)]">
            <i class={`ti ${identityIcon()} text-xl`} />
          </span>
          <h2 class="mt-2 line-clamp-2 max-w-full break-words text-lg font-semibold leading-tight text-primary" title={recordTitle()}>
            {recordTitle()}
          </h2>
          {props.headerMeta ?? defaultHeaderMeta()}
          <Show when={props.quickActions}>
            {(actions) => (
              <div class="mt-3 flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Record actions">
                {actions()}
              </div>
            )}
          </Show>
        </div>
      </header>

      <div class="detail-stack" data-scroll-preserve={props.scrollPreserveKey}>
        <Show
          when={hasBodyFields()}
          fallback={
            <Placeholder surface="paper" align="left">
              No record values yet.
            </Placeholder>
          }
        >
          <For each={barcodeFields()}>{(field) => renderBarcodeSection(field)}</For>

          <Show when={detailsFields().length > 0}>
            <Section title="Fields">
              <dl class="grid grid-cols-[minmax(6rem,0.42fr)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
                <For each={detailsFields()}>
                  {(field) => (
                    <>
                      <dt
                        class={`flex min-w-0 items-center gap-1.5 self-start text-xs ${
                          isComputedField(field) ? "text-blue-600 dark:text-blue-400" : "text-dimmed"
                        }`}
                      >
                        <i class={`${fieldTypeIcon(field.type, field.icon)} shrink-0 text-sm`} />
                        <span class="min-w-0 break-words">{field.name}</span>
                      </dt>
                      <dd class="min-w-0 break-words text-primary">{renderField(field, props.record)}</dd>
                    </>
                  )}
                </For>
              </dl>
            </Section>
          </Show>

          <Show when={relationFields().length > 0}>
            <Section title="Relations">
              <div class="flex flex-col gap-3">
                <For each={relationFields()}>
                  {(field) => (
                    <div class="grid min-w-0 grid-cols-[minmax(6rem,0.42fr)_minmax(0,1fr)] gap-x-4">
                      <div class="min-w-0 text-xs text-dimmed">
                        <p class="flex items-center gap-1.5">
                          <i class={`${fieldTypeIcon(field.type, field.icon)} shrink-0 text-sm`} />
                          <span class="break-words">{field.name}</span>
                        </p>
                        <Show when={field.description}>
                          {(description) => <p class="mt-1 text-[11px] leading-snug">{description()}</p>}
                        </Show>
                      </div>
                      <div class="min-w-0 break-words text-sm text-primary">{renderField(field, props.record)}</div>
                    </div>
                  )}
                </For>
              </div>
            </Section>
          </Show>

          <For each={textBlockFields()}>
            {(field) => (
              <Section title={field.name}>
                <div class="break-words text-sm leading-relaxed text-secondary">{renderField(field, props.record)}</div>
              </Section>
            )}
          </For>

          <Show when={fileFields().length > 0}>
            <Section title="Files">
              <div class="flex flex-col gap-3">
                <For each={fileFields()}>
                  {(field) => (
                    <div class="min-w-0">
                      <p class="flex items-center gap-1.5 text-xs text-dimmed">
                        <i class={`${fieldTypeIcon(field.type, field.icon)} shrink-0 text-sm`} />
                        {field.name}
                      </p>
                      <Show when={field.description}>
                        {(description) => <p class="mt-1 text-[11px] leading-snug text-dimmed">{description()}</p>}
                      </Show>
                      <div class="mt-2 min-w-0 break-words text-sm text-secondary">{renderField(field, props.record)}</div>
                    </div>
                  )}
                </For>
              </div>
            </Section>
          </Show>
        </Show>

        {props.children}
      </div>
    </div>
  );
}
