import {
  gridsService,
  type Widget,
  type WidgetSource,
  type ViewWidgetSource,
  type ViewStatsRow,
  type Field,
  type GridRecord,
  type WidgetFormat,
} from "../../../service";

/**
 * Runtime data shape for a rendered widget — what the SSR pipeline
 * computes once per widget and threads through to the cell components.
 * Stat / chart variants carry already-evaluated values; the view
 * variant carries pre-fetched records + fields for the embedded
 * read-only table. View-stats rows have their own resolver
 * (`resolveViewStatsRow`) that returns derived cells, keyed by row
 * id rather than widget id.
 *
 * Errors surface as a `kind: "error"` discriminant so a single bad
 * widget doesn't crash the whole dashboard.
 */
export type WidgetData =
  | { kind: "stat"; value: unknown }
  | { kind: "chart"; buckets: Array<{ keys: unknown[]; values: Record<string, unknown> }> }
  | {
      kind: "view";
      title: string;
      fields: Field[];
      records: GridRecord[];
      fullViewLink: { tableSlug: string; viewSlug: string } | null;
    }
  | { kind: "error"; reason: string };

/** Cells produced by `resolveViewStatsRow` — one entry per derived
 *  stat. Format is inferred from the source field type or the agg
 *  kind, so the user does no per-cell configuration. */
export type ViewStatsCell = {
  label: string;
  value: unknown;
  format: WidgetFormat;
};

/** Resolved view-stats payload threaded through to the renderer.
 *  When the source view is empty / missing / mis-shaped, `cells` is
 *  empty and `notice` carries a one-liner the renderer surfaces
 *  inline. */
export type ViewStatsRowData = {
  title: string;
  cells: ViewStatsCell[];
  notice: string | null;
  /** Drilldown link to the source view's full records page. Null
   *  when the source view was deleted (no slug to link to). */
  fullViewLink: { tableSlug: string; viewSlug: string } | null;
};

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
    return { kind: "error", reason: e instanceof Error ? e.message : "unknown error" };
  }
};

const resolveStat = async (source: WidgetSource): Promise<WidgetData> => {
  const agg = source.aggregations[0];
  if (!agg) return { kind: "error", reason: "stat widget has no aggregation" };
  const result = await gridsService.record.aggregate({
    tableId: source.tableId,
    filter: source.filter ?? null,
    requests: [{ fieldId: agg.fieldId, agg: agg.agg }],
  });
  if (!result.ok) return { kind: "error", reason: result.error.message };
  const key = `${agg.fieldId}__${agg.agg}`;
  return { kind: "stat", value: result.data[key] ?? null };
};

const resolveChart = async (source: WidgetSource): Promise<WidgetData> => {
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

// =============================================================================
// view-stats row resolver
// =============================================================================

/**
 * Resolves a `view-stats` row into a list of cells. Auto-detects the
 * view's shape from `view.query.groupBy.length`:
 *
 *  - ungrouped → take first record, render one cell per visible field
 *    of the parent table. Cell label = field name, value = record
 *    cell, format = inferred from field type.
 *  - grouped → take first bucket, render one cell per aggregation in
 *    `view.query.aggregations`. Label = `agg.label` or
 *    `<agg>(<field>)`, value = bucket value, format = inferred from
 *    agg kind + target field type.
 *
 *  When the source has no rows / buckets, `cells` is empty and
 *  `notice` carries a short reason for the renderer to display
 *  inline. `fullViewLink` is null only when the source view doesn't
 *  exist (so the drilldown link is hidden); a present-but-empty view
 *  keeps the link so the user can fix it.
 */
export const resolveViewStatsRow = async (
  row: ViewStatsRow,
): Promise<ViewStatsRowData> => {
  const titleFallback = row.title ?? "View stats";
  try {
    const view = await gridsService.view.get(row.viewId);
    if (!view) {
      return {
        title: titleFallback,
        cells: [],
        notice: "view not found",
        fullViewLink: null,
      };
    }
    const table = await gridsService.table.get(view.tableId);
    if (!table) {
      return {
        title: row.title ?? view.name,
        cells: [],
        notice: "view's parent table not found",
        fullViewLink: null,
      };
    }
    const link = { tableSlug: table.slug, viewSlug: view.slug };
    const title = row.title ?? view.name;
    const isGrouped = (view.query.groupBy ?? []).length > 0;
    if (isGrouped) {
      return resolveGroupedViewStats(view, title, link);
    }
    return resolveUngroupedViewStats(view, title, link);
  } catch (e) {
    return {
      title: titleFallback,
      cells: [],
      notice: e instanceof Error ? e.message : "unknown error",
      fullViewLink: null,
    };
  }
};

const resolveUngroupedViewStats = async (
  view: NonNullable<Awaited<ReturnType<typeof gridsService.view.get>>>,
  title: string,
  link: { tableSlug: string; viewSlug: string },
): Promise<ViewStatsRowData> => {
  const fields = await gridsService.field.listByTable(view.tableId);
  const visible = fields
    .filter((f) => !f.deletedAt && !f.hideInTable)
    .sort((a, b) => a.position - b.position);
  if (visible.length === 0) {
    return { title, cells: [], notice: "view has no visible fields", fullViewLink: link };
  }
  const result = await gridsService.record.list({
    tableId: view.tableId,
    filter: view.query.filter ?? null,
    sort: view.query.sort ?? [],
    limit: 1,
  });
  if (!result.ok) {
    return { title, cells: [], notice: result.error.message, fullViewLink: link };
  }
  const first = result.data.items[0];
  if (!first) {
    return { title, cells: [], notice: "view has no records", fullViewLink: link };
  }
  const cells: ViewStatsCell[] = visible.map((f) => ({
    label: f.name,
    value: first.data[f.id] ?? null,
    format: inferFormatFromField(f),
  }));
  return { title, cells, notice: null, fullViewLink: link };
};

const resolveGroupedViewStats = async (
  view: NonNullable<Awaited<ReturnType<typeof gridsService.view.get>>>,
  title: string,
  link: { tableSlug: string; viewSlug: string },
): Promise<ViewStatsRowData> => {
  const aggs = view.query.aggregations ?? [];
  if (aggs.length === 0) {
    return { title, cells: [], notice: "view has no aggregations", fullViewLink: link };
  }
  const fields = await gridsService.field.listByTable(view.tableId);
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const result = await gridsService.record.group({
    tableId: view.tableId,
    filter: view.query.filter ?? null,
    groupBy: view.query.groupBy ?? [],
    aggregations: aggs.map((a) => ({
      fieldId: a.fieldId,
      agg: a.agg as "count" | "countEmpty" | "countUnique" | "sum" | "avg" | "min" | "max",
    })),
    limit: 1,
  });
  if (!result.ok) {
    return { title, cells: [], notice: result.error.message, fullViewLink: link };
  }
  const first = result.data.buckets[0];
  if (!first) {
    return { title, cells: [], notice: "view has no buckets", fullViewLink: link };
  }
  const cells: ViewStatsCell[] = aggs.map((a) => {
    const key = `${a.fieldId}__${a.agg}`;
    const targetField = a.fieldId === "*" ? null : fieldsById.get(a.fieldId) ?? null;
    const fallbackLabel =
      a.fieldId === "*"
        ? `${a.agg}(*)`
        : `${a.agg}(${targetField?.name ?? "?"})`;
    return {
      label: a.label ?? fallbackLabel,
      value: first.values[key] ?? null,
      format: inferFormatFromAgg(a.agg, targetField),
    };
  });
  return { title, cells, notice: null, fullViewLink: link };
};

/** Maps a field's type to the matching widget format. Currency,
 *  percent, integer-only number map directly; everything else falls
 *  back to plain. */
const inferFormatFromField = (field: Field): WidgetFormat => {
  if (field.type === "currency") return "currency";
  if (field.type === "percent") return "percent";
  if (field.type === "rating") return "integer";
  if (field.type === "number") {
    const cfg = field.config as { integerOnly?: boolean };
    return cfg.integerOnly ? "integer" : "plain";
  }
  return "plain";
};

/** Same heuristic for grouped aggs. Counts are always integer; sum/
 *  avg/min/max inherit from the target field. */
const inferFormatFromAgg = (
  agg: string,
  targetField: Field | null,
): WidgetFormat => {
  if (agg === "count" || agg === "countEmpty" || agg === "countUnique") {
    return "integer";
  }
  return targetField ? inferFormatFromField(targetField) : "plain";
};
