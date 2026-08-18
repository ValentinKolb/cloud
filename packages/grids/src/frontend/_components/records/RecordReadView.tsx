import type { DateContext } from "@k2b/stdlib";
import { DescriptionList, DetailPanel, Placeholder } from "@k2b/ui";
import { For, type JSX, Show } from "solid-js";
import type { PublicField as Field, PublicGridRecord as GridRecord } from "../../../api/public-dto";
import type { ColumnSpec, FormatSpec } from "../../../contracts";
import { effectiveDisplayField } from "../../../lookup-display";
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
  fieldsByTable?: Record<string, Field[]>;
  viewColumns?: ColumnSpec[];
  dateConfig?: DateContext;
  renderFileField?: (field: Field, record: GridRecord) => JSX.Element;
  scrollPreserveKey?: string;
  relationsAfter?: JSX.Element;
  children?: JSX.Element;
};

const visibleFieldsFor = (fields: Field[]) => fields.filter((field) => !field.deletedAt);

export const hasRecordDetailValue = (value: unknown): boolean => value !== null && value !== undefined && value !== "";

export default function RecordReadView(props: RecordReadViewProps) {
  const mode = () => props.mode ?? "live";
  const visibleFields = () => visibleFieldsFor(props.fields);
  const titleField = () => recordTitleField(visibleFields());
  const bodyFields = () => visibleFields().filter((field) => field.id !== titleField()?.id);
  const fieldFormat = (field: Field): FormatSpec | undefined => fieldDisplayFormatForView(field, props.viewColumns);
  const fieldBarcodeFormat = (field: Field): Extract<FormatSpec, { kind: "barcode" }> | undefined => {
    const format = fieldFormat(field);
    return format?.kind === "barcode" ? format : undefined;
  };
  const isComputedField = (field: Field) => ["formula", "lookup", "rollup", "html_template"].includes(field.type);
  const isBarcodeDisplayField = (field: Field, record: GridRecord) => {
    const format = fieldBarcodeFormat(field);
    return Boolean(
      format &&
        canRenderBarcode(effectiveDisplayField(field, props.fieldsByTable).type) &&
        barcodeValueText(record.data[field.id]).trim().length > 0,
    );
  };
  const barcodeFields = () => bodyFields().filter((field) => isBarcodeDisplayField(field, props.record));
  const barcodeFieldIds = () => new Set(barcodeFields().map((field) => field.id));
  const detailsFields = () =>
    bodyFields().filter((field) => !barcodeFieldIds().has(field.id) && !["longtext", "json", "file", "relation"].includes(field.type));
  const relationFields = () => bodyFields().filter((field) => field.type === "relation");
  const textBlockFields = () =>
    bodyFields().filter((field) => ["longtext", "json"].includes(field.type) && hasRecordDetailValue(props.record.data[field.id]));
  const fileFields = () => bodyFields().filter((field) => field.type === "file");
  const hasFieldSections = () =>
    barcodeFields().length > 0 || detailsFields().length > 0 || textBlockFields().length > 0 || fileFields().length > 0;

  const renderField = (field: Field, record: GridRecord) => {
    if (field.type === "file" && props.renderFileField) return props.renderFileField(field, record);
    return (
      <FieldValue
        field={field}
        value={record.data[field.id]}
        record={record}
        allFields={props.fields}
        baseId={props.baseId}
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
    <>
      <Show when={mode() === "trash"}>
        <span class="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <i class="ti ti-trash" aria-hidden="true" /> Deleted
        </span>
      </Show>
      <Show when={mode() === "snapshot"}>
        <span class="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
          <i class="ti ti-camera" aria-hidden="true" /> Snapshot
        </span>
      </Show>
      <span>v{props.record.version}</span>
      <span class="font-mono">{props.record.id.slice(0, 8)}</span>
    </>
  );

  const identityIcon = () => {
    if (mode() === "snapshot") return "ti ti-camera";
    if (mode() === "trash") return "ti ti-trash";
    return "ti ti-table-row";
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

  const fieldTerm = (field: Field, includeDescription = false) => (
    <span class="flex min-w-0 items-start gap-1.5">
      <i
        class={`${fieldTypeIcon(field.type, field.icon)} mt-0.5 shrink-0 ${isComputedField(field) ? "text-blue-600 dark:text-blue-400" : ""}`}
        aria-hidden="true"
      />
      <span class="min-w-0">
        <span class="block break-words">{field.name}</span>
        <Show when={includeDescription && field.description}>
          {(description) => <span class="mt-0.5 block text-[11px] font-normal leading-snug text-dimmed">{description()}</span>}
        </Show>
      </span>
    </span>
  );

  return (
    <DetailPanel>
      <DetailPanel.Header
        icon={identityIcon()}
        title={recordTitle()}
        subtitle={props.tableName}
        meta={props.headerMeta ?? defaultHeaderMeta()}
        actions={props.headerActions}
        primaryActions={props.quickActions}
      />
      <DetailPanel.Body scrollPreserveKey={props.scrollPreserveKey}>
        <Show when={hasFieldSections()}>
          <For each={barcodeFields()}>
            {(field) => (
              <DetailPanel.Section title={field.name} icon={fieldTypeIcon(field.type, field.icon)}>
                {renderField(field, props.record)}
              </DetailPanel.Section>
            )}
          </For>
          <Show when={detailsFields().length > 0}>
            <DetailPanel.Section title="Fields" icon="ti ti-list-details">
              <DescriptionList
                layout="rows"
                size="sm"
                items={detailsFields().map((field) => ({
                  term: fieldTerm(field),
                  description: <span class="min-w-0 break-words text-primary">{renderField(field, props.record)}</span>,
                }))}
              />
            </DetailPanel.Section>
          </Show>
          <For each={textBlockFields()}>
            {(field) => (
              <DetailPanel.Section title={field.name} icon={fieldTypeIcon(field.type, field.icon)}>
                <div class="break-words text-sm leading-relaxed text-secondary">{renderField(field, props.record)}</div>
              </DetailPanel.Section>
            )}
          </For>
          <Show when={fileFields().length > 0}>
            <DetailPanel.Section title="Files" icon="ti ti-paperclip">
              <div class="flex flex-col gap-4">
                <For each={fileFields()}>
                  {(field) => (
                    <div class="min-w-0">
                      <div class="text-xs text-dimmed">{fieldTerm(field, true)}</div>
                      <div class="mt-2 min-w-0 break-words text-sm text-secondary">{renderField(field, props.record)}</div>
                    </div>
                  )}
                </For>
              </div>
            </DetailPanel.Section>
          </Show>
        </Show>

        <Show when={bodyFields().length === 0}>
          <Placeholder surface="paper" align="left" description={<>No record values yet.</>} />
        </Show>

        <Show when={relationFields().length > 0 || props.relationsAfter !== undefined}>
          <DetailPanel.Group label="Record relationships">
            <Show when={relationFields().length > 0}>
              <DetailPanel.Section title="Relations" icon="ti ti-link" tone="accent">
                <DescriptionList
                  layout="rows"
                  size="sm"
                  items={relationFields().map((field) => ({
                    term: fieldTerm(field, true),
                    description: <span class="min-w-0 break-words text-primary">{renderField(field, props.record)}</span>,
                  }))}
                />
              </DetailPanel.Section>
            </Show>
            {props.relationsAfter}
          </DetailPanel.Group>
        </Show>
        {props.children}
      </DetailPanel.Body>
    </DetailPanel>
  );
}
