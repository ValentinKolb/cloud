import { dialogCore, IconInput, MarkdownEditor, PanelDialog, panelDialogOptions, prompts, Select, TextInput } from "@valentinkolb/cloud/ui";
import { createMemo, createSignal, type JSX, Show } from "solid-js";
import type {
  ChartWidget,
  Dashboard,
  Field,
  Form,
  FormWidget,
  LinkWidget,
  MarkdownWidget,
  StatWidget,
  View,
  ViewStatsWidget,
  ViewWidget,
  Widget,
  Workflow,
  WorkflowButtonWidget,
} from "../../../service";
import { formatWidgetValue } from "../dashboard/widget-format";
import { dashboardWorkflowOption, dashboardWorkflowSelectOption } from "./dashboard-workflow-options";

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

export const isChartReadyView = (view: View): boolean =>
  groupItemsFromSource(view.source).length > 0 && aggregateItemsFromSource(view.source).length > 0;

const isChartReadyForType = (view: View, chartType: ChartWidget["chartType"]): boolean => {
  if (!isChartReadyView(view)) return false;
  if (chartType === "scatter") return aggregateItemsFromSource(view.source).length >= 2;
  return true;
};

export const defaultStatWidget = (_tableId: string): StatWidget => ({
  id: newId("w"),
  kind: "stat",
  span: 3,
  title: "New stat",
  format: "plain",
  tone: "blue",
  viewId: "",
});

export const defaultViewWidget = (): ViewWidget => ({
  id: newId("w"),
  kind: "view",
  span: 6,
  viewId: "",
});

export const defaultChartWidget = (): ChartWidget => ({
  id: newId("w"),
  kind: "chart",
  span: 6,
  chartType: "bar",
  title: "New chart",
  viewId: "",
});

export const defaultViewStatsWidget = (): ViewStatsWidget => ({
  id: newId("w"),
  kind: "view-stats",
  span: 6,
  viewId: "",
});

export const defaultFormWidget = (): FormWidget => ({
  id: newId("w"),
  kind: "form",
  span: 6,
  formId: "",
});

export const defaultMarkdownWidget = (): MarkdownWidget => ({
  id: newId("w"),
  kind: "markdown",
  span: 6,
  title: "Notes",
  markdown: "## Notes\n\nAdd instructions, links, or context here.",
});

export const defaultLinkWidget = (): LinkWidget => ({
  id: newId("w"),
  kind: "link",
  span: 4,
  title: "Open",
  target: { kind: "url", url: "https://example.com" },
});

export const defaultWorkflowButtonWidget = (): WorkflowButtonWidget => ({
  id: newId("w"),
  kind: "workflow-button",
  span: 4,
  launcherId: "",
  title: "Run workflow",
  description: "Start a saved workflow from this dashboard.",
  buttonLabel: "Run",
});

type CellEditDialogResult = { action: "save"; widget: Widget } | { action: "delete" };

export const openCellEditDialog = (
  widget: Widget,
  ctx: {
    tables: Array<{ id: string; name: string; slug: string }>;
    dashboards: Dashboard[];
    dashboardWorkflows: Workflow[];
    fieldsByTable: Record<string, Field[]>;
    viewsByTable: Record<string, View[]>;
    formsByTable: Record<string, Form[]>;
  },
  options: { allowDelete?: boolean } = {},
): Promise<CellEditDialogResult | undefined> => {
  const title: Record<Widget["kind"], string> = {
    stat: "Stat widget",
    view: "View widget",
    chart: "Chart widget",
    "view-stats": "View stats widget",
    form: "Form widget",
    markdown: "Markdown widget",
    link: "Link widget",
    "workflow-button": "Workflow widget",
  };
  const icon: Record<Widget["kind"], string> = {
    stat: "ti ti-number",
    view: "ti ti-table-spark",
    chart: "ti ti-chart-bar",
    "view-stats": "ti ti-layout-2",
    form: "ti ti-forms",
    markdown: "ti ti-markdown",
    link: "ti ti-link",
    "workflow-button": "ti ti-route",
  };

  return dialogCore.open<CellEditDialogResult>((close) => {
    const [draft, setDraft] = createSignal<Widget>(widget);
    return (
      <PanelDialog>
        <PanelDialog.Header title={title[widget.kind]} icon={icon[widget.kind]} close={() => close()} />
        <PanelDialog.Body>
          <Show when={draft().kind === "chart" ? (draft() as ChartWidget) : null}>
            {(chart) => <ChartWidgetInfoBlock chartType={chart().chartType} />}
          </Show>
          <CellEditorBody
            widget={draft()}
            onUpdate={(next) => setDraft(next)}
            tables={ctx.tables}
            dashboards={ctx.dashboards}
            dashboardWorkflows={ctx.dashboardWorkflows}
            fieldsByTable={ctx.fieldsByTable}
            viewsByTable={ctx.viewsByTable}
            formsByTable={ctx.formsByTable}
          />
          <WidgetEditorSection title="Layout" subtitle="Width inside the row's 12-column grid." icon="ti ti-layout-columns">
            <Select
              label="Widget width"
              value={() => String(draft().span ?? 12)}
              onChange={(v) => setDraft({ ...draft(), span: Number(v) } as Widget)}
              options={[
                { id: "3", label: "S · 3/12", description: "Compact width." },
                { id: "6", label: "M · 6/12", description: "Half row." },
                { id: "8", label: "L · 8/12", description: "Wide widget." },
                { id: "12", label: "XL · 12/12", description: "Full row." },
              ]}
            />
          </WidgetEditorSection>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <Show when={options.allowDelete} fallback={<span />}>
            <button type="button" class="btn-danger btn-sm" onClick={() => close({ action: "delete" })}>
              <i class="ti ti-trash" /> Delete widget
            </button>
          </Show>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-input btn-sm" onClick={() => close()}>
              Cancel
            </button>
            <button
              type="button"
              class="btn-primary btn-sm"
              onClick={() => {
                const error = validateWidgetDraft(draft(), ctx.viewsByTable);
                if (error) {
                  prompts.error(error);
                  return;
                }
                close({ action: "save", widget: draft() });
              }}
            >
              Save
            </button>
          </div>
        </PanelDialog.Footer>
      </PanelDialog>
    );
  }, panelDialogOptions);
};

function CellEditorBody(props: {
  widget: Widget;
  onUpdate: (w: Widget) => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  dashboards: Dashboard[];
  dashboardWorkflows: Workflow[];
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
  formsByTable: Record<string, Form[]>;
}) {
  switch (props.widget.kind) {
    case "stat":
      return (
        <StatCellBody
          widget={props.widget}
          onUpdate={props.onUpdate as (w: StatWidget) => void}
          tables={props.tables}
          viewsByTable={props.viewsByTable}
        />
      );
    case "view":
      return (
        <ViewCellBody
          widget={props.widget}
          onUpdate={props.onUpdate as (w: ViewWidget) => void}
          tables={props.tables}
          viewsByTable={props.viewsByTable}
        />
      );
    case "chart":
      return (
        <ChartCellBody
          widget={props.widget}
          onUpdate={props.onUpdate as (w: ChartWidget) => void}
          tables={props.tables}
          fieldsByTable={props.fieldsByTable}
          viewsByTable={props.viewsByTable}
        />
      );
    case "view-stats":
      return (
        <ViewStatsCellBody
          widget={props.widget}
          onUpdate={props.onUpdate as (w: ViewStatsWidget) => void}
          tables={props.tables}
          viewsByTable={props.viewsByTable}
        />
      );
    case "form":
      return (
        <FormCellBody
          widget={props.widget}
          onUpdate={props.onUpdate as (w: FormWidget) => void}
          tables={props.tables}
          formsByTable={props.formsByTable}
        />
      );
    case "markdown":
      return <MarkdownCellBody widget={props.widget} onUpdate={props.onUpdate as (w: MarkdownWidget) => void} />;
    case "link":
      return (
        <LinkCellBody
          widget={props.widget}
          onUpdate={props.onUpdate as (w: LinkWidget) => void}
          tables={props.tables}
          dashboards={props.dashboards}
          viewsByTable={props.viewsByTable}
          formsByTable={props.formsByTable}
        />
      );
    case "workflow-button":
      return (
        <WorkflowButtonCellBody
          widget={props.widget}
          onUpdate={props.onUpdate as (w: WorkflowButtonWidget) => void}
          dashboardWorkflows={props.dashboardWorkflows}
        />
      );
  }
}

const FORMAT_OPTIONS = [
  { id: "plain", label: "Plain number" },
  { id: "integer", label: "Integer" },
  { id: "currency", label: "Currency (EUR)" },
  { id: "percent", label: "Percent" },
];

const STAT_TONE_OPTIONS = [
  { id: "blue", label: "Blue", description: "Default for neutral numbers." },
  { id: "neutral", label: "Neutral", description: "Use when color should not signal anything." },
  { id: "green", label: "Green", description: "Positive or healthy value." },
  { id: "amber", label: "Amber", description: "Needs attention." },
  { id: "red", label: "Red", description: "Problem or error-like value." },
];

function StatCellBody(props: {
  widget: StatWidget;
  onUpdate: (w: StatWidget) => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  viewsByTable: Record<string, View[]>;
}) {
  const allViews = createMemo(() => sortedViews(props.tables, props.viewsByTable));

  return (
    <WidgetEditorSection title="Source" subtitle="Pick the saved view this stat should read." icon="ti ti-database">
      <WidgetInfoBlock
        title="Stat widget"
        body="Shows one number from one saved GQL view."
        detail="Use an aggregate view such as `aggregate count(*) as rows` or `aggregate sum(Amount) as revenue`."
      />
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextInput
          label="Title"
          value={() => props.widget.title ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
        />
        <TextInput
          label="Sub-line"
          value={() => props.widget.sub ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, sub: v || undefined })}
          placeholder="e.g. last 24h"
        />
        <Select
          label="Source view"
          value={() => props.widget.viewId}
          onChange={(v) => props.onUpdate({ ...props.widget, viewId: v })}
          options={[
            { id: "", label: "(pick a view)" },
            ...allViews().map(({ view, tableName }) => ({
              id: view.id,
              label: `${tableName} · ${view.name}`,
              description: statViewDescription(view),
            })),
          ]}
        />
        <Select
          label="Format"
          value={() => props.widget.format ?? "plain"}
          onChange={(v) => props.onUpdate({ ...props.widget, format: v as StatWidget["format"] })}
          options={FORMAT_OPTIONS}
        />
        <Select
          label="Value color"
          value={() => props.widget.tone ?? "blue"}
          onChange={(v) => props.onUpdate({ ...props.widget, tone: v as StatWidget["tone"] })}
          options={STAT_TONE_OPTIONS}
        />
        <IconInput
          label="Icon"
          value={() => props.widget.icon ?? ""}
          onChange={(v) => props.onUpdate({ ...props.widget, icon: v || undefined })}
          placeholder="Search icons..."
        />
      </div>
      <div class="text-xs text-dimmed">
        Format preview: <code class="font-mono">{formatWidgetValue(1234.56, props.widget.format)}</code>
      </div>
      <StatTrendSection widget={props.widget} views={allViews()} onUpdate={props.onUpdate} />
    </WidgetEditorSection>
  );
}

function StatTrendSection(props: {
  widget: StatWidget;
  views: Array<{ view: View; tableName: string }>;
  onUpdate: (w: StatWidget) => void;
}) {
  const trend = () => props.widget.trend;

  const enable = () => {
    const first = props.views[0]?.view;
    if (!first) return;
    props.onUpdate({
      ...props.widget,
      trend: { viewId: first.id, windowSize: 12 },
    });
  };

  const disable = () => {
    const { trend: _drop, ...widget } = props.widget;
    props.onUpdate(widget);
  };

  const patchTrend = (patch: Partial<NonNullable<StatWidget["trend"]>>) => {
    const current = trend();
    if (!current) return;
    props.onUpdate({ ...props.widget, trend: { ...current, ...patch } });
  };

  return (
    <Show when={props.views.length > 0}>
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold uppercase tracking-wider text-dimmed">Trend</span>
          <Show
            when={trend()}
            fallback={
              <button type="button" class="btn-input-success btn-sm" onClick={enable}>
                <i class="ti ti-plus" /> Add trend
              </button>
            }
          >
            <button type="button" class="btn-input btn-sm" onClick={disable}>
              Remove trend
            </button>
          </Show>
        </div>
        <p class="text-xs text-dimmed">Adds a small history line from a grouped saved view.</p>
        <Show when={trend()}>
          {(t) => (
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Select
                label="Trend view"
                value={() => t().viewId}
                onChange={(v) => patchTrend({ viewId: v })}
                options={props.views.map(({ view, tableName }) => ({
                  id: view.id,
                  label: `${tableName} · ${view.name}`,
                  description: statViewDescription(view),
                }))}
              />
              <Select
                label="Window size"
                value={() => String(t().windowSize)}
                onChange={(v) => patchTrend({ windowSize: Number(v) })}
                options={[6, 8, 12, 24, 30].map((n) => ({ id: String(n), label: `Last ${n}` }))}
              />
            </div>
          )}
        </Show>
      </div>
    </Show>
  );
}

function ViewStatsCellBody(props: {
  widget: ViewStatsWidget;
  onUpdate: (w: ViewStatsWidget) => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  viewsByTable: Record<string, View[]>;
}) {
  const allViews = createMemo(() => sortedViews(props.tables, props.viewsByTable));
  return (
    <WidgetEditorSection title="Source" subtitle="Stats are derived from the selected saved view." icon="ti ti-table-spark">
      <WidgetInfoBlock
        title="View summary"
        body="Shows a compact summary from one saved view."
        detail="Grouped views show the first group bucket. Ungrouped views show the first record's visible fields."
      />
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextInput
          label="Title"
          value={() => props.widget.title ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
          placeholder="Defaults to the view name"
        />
        <Select
          label="View"
          value={() => props.widget.viewId}
          onChange={(v) => props.onUpdate({ ...props.widget, viewId: v })}
          options={[
            { id: "", label: "(pick a view)" },
            ...allViews().map(({ view, tableName }) => ({
              id: view.id,
              label: `${tableName} · ${view.name}`,
              description: viewStatsViewDescription(view),
            })),
          ]}
        />
      </div>
    </WidgetEditorSection>
  );
}

function FormCellBody(props: {
  widget: FormWidget;
  onUpdate: (w: FormWidget) => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  formsByTable: Record<string, Form[]>;
}) {
  const allForms = createMemo(() => sortedForms(props.tables, props.formsByTable));
  return (
    <WidgetEditorSection title="Source" subtitle="Embed a saved form for inline record creation." icon="ti ti-forms">
      <WidgetInfoBlock
        title="Form widget"
        body="Shows a form directly on the dashboard."
        detail="Submissions create records in the form's table. Users without submit permission see a read-only placeholder."
      />
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextInput
          label="Title"
          value={() => props.widget.title ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
          placeholder="Defaults to the form name"
        />
        <Select
          label="Form"
          value={() => props.widget.formId}
          onChange={(v) => props.onUpdate({ ...props.widget, formId: v })}
          options={[
            { id: "", label: "(pick a form)" },
            ...allForms().map(({ form, tableName }) => ({
              id: form.id,
              label: `${tableName} · ${form.name}`,
              description: `${form.config.fields.length} fields · creates records in ${tableName}`,
            })),
          ]}
        />
      </div>
    </WidgetEditorSection>
  );
}

function ViewCellBody(props: {
  widget: ViewWidget;
  onUpdate: (w: ViewWidget) => void;
  viewsByTable: Record<string, View[]>;
  tables: Array<{ id: string; name: string; slug: string }>;
}) {
  const allViews = createMemo(() => sortedViews(props.tables, props.viewsByTable));

  return (
    <WidgetEditorSection title="Source" subtitle="Use a saved view for filters, sorting, and columns." icon="ti ti-table">
      <WidgetInfoBlock
        title="Embedded records"
        body="Shows records inside the dashboard."
        detail="Saved views keep their filters, sorting, and columns. Create a simple `from table …` view for raw table records."
      />
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextInput
          label="Title"
          value={() => props.widget.title ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
          placeholder="Defaults to the view name"
        />
        <Select
          label="View"
          value={() => props.widget.viewId}
          onChange={(v) => props.onUpdate({ ...props.widget, viewId: v })}
          options={[
            { id: "", label: "(pick a view)" },
            ...allViews().map(({ view, tableName }) => ({
              id: view.id,
              label: `${tableName} · ${view.name}`,
              description: embeddedViewDescription(view),
            })),
          ]}
        />
      </div>
    </WidgetEditorSection>
  );
}

const CHART_TYPE_OPTIONS: { id: ChartWidget["chartType"]; label: string; icon: string }[] = [
  { id: "donut", label: "Donut", icon: "ti ti-chart-donut-4" },
  { id: "bar", label: "Bar", icon: "ti ti-chart-bar" },
  { id: "line", label: "Line", icon: "ti ti-chart-line" },
  { id: "sparkline", label: "Sparkline", icon: "ti ti-chart-arcs" },
  { id: "scatter", label: "Scatter", icon: "ti ti-chart-dots" },
];

const CHART_TYPE_INFO: Record<ChartWidget["chartType"], { title: string; body: string; requirement: string; example: string }> = {
  donut: {
    title: "Donut chart",
    body: "Use this when you want to show parts of one total, for example tasks by status or revenue by product group.",
    requirement: "The source view must group rows into slices and include one summary value for the slice size.",
    example: "Example: group by Status, summarize with Count.",
  },
  bar: {
    title: "Bar chart",
    body: "Use this when you want to compare categories side by side, for example sales per month or tickets per team.",
    requirement: "The source view must group rows into bars and include one summary value for the bar height.",
    example: "Example: group by Month, summarize Amount with Sum.",
  },
  line: {
    title: "Line chart",
    body: "Use this when you want to show change over time or another ordered list, for example monthly income.",
    requirement: "The source view must group rows for the x-axis and include one or more summary values for the lines.",
    example: "Example: group by Month, summarize Amount with Sum.",
  },
  sparkline: {
    title: "Sparkline",
    body: "Use this when you want a compact trend without axes, for example daily signups or stock over time.",
    requirement: "The source view must group rows in the desired order and include one summary value for the line.",
    example: "Example: group by Day, summarize Quantity with Sum.",
  },
  scatter: {
    title: "Scatter chart",
    body: "Use this when you want to compare two numbers for each category, for example hours spent vs revenue.",
    requirement: "The source view must group rows and include at least two summary values. The first value is X, the second is Y.",
    example: "Example: group by Customer, summarize Hours and Revenue with Sum.",
  },
};

function ChartWidgetInfoBlock(props: { chartType: ChartWidget["chartType"] }) {
  const info = () => CHART_TYPE_INFO[props.chartType];
  return (
    <section class="info-block-info p-4 text-sm flex items-start gap-3">
      <i class="ti ti-info-circle mt-0.5 shrink-0 text-base" />
      <div class="min-w-0 flex flex-col gap-1.5">
        <h3 class="font-semibold text-base leading-tight">{info().title}</h3>
        <p>{info().body}</p>
        <p>{info().requirement}</p>
        <p>{info().example}</p>
      </div>
    </section>
  );
}

function ChartCellBody(props: {
  widget: ChartWidget;
  onUpdate: (w: ChartWidget) => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
}) {
  const allViews = createMemo(() => sortedViews(props.tables, props.viewsByTable));
  const chartViews = createMemo(() => allViews().filter(({ view }) => isChartReadyForType(view, props.widget.chartType)));
  const selectedView = createMemo(() => allViews().find(({ view }) => view.id === props.widget.viewId));

  return (
    <WidgetEditorSection title="Source" subtitle="Pick one chart-ready saved view." icon="ti ti-chart-bar">
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-primary">Chart type</span>
        <div class="flex flex-wrap items-center gap-2">
          {CHART_TYPE_OPTIONS.map((opt) => (
            <button
              type="button"
              class={props.widget.chartType === opt.id ? "btn-input-primary btn-sm" : "btn-input btn-sm"}
              onClick={() => props.onUpdate(withChartType(props.widget, opt.id))}
            >
              <i class={opt.icon} />
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextInput
          label="Title"
          value={() => props.widget.title ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
          placeholder="e.g. Revenue by quarter"
        />
        <TextInput
          label="Subtitle"
          value={() => props.widget.subtitle ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, subtitle: v || undefined })}
          placeholder="e.g. last 12 months"
        />
        <Select
          label="Source view"
          description="Only chart-ready views are listed."
          value={() => props.widget.viewId}
          onChange={(v) => props.onUpdate({ ...props.widget, viewId: v })}
          selectedLabel={() => selectedView()?.view.name}
          options={[
            { id: "", label: "(pick a view)" },
            ...chartViews().map(({ view, tableName }) => ({
              id: view.id,
              label: `${tableName} · ${view.name}`,
              description: chartViewDescription(props.widget.chartType, view, props.fieldsByTable[view.tableId] ?? []),
            })),
          ]}
        />
        <TextInput
          label="Limit"
          description="Optional. Uses the view order and keeps the last N rows."
          value={() => (props.widget.limit !== undefined ? String(props.widget.limit) : "")}
          onInput={(raw) => {
            const trimmed = raw.trim();
            if (!trimmed) {
              const { limit: _drop, ...rest } = props.widget;
              props.onUpdate(rest);
              return;
            }
            const n = Number(trimmed);
            if (Number.isFinite(n) && n > 0) props.onUpdate({ ...props.widget, limit: Math.min(Math.floor(n), 1000) });
          }}
          placeholder="e.g. 12"
        />
        <Show when={props.widget.chartType !== "donut" && props.widget.chartType !== "sparkline"}>
          <Select
            label="Y-axis format"
            value={() => props.widget.format ?? "plain"}
            onChange={(v) => props.onUpdate({ ...props.widget, format: v as ChartWidget["format"] })}
            options={FORMAT_OPTIONS}
          />
          <TextInput
            label="X-axis label"
            value={() => props.widget.xAxisLabel ?? ""}
            onInput={(v) => props.onUpdate({ ...props.widget, xAxisLabel: v || undefined })}
          />
          <TextInput
            label="Y-axis label"
            value={() => props.widget.yAxisLabel ?? ""}
            onInput={(v) => props.onUpdate({ ...props.widget, yAxisLabel: v || undefined })}
          />
        </Show>
      </div>
    </WidgetEditorSection>
  );
}

function withChartType(widget: ChartWidget, chartType: ChartWidget["chartType"]): ChartWidget {
  if (chartType !== "donut" && chartType !== "sparkline") return { ...widget, chartType };
  const { format: _format, xAxisLabel: _xAxisLabel, yAxisLabel: _yAxisLabel, ...rest } = widget;
  return { ...rest, chartType };
}

function chartViewDescription(chartType: ChartWidget["chartType"], view: View, _fields: Field[]): string {
  const groupItems = groupItemsFromSource(view.source);
  const aggregateItems = aggregateItemsFromSource(view.source);
  const category = labelForGroupBySourceItem(groupItems[0]);
  const firstValue = labelForAggregateSourceItem(aggregateItems[0], 0);
  const secondValue = labelForAggregateSourceItem(aggregateItems[1], 1);
  const categoryCount = groupItems.length;
  const valueCount = aggregateItems.length;
  const counts = `${categoryCount} ${categoryCount === 1 ? "category" : "categories"} · ${valueCount} ${valueCount === 1 ? "value" : "values"}`;

  if (chartType === "donut") return `Slices ${category} by ${firstValue} · ${counts}`;
  if (chartType === "scatter") return `Plots ${firstValue} against ${secondValue} by ${category} · ${counts}`;
  if (chartType === "sparkline") return `Trends ${firstValue} over ${category} · ${counts}`;
  return `Plots ${category} against ${firstValue} · ${counts}`;
}

function labelForGroupBySourceItem(item: string | undefined): string {
  if (!item) return "category";
  return readableSourceName(item.replace(/\s+by\s+(day|week|month|quarter|year)\s*$/i, "")) || "category";
}

function labelForAggregateSourceItem(item: string | undefined, index: number): string {
  if (!item) return `value ${index + 1}`;
  const alias = aliasFromSourceItem(item);
  if (alias) return alias;
  const match = item.match(/\b([a-zA-Z][a-zA-Z0-9_]*)\s*\((.*)\)/);
  if (!match) return readableSourceName(item) || `value ${index + 1}`;
  const fn = match[1] ?? "";
  const arg = match[2] ?? "";
  if (arg.trim() === "*") return readableAgg(fn);
  return `${readableAgg(fn)} ${readableSourceName(arg) || "value"}`;
}

function readableAgg(agg: string): string {
  const labels: Record<string, string> = {
    count: "Count",
    countEmpty: "Empty count",
    countUnique: "Unique count",
    sum: "Sum",
    avg: "Average",
    min: "Minimum",
    max: "Maximum",
    median: "Median",
    earliest: "Earliest",
    latest: "Latest",
  };
  return labels[agg] ?? agg;
}

function embeddedViewDescription(view: View): string {
  const parts = [];
  const selected = selectItemsFromSource(view.source);
  if (selected.length > 0) parts.push(`${selected.length} columns`);
  if (/\bwhere\b/i.test(view.source)) parts.push("filtered");
  if (groupItemsFromSource(view.source).length > 0) parts.push("grouped");
  if (/\bsort\b/i.test(view.source)) parts.push("sorted");
  return parts.length > 0 ? parts.join(" · ") : "Saved columns and records.";
}

function viewStatsViewDescription(view: View): string {
  const groupBy = groupItemsFromSource(view.source).length;
  const aggs = aggregateItemsFromSource(view.source).length;
  if (groupBy > 0) return `First group bucket · ${aggs} ${aggs === 1 ? "value" : "values"}`;
  return "First record · visible fields";
}

function statViewDescription(view: View): string {
  const aggs = aggregateItemsFromSource(view.source).length;
  if (aggs > 0) return `${aggs} ${aggs === 1 ? "value" : "values"} from saved query`;
  return "First output column from saved query";
}

const LINK_TARGET_OPTIONS: { id: LinkWidget["target"]["kind"]; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "ti ti-layout-dashboard" },
  { id: "form", label: "Form", icon: "ti ti-forms" },
  { id: "table", label: "Table", icon: "ti ti-table" },
  { id: "view", label: "View", icon: "ti ti-table-spark" },
  { id: "url", label: "URL", icon: "ti ti-external-link" },
];

function LinkCellBody(props: {
  widget: LinkWidget;
  onUpdate: (w: LinkWidget) => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  dashboards: Dashboard[];
  viewsByTable: Record<string, View[]>;
  formsByTable: Record<string, Form[]>;
}) {
  const allViews = createMemo(() => sortedViews(props.tables, props.viewsByTable));
  const allForms = createMemo(() => sortedForms(props.tables, props.formsByTable));
  const setTargetKind = (kind: LinkWidget["target"]["kind"]) => {
    if (props.widget.target.kind === kind) return;
    const target =
      kind === "dashboard"
        ? { kind, dashboardId: props.dashboards[0]?.id ?? "" }
        : kind === "table"
          ? { kind, tableId: props.tables[0]?.id ?? "" }
          : kind === "view"
            ? { kind, viewId: allViews()[0]?.view.id ?? "" }
            : kind === "form"
              ? { kind, formId: allForms()[0]?.form.id ?? "" }
              : { kind, url: "" };
    props.onUpdate({ ...props.widget, target } as LinkWidget);
  };

  return (
    <WidgetEditorSection title="Target" subtitle="Link to a Grids resource or an external URL." icon="ti ti-link">
      <WidgetInfoBlock
        title="Link widget"
        body="Shows a compact action card on the dashboard."
        detail="Internal links open in Grids. External URLs open in a new tab. Forms open as a modal when the user can submit."
      />
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-primary">Target type</span>
        <div class="flex flex-wrap items-center gap-2">
          {LINK_TARGET_OPTIONS.map((opt) => (
            <button
              type="button"
              class={props.widget.target.kind === opt.id ? "btn-input-primary btn-sm" : "btn-input btn-sm"}
              onClick={() => setTargetKind(opt.id)}
            >
              <i class={opt.icon} />
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextInput
          label="Title"
          value={() => props.widget.title ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
          placeholder="Defaults to target name"
        />
        <IconInput
          label="Icon"
          value={() => props.widget.icon ?? ""}
          onChange={(v) => props.onUpdate({ ...props.widget, icon: v || undefined })}
          placeholder="Search icons..."
        />
        <TextInput
          label="Description"
          value={() => props.widget.description ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, description: v || undefined })}
        />
        <Show when={props.widget.target.kind === "dashboard"}>
          <Select
            label="Dashboard"
            value={() => (props.widget.target.kind === "dashboard" ? props.widget.target.dashboardId : "")}
            onChange={(v) => props.onUpdate({ ...props.widget, target: { kind: "dashboard", dashboardId: v } })}
            options={[
              { id: "", label: "(pick a dashboard)" },
              ...props.dashboards.map((d) => ({ id: d.id, label: d.name, description: d.description ?? undefined })),
            ]}
          />
        </Show>
        <Show when={props.widget.target.kind === "table"}>
          <Select
            label="Table"
            value={() => (props.widget.target.kind === "table" ? props.widget.target.tableId : "")}
            onChange={(v) => props.onUpdate({ ...props.widget, target: { kind: "table", tableId: v } })}
            options={[{ id: "", label: "(pick a table)" }, ...props.tables.map((t) => ({ id: t.id, label: t.name }))]}
          />
        </Show>
        <Show when={props.widget.target.kind === "view"}>
          <Select
            label="View"
            value={() => (props.widget.target.kind === "view" ? props.widget.target.viewId : "")}
            onChange={(v) => props.onUpdate({ ...props.widget, target: { kind: "view", viewId: v } })}
            options={[
              { id: "", label: "(pick a view)" },
              ...allViews().map(({ view, tableName }) => ({
                id: view.id,
                label: `${tableName} · ${view.name}`,
                description: embeddedViewDescription(view),
              })),
            ]}
          />
        </Show>
        <Show when={props.widget.target.kind === "form"}>
          <Select
            label="Form"
            value={() => (props.widget.target.kind === "form" ? props.widget.target.formId : "")}
            onChange={(v) => props.onUpdate({ ...props.widget, target: { kind: "form", formId: v } })}
            options={[
              { id: "", label: "(pick a form)" },
              ...allForms().map(({ form, tableName }) => ({
                id: form.id,
                label: `${tableName} · ${form.name}`,
                description: `${form.config.fields.length} fields · opens as modal`,
              })),
            ]}
          />
        </Show>
        <Show when={props.widget.target.kind === "url"}>
          <TextInput
            label="URL"
            value={() => (props.widget.target.kind === "url" ? props.widget.target.url : "")}
            onInput={(v) => props.onUpdate({ ...props.widget, target: { kind: "url", url: v } })}
            placeholder="https://..."
          />
        </Show>
      </div>
    </WidgetEditorSection>
  );
}

function MarkdownCellBody(props: { widget: MarkdownWidget; onUpdate: (w: MarkdownWidget) => void }) {
  return (
    <>
      <WidgetEditorSection title="Content" subtitle="Markdown is rendered in the dashboard cell." icon="ti ti-markdown">
        <WidgetInfoBlock
          title="Markdown widget"
          body="Adds instructions, notes, links, or context to a dashboard."
          detail="The editor stores Markdown. The dashboard renders it as HTML."
        />
        <TextInput
          label="Title"
          value={() => props.widget.title ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
          placeholder="Optional"
        />
        <MarkdownEditor
          value={() => props.widget.markdown ?? ""}
          onInput={(value) => props.onUpdate({ ...props.widget, markdown: value })}
          lines={12}
          placeholder="Add instructions, links, or context..."
        />
      </WidgetEditorSection>
    </>
  );
}

function WorkflowButtonCellBody(props: {
  widget: WorkflowButtonWidget;
  onUpdate: (w: WorkflowButtonWidget) => void;
  dashboardWorkflows: Workflow[];
}) {
  return (
    <WidgetEditorSection title="Action" subtitle="Run one workflow from this dashboard." icon="ti ti-route">
      <WidgetInfoBlock
        title="Workflow button"
        body="Shows a button that starts a dashboard workflow or opens a scanner workflow."
        detail="Users can press the button when they can open this dashboard and run the selected workflow. Workflow editing stays admin-only."
      />
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextInput
          label="Title"
          value={() => props.widget.title ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
          placeholder="Defaults to workflow name"
        />
        <TextInput
          label="Button text"
          value={() => props.widget.buttonLabel ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, buttonLabel: v || undefined })}
          placeholder="Run"
        />
        <TextInput
          label="Description"
          value={() => props.widget.description ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, description: v || undefined })}
          placeholder="Optional context shown above the button"
        />
        <Select
          label="Workflow"
          description="Workflows with dashboard or scanner launchers are listed."
          value={() => props.widget.launcherId}
          onChange={(v) => {
            const workflow = props.dashboardWorkflows.find((candidate) => dashboardWorkflowOption(candidate).dashboardLauncher.id === v);
            props.onUpdate({
              ...props.widget,
              launcherId: v,
              title: props.widget.title || workflow?.name || undefined,
            });
          }}
          options={[{ id: "", label: "(pick a workflow)" }, ...props.dashboardWorkflows.map(dashboardWorkflowSelectOption)]}
        />
      </div>
    </WidgetEditorSection>
  );
}

function WidgetEditorSection(props: { title: string; subtitle?: string; icon: string; children: JSX.Element }) {
  return (
    <PanelDialog.Section title={props.title} subtitle={props.subtitle} icon={props.icon}>
      {props.children}
    </PanelDialog.Section>
  );
}

function WidgetInfoBlock(props: { title: string; body: string; detail: string }) {
  return (
    <div class="info-block-info p-3 text-sm flex items-start gap-3">
      <i class="ti ti-info-circle mt-0.5 shrink-0 text-base" />
      <div class="min-w-0 flex flex-col gap-1">
        <p class="font-semibold leading-tight">{props.title}</p>
        <p>{props.body}</p>
        <p>{props.detail}</p>
      </div>
    </div>
  );
}

function sortedViews(tables: Array<{ id: string; name: string }>, viewsByTable: Record<string, View[]>) {
  const views: Array<{ view: View; tableName: string }> = [];
  for (const table of tables) {
    for (const view of viewsByTable[table.id] ?? []) views.push({ view, tableName: table.name });
  }
  views.sort((a, b) => a.view.name.localeCompare(b.view.name, undefined, { sensitivity: "base" }));
  return views;
}

function sortedForms(tables: Array<{ id: string; name: string }>, formsByTable: Record<string, Form[]>) {
  const forms: Array<{ form: Form; tableName: string }> = [];
  for (const table of tables) {
    for (const form of formsByTable[table.id] ?? []) forms.push({ form, tableName: table.name });
  }
  forms.sort((a, b) => a.form.name.localeCompare(b.form.name, undefined, { sensitivity: "base" }));
  return forms;
}

function validateWidgetDraft(widget: Widget, viewsByTable: Record<string, View[]>): string | null {
  if (widget.kind === "chart") {
    if (!widget.viewId) return "Pick a source view.";
    const view = Object.values(viewsByTable)
      .flat()
      .find((candidate) => candidate.id === widget.viewId);
    if (!view) return "Pick an existing source view.";
    if (!isChartReadyView(view)) return "Chart views need grouped rows and at least one summary value.";
    if (widget.chartType === "scatter" && aggregateItemsFromSource(view.source).length < 2) {
      return "Scatter needs two summary values.";
    }
  }
  if (widget.kind === "stat") {
    if (!widget.viewId) return "Pick a source view.";
    const view = Object.values(viewsByTable)
      .flat()
      .find((candidate) => candidate.id === widget.viewId);
    if (!view) return "Pick an existing source view.";
    if (widget.trend?.viewId) {
      const trendView = Object.values(viewsByTable)
        .flat()
        .find((candidate) => candidate.id === widget.trend?.viewId);
      if (!trendView) return "Pick an existing trend view.";
    }
  }
  if (widget.kind === "view") {
    if (!widget.viewId) return "Pick a view.";
  }
  if (widget.kind === "link") {
    if (widget.target.kind === "url") {
      try {
        const url = new URL(widget.target.url);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "URL must use http or https.";
      } catch {
        return "Enter a valid URL.";
      }
      return null;
    }
    if (widget.target.kind === "dashboard" && !widget.target.dashboardId) return "Pick a dashboard.";
    if (widget.target.kind === "table" && !widget.target.tableId) return "Pick a table.";
    if (widget.target.kind === "view" && !widget.target.viewId) return "Pick a view.";
    if (widget.target.kind === "form" && !widget.target.formId) return "Pick a form.";
  }
  if (widget.kind === "workflow-button" && !widget.launcherId) return "Pick a workflow.";
  return null;
}

function selectItemsFromSource(source: string): string[] {
  return splitSourceList(sourceClause(source, "select"));
}

function groupItemsFromSource(source: string): string[] {
  return splitSourceList(sourceClause(source, "group\\s+by"));
}

function aggregateItemsFromSource(source: string): string[] {
  return splitSourceList(sourceClause(source, "aggregate"));
}

function sourceClause(source: string, keywordPattern: string): string {
  const match = source.match(
    new RegExp(
      `(?:^|\\n)\\s*${keywordPattern}\\b([\\s\\S]*?)(?=\\n\\s*(?:from|join|select|where|group\\s+by|aggregate|sort|limit|search|include\\s+deleted|deleted\\s+only)\\b|$)`,
      "i",
    ),
  );
  return match?.[1]?.trim() ?? "";
}

function splitSourceList(input: string): string[] {
  const items: string[] = [];
  let current = "";
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote) {
      current += ch;
      if (ch === quote && input[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      if (current.trim()) items.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function aliasFromSourceItem(item: string): string | null {
  const match = item.match(/\bas\s+("[^"]+"|'[^']+'|[^\s,]+)\s*$/i);
  return match ? readableSourceName(match[1]!) : null;
}

function readableSourceName(input: string): string {
  const trimmed = input.trim();
  const withoutAlias = trimmed.replace(/\bas\s+("[^"]+"|'[^']+'|[^\s,]+)\s*$/i, "").trim();
  const token = withoutAlias
    .match(/"([^"]+)"|'([^']+)'|\{([^}]+)\}|([A-Za-z0-9_ -]+)$/)
    ?.slice(1)
    .find(Boolean);
  return (token ?? withoutAlias).replace(/[_-]+/g, " ").trim();
}
