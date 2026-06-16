import { Placeholder, TextInput } from "@valentinkolb/cloud/ui";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { mutation, timed } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { AggregationSpec, FilterTree, GroupBySpec, RecordQuery, TableQueryResult } from "../../../contracts";
import type { Field, GridRecord } from "../../../service";
import { fetchTableQuery } from "../records-view/fetcher";
import { formatFieldValueText } from "./FieldValue";
import type { GroupBucket } from "./GroupedTable";

const PAGE_SIZE = 30;

const AGG_LABELS: Record<string, string> = {
  count: "records",
  countEmpty: "empty",
  countUnique: "unique",
  sum: "sum",
  avg: "avg",
  min: "min",
  max: "max",
  median: "median",
  earliest: "earliest",
  latest: "latest",
};

type Props = {
  tableId: string;
  fields: Field[];
  query: RecordQuery;
  groupBy: GroupBySpec[];
  aggregations: AggregationSpec[];
  bucket: GroupBucket;
  relationLabels: Record<string, string>;
  onClose: () => void;
  onOpenRecord: (record: GridRecord) => void;
  dateConfig?: DateContext;
};

type FetchVars = {
  reset: boolean;
  cursor: string | null;
  q: string;
};
type FilterLeaf = {
  fieldId: string;
  op: string;
  value?: unknown;
};

export default function GroupDetailPanel(props: Props) {
  const [q, setQ] = createSignal("");
  const [items, setItems] = createSignal<GridRecord[]>([]);
  const [nextCursor, setNextCursor] = createSignal<string | null>(null);
  let sentinel: HTMLDivElement | undefined;

  const fieldsById = () => new Map(props.fields.map((f) => [f.id, f]));
  const presentableFields = () => {
    const presentable = props.fields.filter((f) => !f.deletedAt && f.presentable).sort((a, b) => a.position - b.position);
    if (presentable.length > 0) return presentable;
    return props.fields
      .filter((f) => !f.deletedAt && !f.hideInTable)
      .sort((a, b) => a.position - b.position)
      .slice(0, 3);
  };

  const bucketKey = createMemo(() => JSON.stringify(props.bucket.keys));

  const fetchMut = mutation.create<TableQueryResult, FetchVars, { reset: boolean }>({
    onBefore: (vars) => ({ reset: vars.reset }),
    mutation: async (vars, { abortSignal }) => {
      const query = buildMemberQuery({
        baseQuery: props.query,
        fields: props.fields,
        groupBy: props.groupBy,
        keys: props.bucket.keys,
        q: vars.q,
        dateConfig: props.dateConfig,
      });
      return fetchTableQuery({ tableId: props.tableId, query, cursor: vars.cursor }, { signal: abortSignal });
    },
    onSuccess: (data, ctx) => {
      const nextItems = data.items ?? [];
      setItems((prev) => (ctx?.reset ? nextItems : [...prev, ...nextItems]));
      setNextCursor(data.nextCursor ?? null);
    },
  });

  const loadFirst = (nextQ = q()) => {
    fetchMut.abort();
    setNextCursor(null);
    void fetchMut.mutate({ reset: true, cursor: null, q: nextQ.trim() });
  };
  const loadMore = () => {
    if (fetchMut.loading() || !nextCursor()) return;
    void fetchMut.mutate({ reset: false, cursor: nextCursor(), q: q().trim() });
  };

  const searchDebounce = timed.debounce((next: string) => loadFirst(next), 250);

  createEffect(() => {
    bucketKey();
    setQ("");
    setItems([]);
    loadFirst("");
  });

  createEffect(() => {
    if (!sentinel || !nextCursor()) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    });
    observer.observe(sentinel);
    onCleanup(() => observer.disconnect());
  });

  const aggSpecsWithCount = () => {
    const explicit = props.aggregations;
    const hasStarCount = explicit.some((a) => a.fieldId === "*" && a.agg === "count");
    return hasStarCount ? explicit : [{ fieldId: "*", agg: "count" } as AggregationSpec, ...explicit];
  };

  const aggLabel = (agg: AggregationSpec) => {
    if (agg.label?.trim()) return agg.label;
    if (agg.fieldId === "*") return AGG_LABELS[agg.agg] ?? agg.agg;
    const field = fieldsById().get(agg.fieldId);
    return `${AGG_LABELS[agg.agg] ?? agg.agg} ${field?.name ?? "missing field"}`;
  };

  const groupLabel = (spec: GroupBySpec, index: number) => {
    const field = fieldsById().get(spec.fieldId);
    const name = field ? field.name : "missing field";
    return spec.granularity ? `${name} (${spec.granularity})` : name;
  };
  const groupIcon = (spec: GroupBySpec) => {
    const field = fieldsById().get(spec.fieldId);
    return field?.type === "relation" ? "ti ti-hierarchy" : "ti ti-list-tree";
  };
  const fieldWithGroupConfig = (field: Field, spec: GroupBySpec): Field =>
    spec.granularity ? { ...field, config: { ...field.config, includeTime: false } } : field;

  const groupValue = (spec: GroupBySpec, index: number) => {
    const field = fieldsById().get(spec.fieldId);
    const raw = props.bucket.keys[index];
    if (!field) return "Unknown";
    if (raw == null) return "—";
    return (
      formatFieldValueText({
        field: fieldWithGroupConfig(field, spec),
        value: raw,
        relationLabels: props.relationLabels,
        dateConfig: props.dateConfig,
      }) || String(raw)
    );
  };

  const renderRecordLine = (record: GridRecord) => {
    const fields = presentableFields();
    if (fields.length === 0) return "Untitled record";
    return (
      fields
        .map((field) => renderRecordValue(record, field))
        .filter((part) => part.length > 0)
        .join(" · ") || "Untitled record"
    );
  };

  return (
    <div class="flex h-full min-h-0 flex-col gap-2 overflow-y-auto">
      <section class="paper p-4">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h2 class="truncate text-lg font-semibold text-primary">Group</h2>
            <div class="mt-1 flex flex-wrap gap-1.5">
              <For each={props.groupBy}>
                {(spec, index) => (
                  <span class="inline-flex min-w-0 items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                    <i class={`${groupIcon(spec)} shrink-0`} />
                    <span class="font-medium">{groupLabel(spec, index())}</span>
                    <span class="min-w-0 truncate">{groupValue(spec, index())}</span>
                  </span>
                )}
              </For>
            </div>
          </div>
          <button
            type="button"
            class="btn-simple btn-sm text-dimmed hover:text-primary"
            aria-label="Close group detail panel"
            title="Close"
            onClick={() => props.onClose()}
          >
            <i class="ti ti-x" />
          </button>
        </div>
      </section>

      <div class="grid grid-cols-2 gap-2">
        <For each={aggSpecsWithCount()}>
          {(agg) => (
            <div class="paper min-w-0 p-3">
              <div class="flex min-w-0 items-center gap-1.5 truncate text-[11px] font-medium uppercase tracking-wide text-blue-500">
                <i class="ti ti-math-function shrink-0" />
                {aggLabel(agg)}
              </div>
              <div class="mt-1 min-w-0 break-words text-sm font-semibold leading-5 text-primary">
                {formatAgg(props.bucket.values[`${agg.fieldId}__${agg.agg}`])}
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="flex min-h-[18rem] flex-col gap-2">
        <TextInput
          icon="ti ti-search"
          placeholder="Search in group..."
          value={q}
          onInput={(next) => {
            setQ(next);
            searchDebounce.debouncedFn(next);
          }}
          clearable
          onClear={() => {
            setQ("");
            loadFirst("");
          }}
        />

        <div class="flex min-h-0 flex-1 flex-col gap-2">
          <Show
            when={items().length > 0}
            fallback={
              <Placeholder>
                <Show when={fetchMut.error()} fallback={fetchMut.loading() ? "Loading records..." : "No records in this group."}>
                  {(err) => (
                    <span>
                      Could not load records.
                      <span class="block text-xs">{err().message}</span>
                    </span>
                  )}
                </Show>
              </Placeholder>
            }
          >
            <For each={items()}>
              {(record) => (
                <div class="paper flex min-h-8 items-center gap-2 px-2.5 py-1.5 transition-colors hover:bg-zinc-50/60 dark:hover:bg-zinc-800/25">
                  <div class="min-w-0 flex-1 truncate text-xs text-primary">{renderRecordLine(record)}</div>
                  <button
                    type="button"
                    class="btn-simple btn-sm h-6 min-h-0 px-1.5 text-xs text-dimmed hover:text-blue-500"
                    onClick={() => props.onOpenRecord(record)}
                    title="Open record"
                  >
                    <i class="ti ti-external-link" />
                    Open
                  </button>
                </div>
              )}
            </For>
          </Show>
          <div ref={sentinel} class="h-1" />
          <Show when={fetchMut.loading() && items().length > 0}>
            <div class="py-2 text-center text-xs text-dimmed">Loading more...</div>
          </Show>
        </div>
      </div>
    </div>
  );

  function renderRecordValue(record: GridRecord, field: Field): string {
    const value = record.data[field.id];
    return formatFieldValueText({ field, value, record, relationLabels: props.relationLabels, dateConfig: props.dateConfig });
  }
}

const formatAgg = (value: unknown): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
};

const buildMemberQuery = (params: {
  baseQuery: RecordQuery;
  fields: Field[];
  groupBy: GroupBySpec[];
  keys: unknown[];
  q: string;
  dateConfig?: DateContext;
}): RecordQuery => {
  const leaves = params.groupBy
    .map((spec, index) => groupFilterLeaf(spec, params.keys[index], params.fields, params.dateConfig))
    .filter((leaf): leaf is FilterLeaf => !!leaf);
  const filter = mergeFilters(params.baseQuery.filter, leaves);
  const q = params.q.trim();
  return {
    filter,
    search: q ? { q, fieldIds: [] } : params.baseQuery.search,
    sort: params.baseQuery.sort,
    includeDeleted: params.baseQuery.includeDeleted,
    deletedOnly: params.baseQuery.deletedOnly,
    limit: PAGE_SIZE,
  };
};

const mergeFilters = (base: FilterTree | undefined, leaves: FilterTree[]): FilterTree | undefined => {
  if (!base && leaves.length === 0) return undefined;
  if (!base && leaves.length === 1) return leaves[0];
  return { op: "AND", filters: [base, ...leaves].filter(Boolean) as FilterTree[] };
};

const groupFilterLeaf = (spec: GroupBySpec, key: unknown, fields: Field[], dateConfig?: DateContext): FilterLeaf | null => {
  const field = fields.find((f) => f.id === spec.fieldId);
  if (!field) return null;
  if (key === null || key === undefined || key === "") {
    return { fieldId: field.id, op: "isEmpty" };
  }
  switch (field.type) {
    case "relation":
      return { fieldId: field.id, op: "containsAny", value: [String(key)] };
    case "select":
      return { fieldId: field.id, op: "is", value: String(key) };
    case "boolean":
      return {
        fieldId: field.id,
        op: "=",
        value: typeof key === "boolean" ? key : String(key).toLowerCase() === "true",
      };
    case "number":
    case "percent":
    case "duration":
      return Number.isFinite(Number(key)) ? { fieldId: field.id, op: "=", value: Number(key) } : null;
    case "date":
      return dateGroupFilter(field.id, key, spec.granularity, Boolean((field.config as { includeTime?: boolean }).includeTime), dateConfig);
    default:
      return { fieldId: field.id, op: "equals", value: String(key) };
  }
};

const zonedBoundary = (localDateTime: string, dateConfig?: DateContext): string => {
  const utcFallback = () => new Date(`${localDateTime}Z`).toISOString();
  if (!dateConfig?.timeZone) return utcFallback();
  try {
    return dates.zonedDateTimeToInstant(localDateTime, dateConfig.timeZone, { disambiguation: "compatible" });
  } catch {
    return utcFallback();
  }
};

const dateGroupFilter = (
  fieldId: string,
  key: unknown,
  granularity?: GroupBySpec["granularity"],
  includeTime = false,
  dateConfig?: DateContext,
): FilterLeaf => {
  const startDate = String(key).slice(0, 10);
  const [y, m, d] = startDate.split("-").map(Number);
  if (!y || !m || !d) return { fieldId, op: "=", value: startDate };
  if (!granularity) return { fieldId, op: "=", value: includeTime ? String(key) : startDate };

  const end = new Date(Date.UTC(y, m - 1, d));
  if (granularity === "day") end.setUTCDate(end.getUTCDate() + 1);
  if (granularity === "week") end.setUTCDate(end.getUTCDate() + 7);
  if (granularity === "month") end.setUTCMonth(end.getUTCMonth() + 1);
  if (granularity === "quarter") end.setUTCMonth(end.getUTCMonth() + 3);
  if (granularity === "year") end.setUTCFullYear(end.getUTCFullYear() + 1);
  end.setUTCDate(end.getUTCDate() - 1);
  const endDate = end.toISOString().slice(0, 10);
  return {
    fieldId,
    op: "between",
    value: includeTime
      ? [zonedBoundary(`${startDate}T00:00`, dateConfig), zonedBoundary(`${endDate}T23:59:59.999`, dateConfig)]
      : [startDate, endDate],
  };
};
