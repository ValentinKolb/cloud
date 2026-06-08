import { markdown } from "@valentinkolb/cloud/shared";
import { MarkdownView } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { For, Show, type JSX } from "solid-js";
import { FormatSpecSchema, type RecordDisplayConfig } from "../../../contracts";
import { effectiveDisplayField } from "../../../lookup-display";
import type { Field, GridRecord, GridFilePreview } from "../../../service";
import { BarcodeDisplay, canRenderBarcode } from "../table/BarcodeCell";
import { formatCell } from "../table/format-cell";
import { RecordLink } from "../table/RecordLink";
import { selectBadgeItems, selectBadgeStyle } from "../table/select-badge-utils";
import { displayRecordTitle, visibleCardFields } from "./display-mode";
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

const valueToLabelPart = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(valueToLabelPart).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.label === "string") return obj.label;
    if (typeof obj.amount === "string") return obj.amount;
  }
  return "";
};

const expandedLabel = (expandedForUuid: Record<string, unknown> | undefined): string => {
  if (!expandedForUuid) return "Unknown record";
  const parts = Object.values(expandedForUuid).map(valueToLabelPart).filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Untitled record";
};

const isMarkdownLongtext = (field: Field) => field.type === "longtext" && Boolean((field.config as { markdown?: boolean }).markdown);

const fieldFormat = (field: Field) => {
  const parsed = FormatSpecSchema.safeParse((field.config as { format?: unknown }).format);
  return parsed.success ? parsed.data : undefined;
};

const selectOptionLabel = (field: Field, value: unknown): string => {
  const options = (field.config as { options?: Array<{ id: string; label: string }> }).options ?? [];
  const labels = new Map(options.map((option) => [option.id, option.label]));
  const values = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string" && value
      ? [value]
      : [];
  return values.map((id) => labels.get(id) ?? id).filter(Boolean).join(", ");
};

const relationLabel = (record: GridRecord, value: unknown): string => {
  const ids = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string" && value
      ? [value]
      : [];
  return ids.map((id) => expandedLabel(record.expanded?.[id])).filter(Boolean).join(", ");
};

const plainCardValue = (record: GridRecord, field: Field): string => {
  const value = record.data[field.id];
  if (field.type === "relation") return relationLabel(record, value);
  if (field.type === "select") return selectOptionLabel(field, value);
  return valueToLabelPart(value);
};

const subtitleCandidate = (field: Field): boolean => ["text", "id", "relation", "select"].includes(field.type);

const selectWordStyle = (color?: string): JSX.CSSProperties => {
  const style = selectBadgeStyle(color);
  return style.color ? { color: style.color } : {};
};

function CardSelectWords(props: { value: unknown; fieldConfig?: Record<string, unknown> }) {
  const items = () => selectBadgeItems(props.value, "select", props.fieldConfig);
  return (
    <span class="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      {items().length === 0
        ? "—"
        : items().map((item) => (
            <span
              class="min-w-0 font-semibold"
              classList={{ "opacity-70": !item.known }}
              style={selectWordStyle(item.color)}
              title={item.known ? item.id : `Unknown option: ${item.id}`}
            >
              {item.label}
            </span>
          ))}
    </span>
  );
}

function CardFieldValue(props: {
  record: GridRecord;
  field: Field;
  baseId: string;
  tableShortIds?: Record<string, string>;
  fieldsByTable?: Record<string, Field[]>;
  dateConfig?: DateContext;
}) {
  const value = () => props.record.data[props.field.id];
  const displayField = () => effectiveDisplayField(props.field, props.fieldsByTable);
  const format = () => fieldFormat(props.field);
  const renderRelation = () => {
    const raw = value();
    const ids = Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === "string")
      : typeof raw === "string" && raw
        ? [raw]
        : [];
    if (ids.length === 0) return "—";
    const targetTableId = (props.field.config as { targetTableId?: string }).targetTableId;
    return (
      <span class="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <For each={ids}>
          {(id, index) => (
            <RecordLink
              label={expandedLabel(props.record.expanded?.[id])}
              targetTableId={targetTableId}
              targetTableShortId={targetTableId ? props.tableShortIds?.[targetTableId] : undefined}
              targetRecordId={id}
              baseId={props.baseId}
              comma={index() < ids.length - 1}
            />
          )}
        </For>
      </span>
    );
  };
  const renderLookup = () => {
    const raw = value();
    const resolved = displayField();
    const fmt = format();
    if (fmt?.kind === "barcode" && canRenderBarcode(resolved.type)) return <BarcodeDisplay value={raw} format={fmt} showOpenAction />;
    return formatCell(raw, resolved.type, resolved.config, fmt, props.dateConfig) || "—";
  };
  const renderDefault = (): JSX.Element | string => {
    const raw = value();
    const fmt = format();
    if (props.field.type === "relation") return renderRelation();
    if (props.field.type === "lookup") return renderLookup();
    if (props.field.type === "select") return <CardSelectWords value={raw} fieldConfig={props.field.config} />;
    if (isMarkdownLongtext(props.field)) {
      return typeof raw === "string" && raw.trim() ? <MarkdownView html={markdown.render(raw)} smallHeadings class="text-sm" /> : "—";
    }
    if (fmt?.kind === "barcode" && canRenderBarcode(props.field.type)) return <BarcodeDisplay value={raw} format={fmt} showOpenAction />;
    return formatCell(raw, props.field.type, props.field.config, fmt, props.dateConfig) || "—";
  };
  return <>{renderDefault()}</>;
}

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
  const displayFields = (record: GridRecord) => {
    const title = displayRecordTitle(record, props.fields);
    const titleKey = title.trim().toLowerCase();
    return cardFields().filter((field) => {
      if (field.type === "file") return false;
      const value = plainCardValue(record, field).trim().toLowerCase();
      return value && value !== titleKey;
    });
  };
  const subtitleFields = (record: GridRecord) => displayFields(record).filter(subtitleCandidate).slice(0, 2);
  const factFields = (record: GridRecord) => {
    const subtitleIds = new Set(subtitleFields(record).map((field) => field.id));
    return displayFields(record).filter((field) => !subtitleIds.has(field.id));
  };
  const subtitle = (record: GridRecord) => subtitleFields(record).map((field) => plainCardValue(record, field)).filter(Boolean).join(" · ");
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
        fallback={<div class="flex min-h-48 items-center justify-center text-sm text-dimmed">No records</div>}
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
                        {displayRecordTitle(record, props.fields)}
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
                            <div class="min-w-0 text-xs font-medium leading-snug text-primary">
                              <CardFieldValue
                                record={record}
                                field={field}
                                baseId={props.baseId}
                                tableShortIds={props.tableShortIds}
                                fieldsByTable={props.fieldsByTable}
                                dateConfig={props.dateConfig}
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
