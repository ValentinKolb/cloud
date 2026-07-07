import { markdown } from "@valentinkolb/cloud/shared";
import type { DateContext } from "@valentinkolb/stdlib";
import {
  type AggregationSpec,
  type ColumnSpec,
  type ComputedColumnSpec,
  type GroupBySpec,
  type View,
  type RecordQuery,
  type Widget,
  type WidgetFormat,
  type DslQueryPreviewColumn,
  type DslQueryPreviewResponse,
} from "../contracts";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import { previewDslQuery } from "../query-dsl/preview";
import { type DslResolvedSqlQueryPlan, resolveDslQueryToQueryPlan, resolveDslQueryToRecordQuery } from "../query-dsl/resolver";
import { collectDslPlanExtraFieldTableIds } from "../query-dsl/source-plan";
import { aggregateOutputKey } from "./aggregate-capabilities";
import { canReadDashboardIncludedData } from "./dashboard-included-access";
import * as dashboards from "./dashboards";
import * as fields from "./fields";
import type { Form } from "./forms";
import * as forms from "./forms";
import { buildBaseGqlResolverContext } from "./gql-resolver-context";
import { hasAtLeast, hasGrantsForResource, loadGrantsForUser, resolveEffectivePermission } from "./permission-resolver";
import * as records from "./records";
import * as tables from "./tables";
import type { Field, GridRecord } from "./types";
import * as views from "./views";
import * as workflows from "./workflows";

const isComputedColumn = (column: ColumnSpec): column is ComputedColumnSpec => "kind" in column && column.kind === "computed";

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
      /** UUID → presentable label map for relation-typed bucket keys.
       *  Empty when no groupBy column is a relation. The renderer
       *  looks up bucket.keys[0] here BEFORE falling back to the raw
       *  string — without it, charts grouped by a relation field
       *  would show UUIDs on the axis. Same batched server-side
       *  resolution the records page uses for grouped relation cells. */
      relationLabels: Record<string, string>;
    }
  | {
      kind: "view";
      title: string;
      fields: Field[];
      records: GridRecord[];
      viewColumns?: ColumnSpec[];
      tableShortIds: Record<string, string>;
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
  | {
      kind: "markdown";
      html: string;
    }
  | {
      kind: "link";
      title: string;
      description: string | null;
      icon: string;
      target:
        | { kind: "dashboard"; dashboardId: string; dashboardShortId: string; name: string }
        | { kind: "table"; tableId: string; tableShortId: string; name: string }
        | { kind: "view"; viewId: string; viewShortId: string; tableShortId: string; name: string; tableName: string }
        | { kind: "form"; form: Form; fields: Field[]; tableName: string; canSubmit: boolean }
        | { kind: "url"; url: string }
        | { kind: "blocked"; reason: string };
    }
  | {
      kind: "workflow-button";
      workflowId: string;
      workflowName: string;
      title: string;
      description: string | null;
      buttonLabel: string;
      canRun: boolean;
      disabledReason: string | null;
    }
  | { kind: "error"; reason: string };

/** Cells produced by the view-stats resolver — one entry per derived
 *  stat. Format is inferred from the source field type or the agg
 *  kind, so the user does no per-cell configuration. */
type ViewStatsCell = {
  label: string;
  value: unknown;
  format: WidgetFormat;
};

const EMBEDDED_VIEW_PAGESIZE = 25;

/**
 * Viewer context threaded into the widget resolvers — drives per-
 * widget permission gates (form submit, relation expansion). `isAdmin`
 * is reserved for trusted internal preview/repair flows after their own
 * gate; platform-admin role alone must not set it for normal dashboards.
 */
type ViewerContext = {
  userId: string | null;
  userGroups: string[];
  /** True only for trusted internal renderer contexts. */
  isAdmin?: boolean;
};

type ResolveOptions = {
  dateConfig?: DateContext;
};

type DbRow = Record<string, unknown>;
type SavedView = NonNullable<Awaited<ReturnType<typeof views.get>>>;
type RuntimeView = SavedView & { query: RecordQuery };
type LinkWidget = Extract<Widget, { kind: "link" }>;
type WorkflowButtonWidget = Extract<Widget, { kind: "workflow-button" }>;
type LinkDataBase = {
  kind: "link";
  title: string;
  description: string | null;
  icon: string;
};

const withViewUiPresentation = (query: RecordQuery, view: Pick<View, "ui">): RecordQuery => ({
  ...query,
  ...(view.ui.columns ? { columns: view.ui.columns } : {}),
  ...(view.ui.groupedColumnOrder ? { groupedColumnOrder: view.ui.groupedColumnOrder } : {}),
  ...(view.ui.hiddenGroupedColumns ? { hiddenGroupedColumns: view.ui.hiddenGroupedColumns } : {}),
});

const compileRuntimeView = async (view: SavedView): Promise<RuntimeView | { error: string }> => {
  const table = await tables.get(view.tableId);
  if (!table) return { error: "view's parent table not found" };
  const parsed = parseGridsQueryDsl(view.source);
  if (!parsed.ok) return { error: parsed.diagnostics.map((diagnostic) => diagnostic.message).join("; ") || "invalid view source" };
  const context = await buildBaseGqlResolverContext({ baseId: table.baseId, currentTableId: view.tableId, ast: parsed.ast });
  const resolved = resolveDslQueryToRecordQuery(parsed.ast, context);
  if (!resolved.ok) return { error: resolved.diagnostics.map((diagnostic) => diagnostic.message).join("; ") || "invalid view source" };
  return { ...view, query: withViewUiPresentation(resolved.plan.query, view) };
};

type PreviewSuccess = Extract<DslQueryPreviewResponse, { ok: true }>;

const fieldsWithPlanExtras = async (
  fieldsByTableId: Record<string, Field[]>,
  plan: DslResolvedSqlQueryPlan,
): Promise<Record<string, Field[]>> => {
  const missing = collectDslPlanExtraFieldTableIds(plan).filter((tableId) => fieldsByTableId[tableId] === undefined);
  if (missing.length === 0) return fieldsByTableId;
  const groups = await Promise.all(missing.map(async (tableId) => ({ tableId, fields: await fields.listByTable(tableId) })));
  return { ...fieldsByTableId, ...Object.fromEntries(groups.map((group) => [group.tableId, group.fields])) };
};

const previewSavedView = async (
  view: SavedView,
  viewer: ViewerContext,
  options: ResolveOptions,
  limit?: number,
): Promise<{ view: SavedView; preview: PreviewSuccess; fieldsByTableId: Record<string, Field[]> } | { error: string }> => {
  const table = await tables.get(view.tableId);
  if (!table) return { error: "view's parent table not found" };
  const parsed = parseGridsQueryDsl(view.source);
  if (!parsed.ok) return { error: parsed.diagnostics.map((diagnostic) => diagnostic.message).join("; ") || "invalid view source" };
  const context = await buildBaseGqlResolverContext({ baseId: table.baseId, currentTableId: view.tableId, ast: parsed.ast });
  const resolved = resolveDslQueryToQueryPlan(parsed.ast, context);
  if (!resolved.ok) return { error: resolved.diagnostics.map((diagnostic) => diagnostic.message).join("; ") || "invalid view source" };
  const fieldsByTableId = await fieldsWithPlanExtras(context.fieldsByTableId, resolved.plan);
  const result = await previewDslQuery(resolved.plan, {
    fieldsByTableId,
    timeZone: options.dateConfig?.timeZone,
    limit,
    viewer,
  });
  if (!result.ok) return { error: result.error.message };
  return { view, preview: result.data, fieldsByTableId };
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
export const resolveWidgetData = async (widget: Widget, viewer: ViewerContext, options: ResolveOptions = {}): Promise<WidgetData> => {
  try {
    switch (widget.kind) {
      case "stat":
        return await resolveStat(widget, viewer, options);
      case "chart":
        return await resolveChart(widget, viewer, options);
      case "view":
        return await resolveView(widget, viewer, options);
      case "view-stats":
        return await resolveViewStats(widget, viewer, options);
      case "form":
        return await resolveForm(widget, viewer);
      case "markdown":
        return resolveMarkdown(widget);
      case "link":
        return await resolveLink(widget, viewer);
      case "workflow-button":
        return await resolveWorkflowButton(widget);
    }
  } catch (e) {
    return { kind: "error", reason: e instanceof Error ? e.message : "unknown error" };
  }
};

const resolveMarkdown = (widget: Extract<Widget, { kind: "markdown" }>): WidgetData => ({
  kind: "markdown",
  html: markdown.render(widget.markdown || ""),
});

const linkTitle = (widget: LinkWidget, fallback: string): string => widget.title?.trim() || fallback;
const linkDescription = (widget: LinkWidget, fallback: string | null | undefined): string | null =>
  widget.description?.trim() || fallback || null;

const linkBase = (widget: LinkWidget): LinkDataBase => ({
  kind: "link" as const,
  title: widget.title?.trim() || "Open",
  description: widget.description?.trim() || null,
  icon: widget.icon || iconForLinkTarget(widget.target.kind),
});

const resolveUrlLink = (widget: LinkWidget, base: LinkDataBase): WidgetData => ({
  ...base,
  target: { kind: "url", url: widget.target.kind === "url" ? widget.target.url : "" },
});

const resolveDashboardLink = async (widget: LinkWidget, base: LinkDataBase, viewer: ViewerContext): Promise<WidgetData> => {
  if (widget.target.kind !== "dashboard") return { kind: "error", reason: "invalid dashboard link target" };
  const dashboard = await dashboards.get(widget.target.dashboardId);
  if (!dashboard) return { kind: "error", reason: "dashboard not found" };
  if (!(await canReadDashboardTarget(dashboard, viewer))) {
    return blockedLinkData(base, "No access to this dashboard");
  }
  return {
    ...base,
    title: linkTitle(widget, dashboard.name),
    description: linkDescription(widget, dashboard.description),
    target: {
      kind: "dashboard",
      dashboardId: dashboard.id,
      dashboardShortId: dashboard.shortId,
      name: dashboard.name,
    },
  };
};

const resolveTableLink = async (widget: LinkWidget, base: LinkDataBase, viewer: ViewerContext): Promise<WidgetData> => {
  if (widget.target.kind !== "table") return { kind: "error", reason: "invalid table link target" };
  const table = await tables.get(widget.target.tableId);
  if (!table) return { kind: "error", reason: "table not found" };
  if (!(await canReadTableTarget(table, viewer))) {
    return blockedLinkData(base, "No access to this table");
  }
  return {
    ...base,
    title: linkTitle(widget, table.name),
    description: linkDescription(widget, table.description),
    target: { kind: "table", tableId: table.id, tableShortId: table.shortId, name: table.name },
  };
};

const resolveViewLink = async (widget: LinkWidget, base: LinkDataBase, viewer: ViewerContext): Promise<WidgetData> => {
  if (widget.target.kind !== "view") return { kind: "error", reason: "invalid view link target" };
  const view = await views.get(widget.target.viewId);
  if (!view) return { kind: "error", reason: "view not found" };
  const table = await tables.get(view.tableId);
  if (!table) return { kind: "error", reason: "view's parent table not found" };
  if (!(await canReadViewTarget(view, table.baseId, viewer))) {
    return blockedLinkData(base, "No access to this view");
  }
  return {
    ...base,
    title: linkTitle(widget, view.name),
    target: {
      kind: "view",
      viewId: view.id,
      viewShortId: view.shortId,
      tableShortId: table.shortId,
      name: view.name,
      tableName: table.name,
    },
  };
};

const resolveFormLink = async (widget: LinkWidget, base: LinkDataBase, viewer: ViewerContext): Promise<WidgetData> => {
  if (widget.target.kind !== "form") return { kind: "error", reason: "invalid form link target" };
  const form = await forms.get(widget.target.formId);
  if (!form) return { kind: "error", reason: "form not found" };
  const [table, formFields] = await Promise.all([tables.get(form.tableId), fields.listByTable(form.tableId)]);
  if (!table) return { kind: "error", reason: "form's parent table not found" };
  const canSubmit = viewer.isAdmin ? true : await resolveSubmitPermission(viewer, table.baseId, form.tableId, form.id);
  if (!canSubmit) return blockedLinkData(base, "No submit access for this form");
  return {
    ...base,
    title: linkTitle(widget, form.name),
    description: linkDescription(widget, form.config.description),
    target: {
      kind: "form",
      form: forms.toRenderableForm(form),
      fields: renderableFormFields(form, formFields),
      tableName: table.name,
      canSubmit,
    },
  };
};

const resolveLink = async (widget: LinkWidget, viewer: ViewerContext): Promise<WidgetData> => {
  const base = linkBase(widget);
  switch (widget.target.kind) {
    case "url":
      return resolveUrlLink(widget, base);
    case "dashboard":
      return resolveDashboardLink(widget, base, viewer);
    case "table":
      return resolveTableLink(widget, base, viewer);
    case "view":
      return resolveViewLink(widget, base, viewer);
    case "form":
      return resolveFormLink(widget, base, viewer);
  }
};

const blockedLinkData = (base: LinkDataBase, reason: string): WidgetData => ({
  ...base,
  target: { kind: "blocked", reason },
});

type SavedTable = NonNullable<Awaited<ReturnType<typeof tables.get>>>;
type SavedDashboard = NonNullable<Awaited<ReturnType<typeof dashboards.get>>>;

const canReadTableTarget = async (table: SavedTable, viewer: ViewerContext): Promise<boolean> => {
  if (viewer.isAdmin) return true;
  const grants = await loadGrantsForUser({
    userId: viewer.userId,
    userGroups: viewer.userGroups,
    baseId: table.baseId,
    tableId: table.id,
  });
  return hasAtLeast(resolveEffectivePermission(grants, { baseId: table.baseId, tableId: table.id }), "read");
};

const canReadViewTarget = async (view: SavedView, baseId: string, viewer: ViewerContext): Promise<boolean> => {
  if (viewer.isAdmin) return true;
  const grants = await loadGrantsForUser({
    userId: viewer.userId,
    userGroups: viewer.userGroups,
    baseId,
    tableId: view.tableId,
    viewId: view.id,
  });
  const level = resolveEffectivePermission(grants, { baseId, tableId: view.tableId, viewId: view.id });
  if (!hasAtLeast(level, "read")) return false;
  if (view.ownerUserId === null || view.ownerUserId === viewer.userId) return true;
  return hasGrantsForResource(grants, "view", view.id);
};

const canReadDashboardTarget = async (dashboard: SavedDashboard, viewer: ViewerContext): Promise<boolean> => {
  return canReadDashboardIncludedData(dashboard, viewer);
};

const iconForLinkTarget = (kind: Extract<Widget, { kind: "link" }>["target"]["kind"]) => {
  if (kind === "dashboard") return "ti ti-layout-dashboard";
  if (kind === "table") return "ti ti-table";
  if (kind === "view") return "ti ti-table-spark";
  if (kind === "form") return "ti ti-forms";
  return "ti ti-external-link";
};

const renderableFormFields = (form: Form, formFields: Field[]): Field[] => {
  const userInputIds = new Set(form.config.fields.filter((entry) => entry.kind === "user_input").map((entry) => entry.fieldId));
  return formFields.filter((field) => userInputIds.has(field.id));
};

const resolveWorkflowButton = async (widget: WorkflowButtonWidget): Promise<WidgetData> => {
  const workflow = await workflows.get(widget.workflowId);
  if (!workflow) return { kind: "error", reason: "workflow not found" };
  const title = widget.title?.trim() || workflow.name;
  const description = widget.description?.trim() || workflow.description;
  const runnable = Boolean(workflow.compiled.triggers.dashboardButton);
  const enabled = workflow.enabled;
  return {
    kind: "workflow-button",
    workflowId: workflow.id,
    workflowName: workflow.name,
    title,
    description,
    buttonLabel: widget.buttonLabel?.trim() || "Run",
    canRun: runnable && enabled,
    disabledReason: !runnable ? "Workflow has no dashboard button trigger" : !enabled ? "Workflow is disabled" : null,
  };
};

// =============================================================================
// stat
// =============================================================================

const firstAggregateColumn = (columns: DslQueryPreviewColumn[]): DslQueryPreviewColumn | undefined =>
  columns.find((column) => column.type === "aggregate") ?? columns[0];

const resolveStat = async (
  widget: Extract<Widget, { kind: "stat" }>,
  viewer: ViewerContext,
  options: ResolveOptions,
): Promise<WidgetData> => {
  const saved = await views.get(widget.viewId);
  if (!saved) return { kind: "error", reason: "source view not found" };
  const [scalar, trend] = await Promise.all([
    previewSavedView(saved, viewer, options, 1),
    widget.trend ? resolveStatTrend(widget.trend.viewId, widget.trend.windowSize, viewer, options) : Promise.resolve<number[] | null>(null),
  ]);
  if ("error" in scalar) return { kind: "error", reason: scalar.error };
  const column = firstAggregateColumn(scalar.preview.columns);
  if (!column) return { kind: "error", reason: "stat source view has no output columns" };
  const value = scalar.preview.rows[0]?.values[column.key] ?? null;
  return {
    kind: "stat",
    value,
    ...(trend && trend.length > 0 ? { trend } : {}),
  };
};

const resolveStatTrend = async (
  viewId: string,
  windowSize: number,
  viewer: ViewerContext,
  options: ResolveOptions,
): Promise<number[] | null> => {
  try {
    const saved = await views.get(viewId);
    if (!saved) return null;
    const result = await previewSavedView(saved, viewer, options, windowSize);
    if ("error" in result) return null;
    const column = firstAggregateColumn(result.preview.columns);
    if (!column) return null;
    const numbers: number[] = [];
    for (const row of result.preview.rows.slice(-windowSize)) {
      const raw = row.values[column.key];
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
      if (Number.isFinite(n)) numbers.push(n);
    }
    return numbers;
  } catch {
    return null;
  }
};

// =============================================================================
// chart — reads from a saved view's GQL result, optionally trimming to
// the most-recent `limit` buckets.
// =============================================================================

const inferAggKind = (key: string): AggregationSpec["agg"] => {
  const suffix = key.split("__").pop();
  return suffix === "count" ||
    suffix === "countEmpty" ||
    suffix === "countUnique" ||
    suffix === "sum" ||
    suffix === "avg" ||
    suffix === "min" ||
    suffix === "max" ||
    suffix === "median" ||
    suffix === "earliest" ||
    suffix === "latest"
    ? suffix
    : "count";
};

const previewChartShape = (
  preview: PreviewSuccess,
): { groupBy: GroupBySpec[]; aggregations: AggregationSpec[]; buckets: Array<{ keys: unknown[]; values: Record<string, unknown> }> } => {
  const groupColumns = preview.columns.filter((column) => column.type !== "aggregate");
  const aggregateColumns = preview.columns.filter((column) => column.type === "aggregate");
  const aggregations = aggregateColumns.map((column) => ({
    fieldId: column.key,
    agg: inferAggKind(column.key),
    label: column.label,
  }));
  return {
    groupBy: groupColumns.map((column) => ({
      fieldId: column.fieldId ?? column.key,
      label: column.label,
    })),
    aggregations,
    buckets: preview.rows.map((row) => {
      const values: Record<string, unknown> = {};
      for (const [index, column] of aggregateColumns.entries()) {
        const spec = aggregations[index];
        if (spec) values[aggregateOutputKey(spec.fieldId, spec.agg)] = row.values[column.key] ?? null;
      }
      return {
        keys: groupColumns.map((column) => row.values[column.key] ?? null),
        values,
      };
    }),
  };
};

const resolveChart = async (
  widget: Extract<Widget, { kind: "chart" }>,
  viewer: ViewerContext,
  options: ResolveOptions,
): Promise<WidgetData> => {
  const saved = await views.get(widget.viewId);
  if (!saved) return { kind: "error", reason: "source view not found" };
  const result = await previewSavedView(saved, viewer, options, widget.limit);
  if ("error" in result) return { kind: "error", reason: result.error };
  const shape = previewChartShape(result.preview);
  if (shape.groupBy.length === 0 || shape.aggregations.length === 0) {
    return {
      kind: "error",
      reason: "chart source view must be grouped with at least one aggregation",
    };
  }
  const sourceFields = result.fieldsByTableId[saved.tableId] ?? [];
  return {
    kind: "chart",
    buckets: shape.buckets,
    fields: sourceFields,
    viewQuery: { groupBy: shape.groupBy, aggregations: shape.aggregations },
    relationLabels: {},
  };
};

// =============================================================================
// view — embedded read-only table of a saved view
// =============================================================================

const resolveView = async (
  widget: Extract<Widget, { kind: "view" }>,
  viewer: ViewerContext,
  options: ResolveOptions,
): Promise<WidgetData> => {
  return resolveSavedView(widget.viewId, widget.title, viewer, options);
};

const resolveSavedView = async (
  viewId: string,
  titleOverride: string | undefined,
  viewer: ViewerContext,
  options: ResolveOptions,
): Promise<WidgetData> => {
  const view = await views.get(viewId);
  if (!view) return { kind: "error", reason: "view not found" };
  const runtime = await compileRuntimeView(view);
  if ("error" in runtime) return { kind: "error", reason: runtime.error };
  const table = await tables.get(view.tableId);
  if (!table) return { kind: "error", reason: "view's parent table not found" };
  const baseTables = await tables.listByBase(table.baseId);
  const tableShortIds = Object.fromEntries(baseTables.map((t) => [t.id, t.shortId]));
  // includeRelations=true with viewer ⇒ expansion is permission-gated:
  // relation cells pointing at tables the viewer can't read aren't
  // expanded, so DatabaseTable falls back to a neutral placeholder.
  const recordList = await records.list({
    tableId: view.tableId,
    filter: runtime.query.filter ?? null,
    search: runtime.query.search ?? null,
    recordMeta: runtime.query.recordMeta ?? null,
    sort: runtime.query.sort ?? [],
    includeDeleted: runtime.query.includeDeleted,
    deletedOnly: runtime.query.deletedOnly,
    limit: EMBEDDED_VIEW_PAGESIZE,
    includeRelations: true,
    viewer,
    dateConfig: options.dateConfig,
  });
  if (!recordList.ok) return { kind: "error", reason: recordList.error.message };
  return {
    kind: "view",
    title: titleOverride ?? view.name,
    fields: recordList.data.fields,
    records: recordList.data.items,
    viewColumns: runtime.query.columns,
    tableShortIds,
    fullViewLink: { tableShortId: table.shortId, viewShortId: view.shortId },
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
  viewer: ViewerContext,
  options: ResolveOptions,
): Promise<WidgetData> => {
  const titleFallback = widget.title ?? "View stats";
  const view = await views.get(widget.viewId);
  if (!view) {
    return {
      kind: "view-stats",
      title: titleFallback,
      cells: [],
      notice: "view not found",
      fullViewLink: null,
    };
  }
  const table = await tables.get(view.tableId);
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
  const runtime = await compileRuntimeView(view);
  if ("error" in runtime) {
    return {
      kind: "view-stats",
      title,
      cells: [],
      notice: runtime.error,
      fullViewLink: link,
    };
  }
  const isGrouped = (runtime.query.groupBy ?? []).length > 0;
  if (isGrouped) {
    return await resolveGroupedViewStats(runtime, title, link, viewer, options);
  }
  return await resolveUngroupedViewStats(runtime, title, link, viewer, options);
};

const resolveUngroupedViewStats = async (
  view: RuntimeView,
  title: string,
  link: { tableShortId: string; viewShortId: string },
  viewer: ViewerContext,
  options: ResolveOptions,
): Promise<WidgetData> => {
  const fieldsList = await fields.listByTable(view.tableId);
  const fieldsById = new Map(fieldsList.map((f) => [f.id, f]));
  const visible = view.query.columns
    ? view.query.columns
        .map((column) => {
          if (isComputedColumn(column)) {
            return { id: column.id, name: column.label, format: column.format ?? null } as const;
          }
          const field = fieldsById.get(column.fieldId);
          return field && !field.deletedAt
            ? ({ id: field.id, name: column.label?.trim() || field.name, format: inferFormatFromField(field) } as const)
            : null;
        })
        .filter((entry): entry is { id: string; name: string; format: ViewStatsCell["format"] } => Boolean(entry))
    : fieldsList
        .filter((f) => !f.deletedAt && !f.hideInTable)
        .sort((a, b) => a.position - b.position)
        .map((field) => ({ id: field.id, name: field.name, format: inferFormatFromField(field) }));
  if (visible.length === 0) {
    return {
      kind: "view-stats",
      title,
      cells: [],
      notice: "view has no visible fields",
      fullViewLink: link,
    };
  }
  const result = await records.list({
    tableId: view.tableId,
    filter: view.query.filter ?? null,
    search: view.query.search ?? null,
    recordMeta: view.query.recordMeta ?? null,
    sort: view.query.sort ?? [],
    includeDeleted: view.query.includeDeleted,
    deletedOnly: view.query.deletedOnly,
    limit: 1,
    viewer,
    dateConfig: options.dateConfig,
    computedColumns: view.query.columns?.filter(isComputedColumn),
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
  const cells: ViewStatsCell[] = visible.map((item) => ({
    label: item.name,
    value: first.data[item.id] ?? null,
    format: item.format,
  }));
  return { kind: "view-stats", title, cells, notice: null, fullViewLink: link };
};

const resolveGroupedViewStats = async (
  view: RuntimeView,
  title: string,
  link: { tableShortId: string; viewShortId: string },
  viewer: ViewerContext,
  options: ResolveOptions,
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
  const fieldsList = await fields.listByTable(view.tableId);
  const fieldsById = new Map(fieldsList.map((f) => [f.id, f]));
  const result = await records.group({
    tableId: view.tableId,
    filter: view.query.filter ?? null,
    search: view.query.search ?? null,
    recordMeta: view.query.recordMeta ?? null,
    groupBy: view.query.groupBy ?? [],
    aggregations: aggs.map((a) => ({
      fieldId: a.fieldId,
      agg: a.agg as "count" | "countEmpty" | "countUnique" | "sum" | "avg" | "min" | "max",
    })),
    groupSort: view.query.groupSort,
    includeDeleted: view.query.includeDeleted,
    deletedOnly: view.query.deletedOnly,
    limit: 1,
    viewer,
    dateConfig: options.dateConfig,
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
    const key = aggregateOutputKey(a.fieldId, a.agg);
    const targetField = a.fieldId === "*" ? null : (fieldsById.get(a.fieldId) ?? null);
    const fallbackLabel = a.fieldId === "*" ? `${a.agg}(*)` : `${a.agg}(${targetField?.name ?? "?"})`;
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
// renderer can build the input UI. Submit-permission gating is resolved
// here so the cell can render a read-only placeholder for users who
// cannot submit.
// =============================================================================

const resolveForm = async (widget: Extract<Widget, { kind: "form" }>, viewer: ViewerContext): Promise<WidgetData> => {
  const form = await forms.get(widget.formId);
  if (!form) return { kind: "error", reason: "form not found" };
  // Need the parent table to (a) read its baseId for the perm
  // resolution, and (b) hand the renderer the field schema.
  const [table, formFields] = await Promise.all([tables.get(form.tableId), fields.listByTable(form.tableId)]);
  if (!table) return { kind: "error", reason: "form's parent table not found" };

  // Submit gate — same rule the API enforces: form-write OR
  // table-write (most-specific-wins resolution makes table-write
  // automatically pass). Resolved SSR-side so the renderer can swap
  // to a dimmed placeholder when the viewer lacks access, with zero
  // extra client-side network calls.
  const canSubmit = viewer.isAdmin ? true : await resolveSubmitPermission(viewer, table.baseId, form.tableId, form.id);

  return { kind: "form", form: forms.toRenderableForm(form), fields: renderableFormFields(form, formFields), canSubmit };
};

/** Loads the viewer's grants for the form-target chain (base → table →
 *  form) and resolves to a single effective level. Returns true when
 *  that level is `write` or higher, false otherwise. One DB roundtrip
 *  per form-cell — `loadGrantsForUser` already collapses the five
 *  resource legs into a single UNION ALL query. */
const resolveSubmitPermission = async (viewer: ViewerContext, baseId: string, tableId: string, formId: string): Promise<boolean> => {
  const grants = await loadGrantsForUser({
    userId: viewer.userId,
    userGroups: viewer.userGroups,
    baseId,
    tableId,
    formId,
  });
  const level = resolveEffectivePermission(grants, { baseId, tableId, formId });
  return hasAtLeast(level, "write");
};

// =============================================================================
// shared helpers (format inference) — same heuristics the records page uses.
// =============================================================================

const inferFormatFromField = (field: Field): WidgetFormat => {
  if (field.type === "percent") return "percent";
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
