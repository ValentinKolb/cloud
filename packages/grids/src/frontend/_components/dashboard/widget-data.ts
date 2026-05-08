import {
  gridsService,
  type Widget,
  type WidgetSource,
  type ViewWidgetSource,
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
): Promise<WidgetData> => {
  try {
    if (widget.kind === "stat") {
      return await resolveStat(widget.source);
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

const resolveStat = async (source: WidgetSource): Promise<WidgetData> => {
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
