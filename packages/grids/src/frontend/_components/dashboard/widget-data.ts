import {
  gridsService,
  type Widget,
  type StatSource,
  type Field,
  type Form,
  type GridRecord,
  type WidgetFormat,
} from "../../../service";
import type { AggregationSpec, GroupBySpec } from "../../../contracts";

/**
 * Runtime data shape per dashboard cell — what the SSR pipeline
 * computes once per widget and threads through to the renderer.
 * Five live kinds plus an `error` sentinel; the discriminant `kind`
 * matches the widget kind 1:1 so the renderer's switch is trivial.
 *
 * Errors surface as `kind: "error"` so a single bad widget doesn't
 * crash the whole dashboard — the cell renders a small red notice
 * inline and the rest of the dashboard keeps working.
 */
export type WidgetData =
  | {
      kind: "stat";
      value: unknown;
      /** Optional inline trend — last N bucket values, oldest first. */
      trend?: number[];
    }
  | {
      kind: "chart";
      /** Bucket rows from `record.group()`, already trimmed by `widget.limit`. */
      buckets: Array<{ keys: unknown[]; values: Record<string, unknown> }>;
      /** Fields of the SOURCE table (the view's table). The renderer
       *  uses them to label aggregations (`sum(Amount)`) and pick a
       *  numeric x-axis format. */
      fields: Field[];
      /** Echo of the view's groupBy / aggregations so the renderer
       *  can dispatch the bucket → series transform without re-fetching
       *  the view client-side. */
      viewQuery: {
        groupBy: GroupBySpec[];
        aggregations: AggregationSpec[];
      };
    }
  | {
      kind: "view";
      title: string;
      fields: Field[];
      records: GridRecord[];
      fullViewLink: { tableShortId: string; viewShortId: string } | null;
    }
  | {
      kind: "view-stats";
      title: string;
      cells: ViewStatsCell[];
      notice: string | null;
      fullViewLink: { tableShortId: string; viewShortId: string } | null;
    }
  | {
      kind: "form";
      form: Form;
      fields: Field[];
      /** True when the viewer has form-write OR table-write on this
       *  form's target — the same gate `/api/grids/forms/:formId/submit`
       *  enforces. Resolved SSR-side so the renderer can swap to a
       *  read-only placeholder without an extra client-side perm
       *  fetch. Default true if no viewer context is supplied (legacy
       *  callers / scripts that don't carry a user). */
      canSubmit: boolean;
    }
  | { kind: "error"; reason: string };

/** Cells produced by the view-stats resolver — one entry per derived
 *  stat. Format is inferred from the source field type or the agg
 *  kind, so the user does no per-cell configuration. */
export type ViewStatsCell = {
  label: string;
  value: unknown;
  format: WidgetFormat;
};

export const EMBEDDED_VIEW_PAGESIZE = 25;

/**
 * Viewer context threaded into the widget resolvers — drives per-
 * widget permission gates (form submit, relation expansion). `isAdmin`
 * bypasses all gates so platform admins always see fully-rendered
 * dashboards, mirroring the API's `gateAt` convention.
 */
export type ViewerContext = {
  userId: string | null;
  userGroups: string[];
  /** True when the user has a platform-admin role. */
  isAdmin?: boolean;
};

/**
 * Resolves the data for a single widget against the live DB. Pure
 * server-side helper — never imported into the client bundle. Pulls
 * from the existing record / view / form services so permission
 * gating, filter compilation, and computed-projection enrichment
 * happen the same way the records page does them.
 *
 * The dashboard's base-read gate is the only top-level access check;
 * per-widget gates (form submit, target-table read for relation
 * expansion) are evaluated inside the per-kind resolvers using the
 * viewer context.
 */
export const resolveWidgetData = async (
  widget: Widget,
  viewer: ViewerContext,
): Promise<WidgetData> => {
  try {
    switch (widget.kind) {
      case "stat":
        return await resolveStat(widget.source);
      case "chart":
        return await resolveChart(widget);
      case "view":
        return await resolveView(widget, viewer);
      case "view-stats":
        return await resolveViewStats(widget);
      case "form":
        return await resolveForm(widget, viewer);
    }
  } catch (e) {
    return { kind: "error", reason: e instanceof Error ? e.message : "unknown error" };
  }
};

// =============================================================================
// stat
// =============================================================================

const resolveStat = async (source: StatSource): Promise<WidgetData> => {
  const agg = source.aggregations[0];
  if (!agg) return { kind: "error", reason: "stat widget has no aggregation" };
  const aggKey = `${agg.fieldId}__${agg.agg}`;
  // Main scalar aggregation + optional trend group query run in
  // parallel — the trend is independent of the scalar and would
  // otherwise serialise two roundtrips for one widget.
  const [scalar, trend] = await Promise.all([
    gridsService.record.aggregate({
      tableId: source.tableId,
      filter: source.filter ?? null,
      requests: [{ fieldId: agg.fieldId, agg: agg.agg }],
    }),
    source.trend ? resolveStatTrend(source, aggKey) : Promise.resolve<number[] | null>(null),
  ]);
  if (!scalar.ok) return { kind: "error", reason: scalar.error.message };
  return {
    kind: "stat",
    value: scalar.data[aggKey] ?? null,
    ...(trend && trend.length > 0 ? { trend } : {}),
  };
};

const resolveStatTrend = async (
  source: StatSource,
  aggKey: string,
): Promise<number[] | null> => {
  if (!source.trend) return null;
  const agg = source.aggregations[0];
  if (!agg) return null;
  try {
    const result = await gridsService.record.group({
      tableId: source.tableId,
      filter: source.filter ?? null,
      groupBy: [{ fieldId: source.trend.fieldId, granularity: source.trend.granularity }],
      aggregations: [
        {
          fieldId: agg.fieldId,
          agg: agg.agg as "count" | "countEmpty" | "countUnique" | "sum" | "avg" | "min" | "max",
        },
      ],
    });
    if (!result.ok) return null;
    const tail = result.data.buckets.slice(-source.trend.windowSize);
    const numbers: number[] = [];
    for (const b of tail) {
      const raw = b.values[aggKey];
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
      if (Number.isFinite(n)) numbers.push(n);
    }
    return numbers;
  } catch {
    return null;
  }
};

// =============================================================================
// chart — reads from a saved view (filter + groupBy + aggregations come
// from view.query), optionally trims to the most-recent `limit` buckets.
// =============================================================================

const resolveChart = async (
  widget: Extract<Widget, { kind: "chart" }>,
): Promise<WidgetData> => {
  const view = await gridsService.view.get(widget.viewId);
  if (!view) return { kind: "error", reason: "source view not found" };
  const groupBy = view.query.groupBy ?? [];
  const aggregations = view.query.aggregations ?? [];
  if (groupBy.length === 0 || aggregations.length === 0) {
    return {
      kind: "error",
      reason: "chart source view must be grouped with at least one aggregation",
    };
  }
  const [result, fields] = await Promise.all([
    gridsService.record.group({
      tableId: view.tableId,
      filter: view.query.filter ?? null,
      groupBy,
      aggregations: aggregations.map((a) => ({
        fieldId: a.fieldId,
        agg: a.agg as "count" | "countEmpty" | "countUnique" | "sum" | "avg" | "min" | "max",
      })),
    }),
    gridsService.field.listByTable(view.tableId),
  ]);
  if (!result.ok) return { kind: "error", reason: result.error.message };
  // `limit` trims from the END (most-recent buckets) — matches the
  // sparkline-trend window convention so "Last 12 months" reads
  // identically across chart cells and stat-trend sparklines.
  const buckets = widget.limit
    ? result.data.buckets.slice(-widget.limit)
    : result.data.buckets;
  return {
    kind: "chart",
    buckets,
    fields,
    viewQuery: { groupBy, aggregations },
  };
};

// =============================================================================
// view — embedded read-only table of a saved view OR a raw table
// =============================================================================

const resolveView = async (
  widget: Extract<Widget, { kind: "view" }>,
  viewer: ViewerContext,
): Promise<WidgetData> => {
  if (widget.source.kind === "view") {
    return resolveSavedView(widget.source.viewId, widget.title, viewer);
  }
  return resolveRawTable(widget.source.tableId, widget.title, viewer);
};

const resolveSavedView = async (
  viewId: string,
  titleOverride: string | undefined,
  viewer: ViewerContext,
): Promise<WidgetData> => {
  const view = await gridsService.view.get(viewId);
  if (!view) return { kind: "error", reason: "view not found" };
  const table = await gridsService.table.get(view.tableId);
  if (!table) return { kind: "error", reason: "view's parent table not found" };
  // includeRelations=true with viewer ⇒ expansion is permission-gated:
  // relation cells pointing at tables the viewer can't read aren't
  // expanded, so DatabaseTable falls back to UUID prefix for those.
  const records = await gridsService.record.list({
    tableId: view.tableId,
    filter: view.query.filter ?? null,
    sort: view.query.sort ?? [],
    limit: EMBEDDED_VIEW_PAGESIZE,
    includeRelations: true,
    viewer,
  });
  if (!records.ok) return { kind: "error", reason: records.error.message };
  return {
    kind: "view",
    title: titleOverride ?? view.name,
    fields: records.data.fields,
    records: records.data.items,
    fullViewLink: { tableShortId: table.shortId, viewShortId: view.shortId },
  };
};

const resolveRawTable = async (
  tableId: string,
  titleOverride: string | undefined,
  viewer: ViewerContext,
): Promise<WidgetData> => {
  const table = await gridsService.table.get(tableId);
  if (!table) return { kind: "error", reason: "table not found" };
  const records = await gridsService.record.list({
    tableId,
    limit: EMBEDDED_VIEW_PAGESIZE,
    includeRelations: true,
    viewer,
  });
  if (!records.ok) return { kind: "error", reason: records.error.message };
  return {
    kind: "view",
    title: titleOverride ?? table.name,
    fields: records.data.fields,
    records: records.data.items,
    fullViewLink: null,
  };
};

// =============================================================================
// view-stats — auto-derived 2×N stat grid from a view's first row /
// first bucket. Same logic as the deprecated `view-stats` row type,
// just lifted to cell level (the cell renders an internal 2-column
// hairline grid within its single paper slot).
// =============================================================================

const resolveViewStats = async (
  widget: Extract<Widget, { kind: "view-stats" }>,
): Promise<WidgetData> => {
  const titleFallback = widget.title ?? "View stats";
  const view = await gridsService.view.get(widget.viewId);
  if (!view) {
    return {
      kind: "view-stats",
      title: titleFallback,
      cells: [],
      notice: "view not found",
      fullViewLink: null,
    };
  }
  const table = await gridsService.table.get(view.tableId);
  if (!table) {
    return {
      kind: "view-stats",
      title: widget.title ?? view.name,
      cells: [],
      notice: "view's parent table not found",
      fullViewLink: null,
    };
  }
  const link = { tableShortId: table.shortId, viewShortId: view.shortId };
  const title = widget.title ?? view.name;
  const isGrouped = (view.query.groupBy ?? []).length > 0;
  if (isGrouped) {
    return await resolveGroupedViewStats(view, title, link);
  }
  return await resolveUngroupedViewStats(view, title, link);
};

const resolveUngroupedViewStats = async (
  view: NonNullable<Awaited<ReturnType<typeof gridsService.view.get>>>,
  title: string,
  link: { tableShortId: string; viewShortId: string },
): Promise<WidgetData> => {
  const fields = await gridsService.field.listByTable(view.tableId);
  const visible = fields
    .filter((f) => !f.deletedAt && !f.hideInTable)
    .sort((a, b) => a.position - b.position);
  if (visible.length === 0) {
    return {
      kind: "view-stats",
      title,
      cells: [],
      notice: "view has no visible fields",
      fullViewLink: link,
    };
  }
  const result = await gridsService.record.list({
    tableId: view.tableId,
    filter: view.query.filter ?? null,
    sort: view.query.sort ?? [],
    limit: 1,
  });
  if (!result.ok) {
    return {
      kind: "view-stats",
      title,
      cells: [],
      notice: result.error.message,
      fullViewLink: link,
    };
  }
  const first = result.data.items[0];
  if (!first) {
    return {
      kind: "view-stats",
      title,
      cells: [],
      notice: "view has no records",
      fullViewLink: link,
    };
  }
  const cells: ViewStatsCell[] = visible.map((f) => ({
    label: f.name,
    value: first.data[f.id] ?? null,
    format: inferFormatFromField(f),
  }));
  return { kind: "view-stats", title, cells, notice: null, fullViewLink: link };
};

const resolveGroupedViewStats = async (
  view: NonNullable<Awaited<ReturnType<typeof gridsService.view.get>>>,
  title: string,
  link: { tableShortId: string; viewShortId: string },
): Promise<WidgetData> => {
  const aggs = view.query.aggregations ?? [];
  if (aggs.length === 0) {
    return {
      kind: "view-stats",
      title,
      cells: [],
      notice: "view has no aggregations",
      fullViewLink: link,
    };
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
    return {
      kind: "view-stats",
      title,
      cells: [],
      notice: result.error.message,
      fullViewLink: link,
    };
  }
  const first = result.data.buckets[0];
  if (!first) {
    return {
      kind: "view-stats",
      title,
      cells: [],
      notice: "view has no buckets",
      fullViewLink: link,
    };
  }
  const cells: ViewStatsCell[] = aggs.map((a) => {
    const key = `${a.fieldId}__${a.agg}`;
    const targetField = a.fieldId === "*" ? null : (fieldsById.get(a.fieldId) ?? null);
    const fallbackLabel =
      a.fieldId === "*" ? `${a.agg}(*)` : `${a.agg}(${targetField?.name ?? "?"})`;
    return {
      label: a.label ?? fallbackLabel,
      value: first.values[key] ?? null,
      format: inferFormatFromAgg(a.agg, targetField),
    };
  });
  return { kind: "view-stats", title, cells, notice: null, fullViewLink: link };
};

// =============================================================================
// form — load the form definition + its parent table's fields so the
// renderer can build the input UI. Submit-permission gating is filed
// as a follow-up; for v1 the cell always renders the form, and submit
// can fail server-side when the viewer lacks form-write or table-write.
// =============================================================================

const resolveForm = async (
  widget: Extract<Widget, { kind: "form" }>,
  viewer: ViewerContext,
): Promise<WidgetData> => {
  const form = await gridsService.form.get(widget.formId);
  if (!form) return { kind: "error", reason: "form not found" };
  // Need the parent table to (a) read its baseId for the perm
  // resolution, and (b) hand the renderer the field schema.
  const [table, fields] = await Promise.all([
    gridsService.table.get(form.tableId),
    gridsService.field.listByTable(form.tableId),
  ]);
  if (!table) return { kind: "error", reason: "form's parent table not found" };

  // Submit gate — same rule the API enforces: form-write OR
  // table-write (most-specific-wins resolution makes table-write
  // automatically pass). Resolved SSR-side so the renderer can swap
  // to a dimmed placeholder when the viewer lacks access, with zero
  // extra client-side network calls.
  const canSubmit = viewer.isAdmin
    ? true
    : await resolveSubmitPermission(viewer, table.baseId, form.tableId, form.id);

  return { kind: "form", form, fields, canSubmit };
};

/** Loads the viewer's grants for the form-target chain (base → table →
 *  form) and resolves to a single effective level. Returns true when
 *  that level is `write` or higher, false otherwise. One DB roundtrip
 *  per form-cell — `loadGrantsForUser` already collapses the five
 *  resource legs into a single UNION ALL query. */
const resolveSubmitPermission = async (
  viewer: ViewerContext,
  baseId: string,
  tableId: string,
  formId: string,
): Promise<boolean> => {
  const grants = await gridsService.permission.loadGrants({
    userId: viewer.userId,
    userGroups: viewer.userGroups,
    baseId,
    tableId,
    formId,
  });
  const level = gridsService.permission.resolve(grants, { baseId, tableId, formId });
  return gridsService.permission.hasAtLeast(level, "write");
};

// =============================================================================
// shared helpers (format inference) — same heuristics the records page uses.
// =============================================================================

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

const inferFormatFromAgg = (agg: string, targetField: Field | null): WidgetFormat => {
  if (agg === "count" || agg === "countEmpty" || agg === "countUnique") {
    return "integer";
  }
  return targetField ? inferFormatFromField(targetField) : "plain";
};
