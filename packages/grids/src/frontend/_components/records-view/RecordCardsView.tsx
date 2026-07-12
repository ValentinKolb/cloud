import { Placeholder } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { For, Show } from "solid-js";
import type { RecordDisplayConfig } from "../../../contracts";
import type { Field, GridFilePreview, GridRecord } from "../../../service";
import { recordDisplayTitle } from "../records/record-display";
import { FieldValue } from "../table/FieldValue";
import { fieldDisplayFormat, formatFieldValueText } from "../table/field-value-format";
import { visibleCardFields } from "./display-mode";
import type { CardSize } from "./query-url";

const cardGridClass: Record<CardSize, string> = {
  small: "grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2",
  medium: "grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2.5",
  large: "grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3",
};

const cardPaddingClass: Record<CardSize, string> = {
  small: "p-2",
  medium: "p-2.5",
  large: "p-3",
};

const plainCardValue = (record: GridRecord, field: Field, fieldsByTable?: Record<string, Field[]>, dateConfig?: DateContext): string =>
  formatFieldValueText({ field, value: record.data[field.id], record, fieldsByTable, dateConfig });

const subtitleCandidate = (field: Field): boolean => ["text", "id", "relation", "select"].includes(field.type);

const hasVisualFormat = (field: Field): boolean => fieldDisplayFormat(field)?.kind === "barcode";

export function RecordCardsView(props: {
  items: GridRecord[];
  fields: Field[];
  displayConfig: RecordDisplayConfig;
  filePreviews?: Record<string, Record<string, GridFilePreview>>;
  baseId: string;
  tableId: string;
  tableShortIds?: Record<string, string>;
  fieldsByTable?: Record<string, Field[]>;
  selectedId?: string | null;
  highlightedIds?: ReadonlySet<string>;
  onRecordClick: (record: GridRecord) => void;
  cardSize?: CardSize;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  dateConfig?: DateContext;
}) {
  const size = () => props.cardSize ?? "medium";
  const cardFields = () => visibleCardFields(props.fields, props.displayConfig);
  const title = (record: GridRecord) =>
    recordDisplayTitle({ fields: props.fields, record, fieldsByTable: props.fieldsByTable, dateConfig: props.dateConfig });
  const displayFields = (record: GridRecord) => {
    const titleKey = title(record).trim().toLowerCase();
    return cardFields().filter((field) => {
      if (field.type === "file") return false;
      const value = plainCardValue(record, field, props.fieldsByTable, props.dateConfig).trim().toLowerCase();
      return value && value !== titleKey;
    });
  };
  const subtitleFields = (record: GridRecord) => displayFields(record).filter(subtitleCandidate).slice(0, 2);
  const factFields = (record: GridRecord) => {
    const subtitleIds = new Set(subtitleFields(record).map((field) => field.id));
    return displayFields(record).filter((field) => !subtitleIds.has(field.id));
  };
  const subtitle = (record: GridRecord) =>
    subtitleFields(record)
      .map((field) => plainCardValue(record, field, props.fieldsByTable, props.dateConfig))
      .filter(Boolean)
      .join(" · ");
  const coverPreview = (record: GridRecord): GridFilePreview | undefined => {
    const fieldId = props.displayConfig.cards?.imageFieldId;
    return fieldId ? props.filePreviews?.[record.id]?.[fieldId] : undefined;
  };
  const coverUrl = (preview: GridFilePreview) =>
    `/api/grids/records/${props.tableId}/${preview.recordId}/files/${preview.fieldId}/${preview.fileId}/content?inline=true`;

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-auto" data-scroll-preserve={`grids-cards-${props.tableId}`}>
      <Show
        when={props.items.length > 0}
        fallback={
          <Placeholder icon="ti ti-table" class="min-h-48 justify-center">
            No records
          </Placeholder>
        }
      >
        <div class={`grid p-0.5 ${cardGridClass[size()]}`}>
          <For each={props.items}>
            {(record) => {
              const preview = () => coverPreview(record);
              const selected = () => props.selectedId === record.id;
              const highlighted = () => props.highlightedIds?.has(record.id);
              return (
                <button
                  type="button"
                  class={`paper flex min-w-0 flex-col overflow-hidden text-left transition hover:paper-highlighted ${cardPaddingClass[size()]} ${
                    selected() ? "bg-blue-50/50 dark:bg-blue-950/15" : ""
                  } ${highlighted() ? "bg-sky-50/60 dark:bg-sky-950/20" : ""}`}
                  onClick={() => props.onRecordClick(record)}
                >
                  <Show when={preview()}>
                    {(file) => (
                      <div class="aspect-square w-full overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-black/5 dark:bg-zinc-950 dark:ring-white/10">
                        <img src={coverUrl(file())} alt="" class="h-full w-full object-cover" loading="lazy" />
                      </div>
                    )}
                  </Show>
                  <div class="flex flex-col gap-3 pt-3">
                    <div class="min-w-0">
                      <div
                        class={`truncate text-sm font-semibold leading-tight ${
                          selected() ? "text-blue-600 dark:text-blue-400" : "text-primary"
                        }`}
                      >
                        {title(record)}
                      </div>
                      <Show when={subtitle(record)}>
                        {(text) => <div class="mt-1 truncate text-xs leading-snug text-dimmed">{text()}</div>}
                      </Show>
                    </div>
                    <Show when={factFields(record).length > 0}>
                      <div class="flex flex-col gap-1.5">
                        <For each={factFields(record)}>
                          {(field) => (
                            <div class="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5">
                              <div class="max-w-[6.5rem] truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-dimmed">
                                {field.name}
                              </div>
                              <div
                                class={`min-w-0 overflow-hidden text-xs font-medium leading-snug text-primary [overflow-wrap:anywhere] ${
                                  hasVisualFormat(field) ? "" : "line-clamp-2"
                                }`}
                              >
                                <FieldValue
                                  record={record}
                                  field={field}
                                  value={record.data[field.id]}
                                  baseId={props.baseId}
                                  tableShortIds={props.tableShortIds}
                                  fieldsByTable={props.fieldsByTable}
                                  dateConfig={props.dateConfig}
                                  mode="card"
                                  markdownClass="line-clamp-3 text-sm"
                                  showBarcodeOpenAction
                                />
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </button>
              );
            }}
          </For>
        </div>
      </Show>
      <Show when={props.hasMore}>
        <button type="button" class="btn-input btn-input-sm mt-3 self-center" onClick={props.onLoadMore} disabled={props.loadingMore}>
          {props.loadingMore ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-chevron-down" />}
          Load more
        </button>
      </Show>
    </div>
  );
}
