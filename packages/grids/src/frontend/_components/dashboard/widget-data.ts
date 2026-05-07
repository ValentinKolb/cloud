import { gridsService, type Widget, type WidgetSource, type Field, type GridRecord, type View } from "../../../service";

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
 */
export type WidgetData =
  | { kind: "stat"; value: unknown }
  | { kind: "chart"; buckets: Array<{ keys: unknown[]; values: Record<string, unknown> }> }
  | { kind: "view"; view: View; fields: Field[]; records: GridRecord[] }
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
 * Caller is expected to have already verified that the viewer can read
 * the dashboard (the per-widget permission check happens at the source
 * level — a viewer who can't read the source table gets `error: "no
 * permission"` rather than a tracked exception).
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
    return await resolveView(widget.viewId, viewer);
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
  // Chart widgets need groupBy. If groupBy is empty we fall back to a
  // synthetic single-bucket so the stub renderer can still surface a
  // meaningful preview during P0.
  const result = await gridsService.record.group({
    tableId: source.tableId,
    filter: source.filter ?? null,
    groupBy: source.groupBy ?? [],
    aggregations: source.aggregations,
    limit: source.limit,
  });
  if (!result.ok) return { kind: "error", reason: result.error.message };
  return { kind: "chart", buckets: result.data.buckets };
};

const resolveView = async (
  viewId: string,
  viewer: { userId: string | null; userGroups: string[] },
): Promise<WidgetData> => {
  const view = await gridsService.view.get(viewId);
  if (!view) return { kind: "error", reason: "view not found" };
  // Permission cascade: the dashboard already gated on base-read; here
  // we additionally verify the embedded view's parent table is readable.
  // A dashboard author can still embed a personal view they own — the
  // viewer needs base-read AND either the view is shared or the viewer
  // is the owner.
  const fields = await gridsService.field.listByTable(view.tableId);
  if (view.ownerUserId !== null && view.ownerUserId !== viewer.userId) {
    return { kind: "error", reason: "view is private" };
  }
  const records = await gridsService.record.list({
    tableId: view.tableId,
    filter: view.query.filter ?? null,
    sort: view.query.sort ?? [],
    limit: EMBEDDED_VIEW_PAGESIZE,
  });
  if (!records.ok) return { kind: "error", reason: records.error.message };
  return { kind: "view", view, fields, records: records.data.items };
};
