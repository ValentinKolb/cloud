import type {
  EventQuery,
  MetricQuery,
  PulseDashboardCondition,
  PulseDashboardConfig,
  PulseDashboardControl,
  PulseDashboardEventQuery,
  PulseDashboardEventsWidget,
  PulseDashboardLayout,
  PulseDashboardMarkdownWidget,
  PulseDashboardMetricQuery,
  PulseDashboardMetricWidget,
  PulseDashboardRow,
  PulseDashboardSection,
  PulseDashboardStateQuery,
  PulseDashboardStatesWidget,
  PulseDashboardWidget,
  StateQuery,
} from "../contracts";
import type {
  CompileQuery,
  DashboardCompilerContext,
  DashboardDslBlock,
  DashboardDslCard,
  DashboardDslDocument,
  DashboardDslMarkdown,
  DashboardDslSection,
  DashboardDslVisual,
  Result,
  UniqueDashboardId,
} from "./ast";
import { STATE_WIDGET_VISUALS } from "./constants";
import { parseDashboardDsl } from "./parser";

const titleId = (prefix: string, title: string): string =>
  `${prefix}-${
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "item"
  }`;

const queryWithDefaultControls = (query: string, controls: DashboardDslDocument["controls"]): string => {
  const defaults = new Map(controls.map((control) => [control.variable, quoteQueryValue(control.defaultValue)]));
  return query.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, variable: string) => defaults.get(variable) ?? match);
};

const quoteQueryValue = (value: string): string =>
  /[\s,=]/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value;

const stripBaseId = (
  query: MetricQuery | EventQuery | StateQuery,
): PulseDashboardMetricQuery | PulseDashboardEventQuery | PulseDashboardStateQuery => {
  if (query.kind === "metric") {
    const { baseId: _baseId, ...rest } = query;
    return rest;
  }
  if (query.kind === "events") {
    const { baseId: _baseId, ...rest } = query;
    return rest;
  }
  const { baseId: _baseId, ...rest } = query;
  return rest;
};

export const compileDashboardDsl = (input: string, compileQuery: CompileQuery): Result<PulseDashboardConfig> => {
  const parsed = parseDashboardDsl(input);
  if (!parsed.ok) return parsed;
  const context: DashboardCompilerContext = {
    document: parsed.data,
    compileQuery,
    diagnostics: [],
    uniqueId: createUniqueDashboardId(),
  };
  const controls = compileDashboardControls(context.document, context.uniqueId);
  const layout = compileDashboardLayout(context, controls);

  if (context.diagnostics.length) return { ok: false, diagnostics: context.diagnostics };
  return { ok: true, data: { layout, dsl: input.trim() }, diagnostics: [] };
};

const createUniqueDashboardId = (): UniqueDashboardId => {
  const idCounts = new Map<string, number>();
  return (prefix, title) => {
    const base = titleId(prefix, title);
    const count = idCounts.get(base) ?? 0;
    idCounts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };
};

const compileDashboardControls = (document: DashboardDslDocument, uniqueId: UniqueDashboardId): PulseDashboardControl[] =>
  document.controls.map((control) => ({
    id: uniqueId("control", control.variable),
    kind: control.kind,
    variable: control.variable,
    label: control.label,
    defaultValue: control.defaultValue,
    options: control.options.length ? control.options : undefined,
    entityType: control.entityType,
  }));

const compileDashboardLayout = (context: DashboardCompilerContext, controls: PulseDashboardControl[]): PulseDashboardLayout => {
  const { document, uniqueId } = context;
  const sections = document.blocks
    .filter((block): block is DashboardDslSection => block.kind === "section")
    .map((section) => compileSection(section, context));
  const topRows = compileBlocksToRows(document.blocks, document.title, context);
  return {
    version: 1,
    description: document.description,
    controls: controls.length ? controls : undefined,
    sections: topRows.length
      ? [{ id: uniqueId("section", document.title), kind: "section", title: document.title, description: null, rows: topRows, sections }]
      : sections,
  };
};

const compileSection = (section: DashboardDslSection, context: DashboardCompilerContext): PulseDashboardSection => ({
  id: context.uniqueId("section", section.title),
  kind: "section",
  title: section.title,
  description: section.description,
  rows: compileBlocksToRows(section.blocks, section.title, context),
  sections: section.blocks
    .filter((block): block is DashboardDslSection => block.kind === "section")
    .map((child) => compileSection(child, context)),
});

const compileBlocksToRows = (blocks: DashboardDslBlock[], parentTitle: string, context: DashboardCompilerContext): PulseDashboardRow[] => {
  const rows: PulseDashboardRow[] = [];
  let pending: PulseDashboardWidget[] = [];
  const pushPending = (height: PulseDashboardRow["height"] = "md") => {
    if (!pending.length) return;
    rows.push({ id: context.uniqueId("row", `${parentTitle}-${rows.length + 1}`), kind: "row", height, cells: pending });
    pending = [];
  };
  for (const block of blocks) {
    if (block.kind === "row") {
      pushPending();
      pending = block.blocks.map((item) => compileWidget(item, context)).filter((item): item is PulseDashboardWidget => item !== null);
      pushPending(block.height);
      continue;
    }
    if (block.kind === "section") continue;
    const widget = compileWidget(block, context);
    if (widget) pending.push(widget);
  }
  pushPending();
  return rows;
};

const compileWidget = (block: DashboardDslBlock, context: DashboardCompilerContext): PulseDashboardWidget | null => {
  if (block.kind === "markdown") return compileMarkdownWidget(block, context.uniqueId);
  if (block.kind === "card") return compileCardWidget(block, context);
  if (block.kind === "visual") return compileVisualWidget(block, context);
  return null;
};

const compileMarkdownWidget = (block: DashboardDslMarkdown, uniqueId: UniqueDashboardId): PulseDashboardMarkdownWidget => {
  const widget: PulseDashboardMarkdownWidget = {
    id: uniqueId("markdown", block.title ?? block.markdown.slice(0, 24)),
    kind: "markdown",
    markdown: block.markdown,
    span: block.span ?? undefined,
  };
  if (block.title) widget.title = block.title;
  if (block.description) widget.description = block.description;
  return widget;
};

const compileCardWidget = (block: DashboardDslCard, context: DashboardCompilerContext): PulseDashboardWidget | null => {
  const rows = compileBlocksToRows(block.blocks, block.title, context);
  if (!rows.length) return null;
  return {
    id: context.uniqueId("card", block.title),
    kind: "card",
    title: block.title,
    description: block.description,
    span: block.span ?? undefined,
    rows,
  };
};

const compileVisualWidget = (block: DashboardDslVisual, context: DashboardCompilerContext): PulseDashboardWidget | null => {
  if (!block.query) return null;
  const resolvedQueryText = queryWithDefaultControls(block.query, context.document.controls);
  const unresolvedVariable = resolvedQueryText.match(/\$[A-Za-z_][A-Za-z0-9_]*/)?.[0];
  if (unresolvedVariable) {
    pushWidgetDiagnostic(context, block, `Unknown dashboard variable "${unresolvedVariable}"`);
    return null;
  }
  const query = context.compileQuery(resolvedQueryText);
  if (!query.ok) {
    context.diagnostics.push({
      severity: "error",
      message: query.message,
      line: block.queryPosition?.line ?? 1,
      column: block.queryPosition?.column ?? 1,
    });
    return null;
  }
  if (query.data.kind === "metric") return compileMetricWidget(block, query.data, context.uniqueId);
  if (query.data.kind === "events") return compileEventsWidget(block, query.data, context);
  return compileStatesWidget(block, query.data, context);
};

const compileMetricWidget = (block: DashboardDslVisual, query: MetricQuery, uniqueId: UniqueDashboardId): PulseDashboardMetricWidget => ({
  id: uniqueId("metric", block.title),
  kind: "metric",
  title: block.title,
  description: block.description,
  metric: query.metric,
  visual: normalizeMetricVisual(block.visual),
  aggregation: query.aggregation,
  bucket: query.bucket,
  since: query.since,
  sourceId: query.sourceId,
  entityId: query.entityId,
  entityType: query.entityType,
  dimensions: query.dimensions,
  queryText: widgetQueryText(block),
  query: stripBaseId(query) as PulseDashboardMetricQuery,
  conditions: widgetConditions(block),
  span: widgetSpan(block),
});

const normalizeMetricVisual = (visual: DashboardDslVisual["visual"]): PulseDashboardMetricWidget["visual"] =>
  visual === "table" ||
  visual === "stat" ||
  visual === "gauge" ||
  visual === "barGauge" ||
  visual === "bar" ||
  visual === "histogram" ||
  visual === "heatmap"
    ? visual
    : "line";

const compileEventsWidget = (
  block: DashboardDslVisual,
  query: EventQuery,
  context: DashboardCompilerContext,
): PulseDashboardEventsWidget | null => {
  if (block.visual !== "table") {
    pushWidgetDiagnostic(context, block, `Events widget "${block.title}" must use table visual`);
    return null;
  }
  return {
    id: context.uniqueId("events", block.title),
    kind: "events",
    title: block.title,
    visual: "table",
    description: block.description,
    queryText: block.query ?? "",
    query: stripBaseId(query) as PulseDashboardEventQuery,
    conditions: widgetConditions(block),
    span: widgetSpan(block),
  };
};

const compileStatesWidget = (
  block: DashboardDslVisual,
  query: StateQuery,
  context: DashboardCompilerContext,
): PulseDashboardStatesWidget | null => {
  if (!isStateWidgetVisual(block.visual)) {
    pushWidgetDiagnostic(context, block, `States widget "${block.title}" must use table or stat visual`);
    return null;
  }
  return {
    id: context.uniqueId("states", block.title),
    kind: "states",
    title: block.title,
    visual: block.visual,
    description: block.description,
    queryText: block.query ?? "",
    query: stripBaseId(query) as PulseDashboardStateQuery,
    conditions: widgetConditions(block),
    span: widgetSpan(block),
  };
};

const isStateWidgetVisual = (visual: DashboardDslVisual["visual"]): visual is PulseDashboardStatesWidget["visual"] =>
  STATE_WIDGET_VISUALS.has(visual);

const widgetQueryText = (block: DashboardDslVisual): string | undefined => block.query ?? undefined;

const widgetConditions = (block: DashboardDslVisual): PulseDashboardCondition[] | undefined =>
  block.conditions.length ? block.conditions : undefined;

const widgetSpan = (block: DashboardDslVisual): number | undefined => block.span ?? undefined;

const pushWidgetDiagnostic = (context: DashboardCompilerContext, block: DashboardDslVisual, message: string) => {
  context.diagnostics.push({ severity: "error", message, line: widgetDiagnosticLine(block), column: widgetDiagnosticColumn(block) });
};

const widgetDiagnosticLine = (block: DashboardDslVisual): number => block.queryPosition?.line ?? 1;

const widgetDiagnosticColumn = (block: DashboardDslVisual): number => block.queryPosition?.column ?? 1;
