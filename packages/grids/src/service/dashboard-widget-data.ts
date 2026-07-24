import { markdown } from "@valentinkolb/cloud/shared";
import type { DateContext } from "@valentinkolb/stdlib";
import type {
  AggregationSpec,
  DashboardWidgetSource,
  DslQueryPreviewColumn,
  DslQueryPreviewResponse,
  GroupBySpec,
  Widget,
  WidgetValueFormat,
} from "../contracts";
import { previewDslQuery } from "../query-dsl/preview";
import { aggregateOutputKey } from "./aggregate-capabilities";
import { canReadDashboardIncludedData } from "./dashboard-included-access";
import { compileDashboardWidgetQuery } from "./dashboard-widget-query";
import * as dashboards from "./dashboards";
import * as fields from "./fields";
import type { Form } from "./forms";
import * as forms from "./forms";
import { hasAtLeast, hasGrantsForResource, loadGrantsForUser, resolveEffectivePermission } from "./permission-resolver";
import * as tables from "./tables";
import type { Field } from "./types";
import * as views from "./views";
import { getWorkflow } from "./workflow-kernel-store";
import { getLauncher } from "./workflow-launchers";

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
      queryResult: PreviewSuccess;
      fieldsByTable: Record<string, Field[]>;
      tableShortIds: Record<string, string>;
      fullViewLink: { tableShortId: string; viewShortId: string } | null;
      sourceAccess: "open" | "dashboard";
    }
  | {
      kind: "view-stats";
      title: string;
      cells: ViewStatsCell[];
      notice: string | null;
      fullViewLink: { tableShortId: string; viewShortId: string } | null;
      sourceAccess?: "open" | "dashboard";
    }
  | {
      kind: "form";
      form: Form;
      fields: Field[];
      /** True when the viewer has form-write OR table-write on this
       *  form's target — the same gate `/api/grids/forms/:formId/submit`
       *  enforces. Resolved SSR-side so the renderer can swap to a
       *  read-only placeholder without an extra client-side permission
       *  fetch. Trusted internal renderers may omit viewer context. */
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
      launcherId: string;
      expectedRevision: number;
      workflowId: string;
      workflowName: string;
      title: string;
      description: string | null;
      buttonLabel: string;
      action: "run" | "scanner";
      inputMode: "fixed" | "prompt" | null;
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
  valueFormat?: WidgetValueFormat;
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
  serviceAccountId?: string | null;
  /** True only for trusted internal renderer contexts. */
  isAdmin?: boolean;
};

type ResolveOptions = {
  baseId: string;
  dateConfig?: DateContext;
};

type SavedView = NonNullable<Awaited<ReturnType<typeof views.get>>>;
type LinkWidget = Extract<Widget, { kind: "link" }>;
type WorkflowButtonWidget = Extract<Widget, { kind: "workflow-button" }>;
type LinkDataBase = {
  kind: "link";
  title: string;
  description: string | null;
  icon: string;
};

type PreviewSuccess = Extract<DslQueryPreviewResponse, { ok: true }>;

const outputMetadataForPreview = (
  preview: PreviewSuccess,
  fieldsByTableId: Record<string, Field[]>,
  tableShortIds: Record<string, string>,
): { fieldsByTableId: Record<string, Field[]>; tableShortIds: Record<string, string> } => {
  const fieldIdsByTable = new Map<string, Set<string>>();
  for (const column of preview.columns) {
    if (!column.tableId || !column.fieldId) continue;
    const fieldIds = fieldIdsByTable.get(column.tableId) ?? new Set<string>();
    fieldIds.add(column.fieldId);
    fieldIdsByTable.set(column.tableId, fieldIds);
  }
  return {
    fieldsByTableId: Object.fromEntries(
      [...fieldIdsByTable].map(([tableId, fieldIds]) => [
        tableId,
        (fieldsByTableId[tableId] ?? []).filter((field) => fieldIds.has(field.id)),
      ]),
    ),
    tableShortIds: Object.fromEntries(
      [...fieldIdsByTable.keys()].flatMap((tableId) => (tableShortIds[tableId] ? [[tableId, tableShortIds[tableId]]] : [])),
    ),
  };
};

const previewWidgetSource = async (
  source: DashboardWidgetSource,
  viewer: ViewerContext,
  options: ResolveOptions,
  limit?: number,
): Promise<
  | {
      preview: PreviewSuccess;
      fieldsByTableId: Record<string, Field[]>;
      tableShortIds: Record<string, string>;
      tableId: string;
      view?: SavedView;
    }
  | { error: string }
> => {
  const view = source.kind === "view" ? await views.get(source.viewId) : undefined;
  if (source.kind === "view" && !view) return { error: "source view not found" };
  const parentTable = view ? await tables.get(view.tableId) : null;
  if (view && (!parentTable || parentTable.baseId !== options.baseId)) return { error: "source view not found in this base" };

  const compiled = await compileDashboardWidgetQuery({
    baseId: options.baseId,
    source: view?.source ?? (source.kind === "gql" ? source.source : ""),
    ...(view ? { currentTableId: view.tableId } : {}),
  });
  if (!compiled.ok) return { error: compiled.error };

  const result = await previewDslQuery(compiled.data.plan, {
    fieldsByTableId: compiled.data.fieldsByTableId,
    timeZone: options.dateConfig?.timeZone,
    limit,
    viewer,
  });
  if (!result.ok) return { error: result.error.message };
  const outputMetadata = outputMetadataForPreview(result.data, compiled.data.fieldsByTableId, compiled.data.tableShortIds);
  return {
    ...(view ? { view } : {}),
    preview: result.data,
    tableId: compiled.data.plan.tableId,
    ...outputMetadata,
  };
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
export const resolveWidgetData = async (widget: Widget, viewer: ViewerContext, options: ResolveOptions): Promise<WidgetData> => {
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
  const canSubmit = form.isActive && (viewer.isAdmin ? true : await resolveSubmitPermission(viewer, table.baseId, form.tableId, form.id));
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
    serviceAccountId: viewer.serviceAccountId,
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
    serviceAccountId: viewer.serviceAccountId,
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
  const launcher = await getLauncher(widget.launcherId);
  if (!launcher || (launcher.config.kind !== "dashboard" && launcher.config.kind !== "scanner")) {
    return { kind: "error", reason: "workflow launcher not found" };
  }
  const workflow = await getWorkflow(launcher.workflowId);
  if (!workflow || workflow.baseId !== launcher.baseId) return { kind: "error", reason: "workflow not found" };
  const title = widget.title?.trim() || workflow.name;
  const description = widget.description?.trim() || workflow.description;
  const action = launcher.config.kind === "scanner" ? "scanner" : "run";
  const validRevision = launcher.validatedRevision === workflow.revision;
  const valid = !launcher.diagnostics.some((diagnostic) => diagnostic.severity === "error") && validRevision;
  const enabled = workflow.enabled && launcher.enabled;
  return {
    kind: "workflow-button",
    launcherId: launcher.id,
    expectedRevision: launcher.validatedRevision,
    workflowId: workflow.id,
    workflowName: workflow.name,
    title,
    description,
    buttonLabel: widget.buttonLabel?.trim() || (action === "scanner" ? "Scan" : "Run"),
    action,
    inputMode: launcher.config.kind === "dashboard" ? launcher.config.inputMode : null,
    canRun: valid && enabled,
    disabledReason: !valid ? "Workflow launcher must be revalidated" : !enabled ? "Workflow launcher is disabled" : null,
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
  const [scalar, trend] = await Promise.all([
    previewWidgetSource(widget.source, viewer, options, 1),
    widget.trend ? resolveStatTrend(widget.trend.source, widget.trend.windowSize, viewer, options) : Promise.resolve<number[] | null>(null),
  ]);
  if ("error" in scalar) return { kind: "error", reason: scalar.error };
  const column = firstAggregateColumn(scalar.preview.columns);
  if (!column) return { kind: "error", reason: "stat source has no output columns" };
  const value = scalar.preview.rows[0]?.values[column.key] ?? null;
  return {
    kind: "stat",
    value,
    ...(trend && trend.length > 0 ? { trend } : {}),
  };
};

const resolveStatTrend = async (
  source: DashboardWidgetSource,
  windowSize: number,
  viewer: ViewerContext,
  options: ResolveOptions,
): Promise<number[] | null> => {
  try {
    const result = await previewWidgetSource(source, viewer, options, windowSize);
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
// chart — reads from the selected source's GQL result, optionally trimming to
// the most-recent `limit` buckets.
// =============================================================================

const asAggregateKind = (value: string | undefined): AggregationSpec["agg"] | null =>
  value === "count" ||
  value === "countEmpty" ||
  value === "countUnique" ||
  value === "sum" ||
  value === "avg" ||
  value === "min" ||
  value === "max" ||
  value === "median" ||
  value === "earliest" ||
  value === "latest"
    ? value
    : null;

const inferAggKind = (key: string): AggregationSpec["agg"] => asAggregateKind(key.split("__").pop()) ?? "count";

const aggregateKindForColumn = (column: DslQueryPreviewColumn): AggregationSpec["agg"] =>
  asAggregateKind(column.aggregate) ?? inferAggKind(column.key);

const previewChartShape = (
  preview: PreviewSuccess,
): { groupBy: GroupBySpec[]; aggregations: AggregationSpec[]; buckets: Array<{ keys: unknown[]; values: Record<string, unknown> }> } => {
  const groupColumns = preview.columns.filter((column) => column.type !== "aggregate");
  const aggregateColumns = preview.columns.filter((column) => column.type === "aggregate");
  const aggregations = aggregateColumns.map((column) => ({
    fieldId: column.key,
    agg: aggregateKindForColumn(column),
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
  const result = await previewWidgetSource(widget.source, viewer, options, widget.limit);
  if ("error" in result) return { kind: "error", reason: result.error };
  const shape = previewChartShape(result.preview);
  if (shape.groupBy.length === 0 || shape.aggregations.length === 0) {
    return {
      kind: "error",
      reason: "chart source must group rows and include at least one aggregation",
    };
  }
  const sourceFields = result.fieldsByTableId[result.tableId] ?? [];
  return {
    kind: "chart",
    buckets: shape.buckets,
    fields: sourceFields,
    viewQuery: { groupBy: shape.groupBy, aggregations: shape.aggregations },
    relationLabels: {},
  };
};

// =============================================================================
// view — embedded read-only table from a saved view or local query
// =============================================================================

const resolveView = async (
  widget: Extract<Widget, { kind: "view" }>,
  viewer: ViewerContext,
  options: ResolveOptions,
): Promise<WidgetData> => {
  return resolveDashboardView(widget.source, widget.title, viewer, options);
};

const resolveDashboardView = async (
  source: DashboardWidgetSource,
  titleOverride: string | undefined,
  viewer: ViewerContext,
  options: ResolveOptions,
): Promise<WidgetData> => {
  const result = await previewWidgetSource(source, viewer, options, EMBEDDED_VIEW_PAGESIZE);
  if ("error" in result) return { kind: "error", reason: result.error };
  const view = result.view;
  const table = view ? await tables.get(view.tableId) : null;
  const canOpenSource = view && table ? await canReadViewTarget(view, table.baseId, viewer) : false;
  return {
    kind: "view",
    title: titleOverride ?? view?.name ?? "Query results",
    queryResult: result.preview,
    fieldsByTable: result.fieldsByTableId,
    tableShortIds: result.tableShortIds,
    fullViewLink: canOpenSource && table && view ? { tableShortId: table.shortId, viewShortId: view.shortId } : null,
    sourceAccess: canOpenSource ? "open" : "dashboard",
  };
};

// =============================================================================
// view-stats — auto-derived 2×N stat grid from a source's first row /
// first bucket. The cell renders an internal 2-column hairline grid
// within its single paper slot.
// =============================================================================

const resolveViewStats = async (
  widget: Extract<Widget, { kind: "view-stats" }>,
  viewer: ViewerContext,
  options: ResolveOptions,
): Promise<WidgetData> => {
  const titleFallback = widget.title ?? "View stats";
  const preview = await previewWidgetSource(widget.source, viewer, options, 1);
  if ("error" in preview) {
    return { kind: "view-stats", title: titleFallback, cells: [], notice: preview.error, fullViewLink: null };
  }
  const view = preview.view;
  const table = view ? await tables.get(view.tableId) : null;
  const canOpenSource = view && table ? await canReadViewTarget(view, table.baseId, viewer) : false;
  const link = canOpenSource && table && view ? { tableShortId: table.shortId, viewShortId: view.shortId } : null;
  const sourceAccess = canOpenSource ? "open" : "dashboard";
  const title = widget.title ?? view?.name ?? "Query summary";
  const row = preview.preview.rows[0];
  if (!row) {
    return {
      kind: "view-stats",
      title,
      cells: [],
      notice: "view has no rows",
      fullViewLink: link,
      sourceAccess,
    };
  }
  const fieldsById = new Map((preview.fieldsByTableId[preview.tableId] ?? []).map((field) => [field.id, field]));
  const cells: ViewStatsCell[] = preview.preview.columns.map((column) => {
    const field = column.fieldId ? (fieldsById.get(column.fieldId) ?? null) : null;
    return {
      label: column.label,
      value: row.values[column.key] ?? null,
      valueFormat:
        column.type === "aggregate"
          ? inferValueFormatFromAgg(aggregateKindForColumn(column), field)
          : field
            ? valueFormatForField(field)
            : undefined,
    };
  });
  return { kind: "view-stats", title, cells, notice: null, fullViewLink: link, sourceAccess };
};

export const valueFormatForField = (field: Field): WidgetValueFormat | undefined => {
  if (field.type === "percent") {
    const config = field.config as { decimals?: number; range?: "percent" | "fraction" };
    return config.range === "fraction"
      ? { style: "percent", decimalPlaces: config.decimals }
      : { style: "number", decimalPlaces: config.decimals, unit: "%", unitPosition: "suffix" };
  }
  if (field.type !== "number") return undefined;

  const config = field.config as {
    decimalPlaces?: number;
    integerOnly?: boolean;
    unit?: string;
    unitPosition?: "prefix" | "suffix";
  };
  return {
    style: config.integerOnly ? "integer" : "number",
    ...(config.integerOnly || config.decimalPlaces === undefined ? {} : { decimalPlaces: config.decimalPlaces }),
    ...(!config.integerOnly && config.unit ? { unit: config.unit, unitPosition: config.unitPosition ?? "suffix" } : {}),
  };
};

const inferValueFormatFromAgg = (agg: string, field: Field | null): WidgetValueFormat | undefined => {
  if (agg === "count" || agg === "countEmpty" || agg === "countUnique") return { style: "integer" };
  return field ? valueFormatForField(field) : undefined;
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
  const canSubmit = form.isActive && (viewer.isAdmin ? true : await resolveSubmitPermission(viewer, table.baseId, form.tableId, form.id));

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
    serviceAccountId: viewer.serviceAccountId,
    baseId,
    tableId,
    formId,
  });
  const level = resolveEffectivePermission(grants, { baseId, tableId, formId });
  return hasAtLeast(level, "write");
};
