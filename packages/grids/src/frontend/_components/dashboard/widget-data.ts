import {
  gridsService,
  type Widget,
  type WidgetSource,
  type ViewWidgetSource,
  type StatSource,
  type StatWidget,
  type Field,
  type GridRecord,
} from "../../../service";

/**
 * Runtime data shape for a rendered widget — what the SSR pipeline
 * computes once per widget and threads through to the cell components.
 * The stat / chart variants carry already-evaluated numbers so the
 * frontend doesn't re-call the API; the view variant carries enough
 * pre-fetched state for the embedded RecordsView to mount without a
 * client-side roundtrip on first paint.
 *
 * Errors are surfaced as a `kind: "error"` discriminant so the cell
 * renderer can paint a small "couldn't load" badge in red without the
 * page-level fetcher having to bubble exceptions through Promise.all.
 *
 * The view variant abstracts over both source kinds (saved view OR
 * raw table) — the renderer only cares about records + fields + an
 * optional "Open full view" deep-link. The link is only present when
 * the source is a saved view; raw-table sources don't have a natural
 * destination, so the header link is suppressed by the renderer.
 */
export type WidgetData =
  | { kind: "stat"; value: unknown }
  | { kind: "chart"; buckets: Array<{ keys: unknown[]; values: Record<string, unknown> }> }
  | {
      kind: "view";
      title: string;
      fields: Field[];
      records: GridRecord[];
      /** Deep-link target when source is a saved view; null for raw
       *  table sources so the "Open full view" header link is hidden. */
      fullViewLink: { tableSlug: string; viewSlug: string } | null;
    }
  | { kind: "error"; reason: string };

/** Fixed pagesize for embedded views — agreed in the dashboard plan
 *  ("kein scrolling, drilldown via Open full view link"). Enough rows
 *  to feel useful on a wide desktop, not so many that loading three
 *  view widgets on one dashboard becomes slow. */
export const EMBEDDED_VIEW_PAGESIZE = 25;

/**
 * Resolves the data for a single widget against the live DB. Pure
 * server-side helper — never imported into the client bundle. Pulls
 * from the existing record/view services so permission gating, filter
 * compilation, and computed-projection enrichment happen the same way
 * the records page does them.
 *
 * Per the agreed permission model, the dashboard's base-read gate is
 * the only access check; this function does not re-cascade per-source.
 * If a viewer of a shared dashboard can't read the underlying view or
 * table, that's a configuration choice surfaced in the settings hint
 * card — not something the renderer should soften.
 */
export const resolveWidgetData = async (
  widget: Widget,
  viewer: { userId: string | null; userGroups: string[] },
  viewCellCache?: ViewCellCache,
): Promise<WidgetData> => {
  try {
    if (widget.kind === "stat") {
      return await resolveStat(widget.source, viewCellCache);
    }
    if (widget.kind === "chart") {
      return await resolveChart(widget.source);
    }
    return await resolveView(widget);
  } catch (e) {
    // Last-ditch catch: anything thrown becomes a renderable error
    // sentinel so a single bad widget doesn't crash the whole dashboard.
    return { kind: "error", reason: e instanceof Error ? e.message : "unknown error" };
  }
};

const resolveStat = async (
  source: StatSource,
  viewCellCache?: ViewCellCache,
): Promise<WidgetData> => {
  if (source.kind === "table-aggregate") {
    return resolveTableAggregate(source);
  }
  return resolveViewCell(source, viewCellCache);
};

const resolveTableAggregate = async (
  source: Extract<StatSource, { kind: "table-aggregate" }>,
): Promise<WidgetData> => {
  // Stat widgets carry exactly one aggregation (enforced at edit time).
  const agg = source.aggregations[0];
  if (!agg) return { kind: "error", reason: "stat widget has no aggregation" };
  const result = await gridsService.record.aggregate({
    tableId: source.tableId,
    filter: source.filter ?? null,
    requests: [{ fieldId: agg.fieldId, agg: agg.agg }],
  });
  if (!result.ok) return { kind: "error", reason: result.error.message };
  const key = `${agg.fieldId}__${agg.agg}`;
  const value = result.data[key];
  return { kind: "stat", value: value ?? null };
};

/**
 * Cache of pre-fetched view results, keyed by viewId. Built once per
 * dashboard render in `prefetchViewCells` and threaded through
 * `resolveStat` so multiple stats sourcing from the same view share a
 * single DB query. Each entry holds whatever shape the view query
 * produced — records for ungrouped views, buckets for grouped ones.
 */
export type ViewCellCache = Map<
  string,
  | { kind: "records"; records: GridRecord[]; fields: Field[] }
  | {
      kind: "buckets";
      buckets: Array<{ keys: unknown[]; values: Record<string, unknown> }>;
    }
  | { kind: "error"; reason: string }
>;

/**
 * Pre-fetches every unique source view referenced by a `view-cell`
 * stat across the dashboard. Returns a cache the per-stat resolver
 * reads from instead of re-querying. Net effect: N stats sourcing
 * from the same view = 1 DB query, not N.
 *
 * The cache key is just the viewId; identical filter/sort sets in
 * the view's saved query mean the same result, so no extra hashing
 * is needed.
 */
export const prefetchViewCells = async (
  widgets: StatWidget[],
): Promise<ViewCellCache> => {
  const cache: ViewCellCache = new Map();
  const viewIds = new Set<string>();
  for (const w of widgets) {
    if (w.source.kind === "view-cell") viewIds.add(w.source.viewId);
  }
  await Promise.all(
    [...viewIds].map(async (viewId) => {
      try {
        const view = await gridsService.view.get(viewId);
        if (!view) {
          cache.set(viewId, { kind: "error", reason: "view not found" });
          return;
        }
        const isGrouped = (view.query.groupBy ?? []).length > 0;
        if (isGrouped) {
          const result = await gridsService.record.group({
            tableId: view.tableId,
            filter: view.query.filter ?? null,
            groupBy: view.query.groupBy ?? [],
            // Same agg-kind narrowing as resolveChart — group-compiler
            // doesn't accept median/earliest/latest. Views in the
            // current product can only be saved with the narrower
            // set, so this cast is safe in practice.
            aggregations: (view.query.aggregations ?? []).map((a) => ({
              fieldId: a.fieldId,
              agg: a.agg as "count" | "countEmpty" | "countUnique" | "sum" | "avg" | "min" | "max",
            })),
            limit: view.query.limit,
          });
          if (!result.ok) {
            cache.set(viewId, { kind: "error", reason: result.error.message });
            return;
          }
          cache.set(viewId, { kind: "buckets", buckets: result.data.buckets });
        } else {
          const fields = await gridsService.field.listByTable(view.tableId);
          const result = await gridsService.record.list({
            tableId: view.tableId,
            filter: view.query.filter ?? null,
            sort: view.query.sort ?? [],
            limit: view.query.limit ?? 1000,
          });
          if (!result.ok) {
            cache.set(viewId, { kind: "error", reason: result.error.message });
            return;
          }
          cache.set(viewId, {
            kind: "records",
            records: result.data.items,
            fields,
          });
        }
      } catch (e) {
        cache.set(viewId, {
          kind: "error",
          reason: e instanceof Error ? e.message : "unknown error",
        });
      }
    }),
  );
  return cache;
};

const resolveViewCell = async (
  source: Extract<StatSource, { kind: "view-cell" }>,
  cache: ViewCellCache | undefined,
): Promise<WidgetData> => {
  const cached = cache?.get(source.viewId);
  if (!cached) {
    // Fallback path when the caller didn't pre-fetch — happens for
    // unit tests and one-off widget renders. Builds a single-entry
    // cache on the fly.
    const oneShot = await prefetchViewCells([
      { id: "_", kind: "stat", source } as StatWidget,
    ]);
    return resolveViewCell(source, oneShot);
  }
  if (cached.kind === "error") {
    return { kind: "error", reason: cached.reason };
  }
  const ref = source.cellRef;
  if (ref.kind === "record" && cached.kind === "records") {
    const rec = cached.records.find((r) => r.id === ref.recordId);
    if (!rec) return { kind: "error", reason: "row removed" };
    return { kind: "stat", value: rec.data[ref.fieldId] ?? null };
  }
  if (ref.kind === "bucket" && cached.kind === "buckets") {
    const bucket = cached.buckets.find((b) => keysEqual(b.keys, ref.groupKey));
    if (!bucket) return { kind: "error", reason: "no data for that group" };
    return { kind: "stat", value: bucket.values[ref.aggregationKey] ?? null };
  }
  // Shape mismatch: cell-ref kind doesn't match the view's actual
  // shape (e.g. a record cell on a now-grouped view). Surface as an
  // error so the dashboard author notices and reconfigures.
  return {
    kind: "error",
    reason: "cell ref doesn't match the view's current shape",
  };
};

const keysEqual = (a: unknown[], b: unknown[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    // Loose equality covers number-vs-string drift in JSONB; the
    // group compiler can return numerics either way depending on
    // the projection. Anything more rigorous would need per-field
    // type knowledge here.
    // eslint-disable-next-line eqeqeq
    if (a[i] != b[i]) return false;
  }
  return true;
};

const resolveChart = async (source: WidgetSource): Promise<WidgetData> => {
  // Chart widgets use AggregationSpec which carries the wider agg
  // kind union (median/earliest/latest) — record.group only accepts
  // the narrower GroupAggregationSpec. P1 (chart renderer) will
  // narrow this at the schema level; for now we strip the extra
  // label and let the compiler reject any chart that picks an
  // unsupported agg.
  const result = await gridsService.record.group({
    tableId: source.tableId,
    filter: source.filter ?? null,
    groupBy: source.groupBy ?? [],
    aggregations: source.aggregations.map((a) => ({
      fieldId: a.fieldId,
      agg: a.agg as "count" | "countEmpty" | "countUnique" | "sum" | "avg" | "min" | "max",
    })),
    limit: source.limit,
  });
  if (!result.ok) return { kind: "error", reason: result.error.message };
  return { kind: "chart", buckets: result.data.buckets };
};

const resolveView = async (widget: {
  source: ViewWidgetSource;
  title?: string;
}): Promise<WidgetData> => {
  if (widget.source.kind === "view") {
    return resolveSavedView(widget.source.viewId, widget.title);
  }
  return resolveRawTable(widget.source.tableId, widget.title);
};

const resolveSavedView = async (
  viewId: string,
  titleOverride: string | undefined,
): Promise<WidgetData> => {
  const view = await gridsService.view.get(viewId);
  if (!view) return { kind: "error", reason: "view not found" };
  const fields = await gridsService.field.listByTable(view.tableId);
  const table = await gridsService.table.get(view.tableId);
  if (!table) return { kind: "error", reason: "view's parent table not found" };
  const records = await gridsService.record.list({
    tableId: view.tableId,
    filter: view.query.filter ?? null,
    sort: view.query.sort ?? [],
    limit: EMBEDDED_VIEW_PAGESIZE,
  });
  if (!records.ok) return { kind: "error", reason: records.error.message };
  return {
    kind: "view",
    title: titleOverride ?? view.name,
    fields,
    records: records.data.items,
    fullViewLink: { tableSlug: table.slug, viewSlug: view.slug },
  };
};

const resolveRawTable = async (
  tableId: string,
  titleOverride: string | undefined,
): Promise<WidgetData> => {
  const table = await gridsService.table.get(tableId);
  if (!table) return { kind: "error", reason: "table not found" };
  const fields = await gridsService.field.listByTable(tableId);
  // No filter/sort — raw-table source intentionally shows the latest
  // 25 records as-is. Users wanting filtering should save a view.
  const records = await gridsService.record.list({
    tableId,
    limit: EMBEDDED_VIEW_PAGESIZE,
  });
  if (!records.ok) return { kind: "error", reason: records.error.message };
  return {
    kind: "view",
    title: titleOverride ?? table.name,
    fields,
    records: records.data.items,
    fullViewLink: null,
  };
};
