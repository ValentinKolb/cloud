import { dialogCore, IconInput, MarkdownEditor, prompts, Select, TextInput } from "@valentinkolb/cloud/ui";
import { createMemo, createSignal, Show, type JSX } from "solid-js";
import type { AggregationSpec } from "../../contracts";
import type { ChartWidget, Dashboard, Field, Form, FormWidget, LinkWidget, MarkdownWidget, StatWidget, View, ViewStatsWidget, ViewWidget, Widget } from "../../service";
import { formatWidgetValue } from "./dashboard/widget-format";
import { GridsBareDialog, gridsBareDialogOptions } from "./dialog-layout";

export const DEFAULT_AGG: AggregationSpec = { fieldId: "*", agg: "count" };

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

export const isChartReadyView = (view: View): boolean => (view.query.groupBy?.length ?? 0) > 0 && (view.query.aggregations?.length ?? 0) > 0;

const isChartReadyForType = (view: View, chartType: ChartWidget["chartType"]): boolean => {
  if (!isChartReadyView(view)) return false;
  if (chartType === "scatter") return (view.query.aggregations?.length ?? 0) >= 2;
  return true;
};

export const defaultStatWidget = (tableId: string): StatWidget => ({
  id: newId("w"),
  kind: "stat",
  span: 3,
  title: "New stat",
  format: "plain",
  tone: "blue",
  source: { tableId, aggregations: [DEFAULT_AGG] },
});

export const defaultViewWidget = (): ViewWidget => ({
  id: newId("w"),
  kind: "view",
  span: 6,
  source: { kind: "view", viewId: "" },
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

export type CellEditDialogResult = { action: "save"; widget: Widget } | { action: "delete" };

export const openCellEditDialog = (
  widget: Widget,
  ctx: {
    tables: Array<{ id: string; name: string; slug: string }>;
    dashboards: Dashboard[];
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
  };
  const icon: Record<Widget["kind"], string> = {
    stat: "ti ti-number",
    view: "ti ti-table-spark",
    chart: "ti ti-chart-bar",
    "view-stats": "ti ti-layout-2",
    form: "ti ti-forms",
    markdown: "ti ti-markdown",
    link: "ti ti-link",
  };

  return dialogCore.open<CellEditDialogResult>((close) => {
    const [draft, setDraft] = createSignal<Widget>(widget);
    return (
      <GridsBareDialog title={title[widget.kind]} icon={icon[widget.kind]} close={() => close()}>
        <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <Show when={draft().kind === "chart" ? (draft() as ChartWidget) : null}>
            {(chart) => <ChartWidgetInfoBlock chartType={chart().chartType} />}
          </Show>
          <CellEditorBody
            widget={draft()}
            onUpdate={(next) => setDraft(next)}
            tables={ctx.tables}
            dashboards={ctx.dashboards}
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
          <footer class="paper flex items-center gap-2 p-4">
            <Show when={options.allowDelete}>
              <button type="button" class="btn-danger btn-sm" onClick={() => close({ action: "delete" })}>
                <i class="ti ti-trash" /> Delete widget
              </button>
            </Show>
            <div class="ml-auto flex items-center gap-2">
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
          </footer>
        </div>
      </GridsBareDialog>
    );
  }, gridsBareDialogOptions);
};

function CellEditorBody(props: {
  widget: Widget;
  onUpdate: (w: Widget) => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  dashboards: Dashboard[];
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
          fieldsByTable={props.fieldsByTable}
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
  }
}

const AGG_OPTIONS = [
  { id: "count", label: "count" },
  { id: "countEmpty", label: "count empty" },
  { id: "countUnique", label: "count unique" },
  { id: "sum", label: "sum" },
  { id: "avg", label: "avg" },
  { id: "min", label: "min" },
  { id: "max", label: "max" },
];

const NUMERIC_AGG_FIELD_TYPES = new Set(["number", "decimal", "autonumber", "percent", "duration"]);
const MIN_MAX_FIELD_TYPES = new Set([...NUMERIC_AGG_FIELD_TYPES, "date", "text", "longtext"]);

function fieldWorksForAgg(field: Field, agg: AggregationSpec["agg"]): boolean {
  if (field.deletedAt) return false;
  if (field.type === "relation" || field.type === "formula" || field.type === "lookup" || field.type === "rollup") return false;
  if (agg === "count" || agg === "countEmpty" || agg === "countUnique") return true;
  if (agg === "sum" || agg === "avg") return NUMERIC_AGG_FIELD_TYPES.has(field.type);
  if (agg === "min" || agg === "max") return MIN_MAX_FIELD_TYPES.has(field.type);
  return false;
}

function normalizeAggForFields(agg: AggregationSpec, fields: Field[]): AggregationSpec {
  if (agg.fieldId === "*" && agg.agg === "count") return agg;
  const field = fields.find((f) => f.id === agg.fieldId);
  if (field && fieldWorksForAgg(field, agg.agg)) return agg;
  const first = fields.find((f) => fieldWorksForAgg(f, agg.agg));
  return first ? { ...agg, fieldId: first.id } : DEFAULT_AGG;
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
  fieldsByTable: Record<string, Field[]>;
}) {
  const fields = () => (props.fieldsByTable[props.widget.source.tableId] ?? []).filter((f) => !f.deletedAt);
  const currentAgg = () => props.widget.source.aggregations[0] ?? DEFAULT_AGG;
  const fieldOptions = () => {
    const agg = currentAgg().agg;
    const options = fields()
      .filter((field) => fieldWorksForAgg(field, agg))
      .map((field) => ({ id: field.id, label: field.name, description: field.type }));
    return agg === "count" ? [{ id: "*", label: "* (records)", description: "Counts all records." }, ...options] : options;
  };

  const updateAgg = (patch: Partial<AggregationSpec>) => {
    const nextAgg = normalizeAggForFields({ ...currentAgg(), ...patch }, fields());
    props.onUpdate({
      ...props.widget,
      source: {
        ...props.widget.source,
        aggregations: [nextAgg],
      },
    });
  };

  return (
    <WidgetEditorSection title="Source" subtitle="Pick the table and the value this stat should show." icon="ti ti-database">
      <WidgetInfoBlock
        title="Stat widget"
        body="Shows one number from one table. Pick an aggregation, then a compatible field."
        detail="Use Count + * (records) for record totals. Sum and Average only work on number-like fields."
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
          label="Source table"
          value={() => props.widget.source.tableId}
          onChange={(v) =>
            props.onUpdate({
              ...props.widget,
              source: { ...props.widget.source, tableId: v, aggregations: [normalizeAggForFields(DEFAULT_AGG, props.fieldsByTable[v] ?? [])] },
            })
          }
          options={props.tables.map((t) => ({ id: t.id, label: t.name }))}
        />
        <Select
          label="Aggregation"
          value={() => props.widget.source.aggregations[0]?.agg ?? "count"}
          onChange={(v) => updateAgg({ agg: v as AggregationSpec["agg"] })}
          options={AGG_OPTIONS}
        />
        <Select
          label="Field"
          value={() => props.widget.source.aggregations[0]?.fieldId ?? "*"}
          onChange={(v) => updateAgg({ fieldId: v })}
          options={fieldOptions()}
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
      <StatTrendSection widget={props.widget} fields={fields()} onUpdate={props.onUpdate} />
    </WidgetEditorSection>
  );
}

function StatTrendSection(props: { widget: StatWidget; fields: Field[]; onUpdate: (w: StatWidget) => void }) {
  const dateFields = () => props.fields.filter((f) => f.type === "date");
  const trend = () => props.widget.source.trend;

  const enable = () => {
    const first = dateFields()[0];
    if (!first) return;
    props.onUpdate({
      ...props.widget,
      source: {
        ...props.widget.source,
        trend: { fieldId: first.id, granularity: "month", windowSize: 12 },
      },
    });
  };

  const disable = () => {
    const { trend: _drop, ...source } = props.widget.source;
    props.onUpdate({ ...props.widget, source });
  };

  const patchTrend = (patch: Partial<NonNullable<StatWidget["source"]["trend"]>>) => {
    const current = trend();
    if (!current) return;
    props.onUpdate({ ...props.widget, source: { ...props.widget.source, trend: { ...current, ...patch } } });
  };

  return (
    <Show when={dateFields().length > 0}>
      <div class="flex flex-col gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold uppercase tracking-wider text-dimmed">Trend</span>
          <Show
            when={trend()}
            fallback={
              <button type="button" class="btn-input btn-sm" onClick={enable}>
                <i class="ti ti-plus" /> Add trend
              </button>
            }
          >
            <button type="button" class="btn-input btn-sm" onClick={disable}>
              Remove trend
            </button>
          </Show>
        </div>
        <p class="text-xs text-dimmed">
          Adds a small history line using the same stat value grouped by a date field.
        </p>
        <Show when={trend()}>
          {(t) => (
            <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Select
                label="Date field"
                value={() => t().fieldId}
                onChange={(v) => patchTrend({ fieldId: v })}
                options={dateFields().map((f) => ({ id: f.id, label: f.name }))}
              />
              <Select
                label="Bucket by"
                value={() => t().granularity}
                onChange={(v) => patchTrend({ granularity: v as NonNullable<StatWidget["source"]["trend"]>["granularity"] })}
                options={[
                  { id: "day", label: "Day" },
                  { id: "week", label: "Week" },
                  { id: "month", label: "Month" },
                  { id: "quarter", label: "Quarter" },
                  { id: "year", label: "Year" },
                ]}
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
  const setSourceKind = (kind: "view" | "table") => {
    if (props.widget.source.kind === kind) return;
    props.onUpdate({
      ...props.widget,
      source: kind === "view" ? { kind: "view", viewId: "" } : { kind: "table", tableId: props.tables[0]?.id ?? "" },
    });
  };

  return (
    <WidgetEditorSection title="Source" subtitle="Use a saved view for filters, or a raw table for recent records." icon="ti ti-table">
      <WidgetInfoBlock
        title="Embedded records"
        body="Shows records inside the dashboard."
        detail="Saved views keep their filters, sorting, and columns. Tables show recent records without saved filters."
      />
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-dimmed">Source</span>
        <button
          type="button"
          class={props.widget.source.kind === "view" ? "btn-input-primary btn-sm" : "btn-input btn-sm"}
          onClick={() => setSourceKind("view")}
        >
          Saved view
        </button>
        <button
          type="button"
          class={props.widget.source.kind === "table" ? "btn-input-primary btn-sm" : "btn-input btn-sm"}
          onClick={() => setSourceKind("table")}
        >
          Table
        </button>
      </div>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextInput
          label="Title"
          value={() => props.widget.title ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
          placeholder={props.widget.source.kind === "view" ? "Defaults to the view name" : "Defaults to the table name"}
        />
        <Show
          when={props.widget.source.kind === "view"}
          fallback={
            <Select
              label="Table"
              value={() => (props.widget.source.kind === "table" ? props.widget.source.tableId : "")}
              onChange={(v) => props.onUpdate({ ...props.widget, source: { kind: "table", tableId: v } })}
              options={[{ id: "", label: "(pick a table)" }, ...props.tables.map((t) => ({ id: t.id, label: t.name, description: "Recent records, no saved filters." }))]}
            />
          }
        >
          <Select
            label="View"
            value={() => (props.widget.source.kind === "view" ? props.widget.source.viewId : "")}
            onChange={(v) => props.onUpdate({ ...props.widget, source: { kind: "view", viewId: v } })}
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
      </div>
    </WidgetEditorSection>
  );
}

const CHART_TYPE_OPTIONS: { id: ChartWidget["chartType"]; label: string; icon: string }[] = [
  { id: "donut", label: "Donut", icon: "ti ti-chart-donut-4" },
  { id: "bar", label: "Bar", icon: "ti ti-chart-bar" },
  { id: "line", label: "Line", icon: "ti ti-chart-line" },
  { id: "scatter", label: "Scatter", icon: "ti ti-chart-dots" },
];

const CHART_TYPE_INFO: Record<ChartWidget["chartType"], { title: string; body: string; requirement: string; example: string }> = {
  donut: {
    title: "Donut chart",
    body: "Use this when you want to show parts of one total, for example tasks by status or revenue by product group.",
    requirement: "The source view needs Group by for the slices and one Aggregation for the slice size.",
    example: "Example: Group by Status, Aggregation Count.",
  },
  bar: {
    title: "Bar chart",
    body: "Use this when you want to compare categories side by side, for example sales per month or tickets per team.",
    requirement: "The source view needs Group by for the bars and one Aggregation for the bar height.",
    example: "Example: Group by Month, Aggregation Sum Amount.",
  },
  line: {
    title: "Line chart",
    body: "Use this when you want to show change over time or another ordered list, for example monthly income.",
    requirement: "The source view needs Group by for the x-axis and one or more Aggregations for the lines.",
    example: "Example: Group by Month, Aggregation Sum Amount.",
  },
  scatter: {
    title: "Scatter chart",
    body: "Use this when you want to compare two numbers for each category, for example hours spent vs revenue.",
    requirement: "The source view needs Group by and at least two Aggregations. The first Aggregation is X, the second is Y.",
    example: "Example: Group by Customer, Aggregations Sum Hours and Sum Revenue.",
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
        <Show when={props.widget.chartType !== "donut"}>
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
  if (chartType !== "donut") return { ...widget, chartType };
  const { format: _format, xAxisLabel: _xAxisLabel, yAxisLabel: _yAxisLabel, ...rest } = widget;
  return { ...rest, chartType };
}

function chartViewDescription(chartType: ChartWidget["chartType"], view: View, fields: Field[]): string {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const category = labelForGroupBy(view, fieldsById);
  const firstValue = labelForAggregation(view, fieldsById, 0);
  const secondValue = labelForAggregation(view, fieldsById, 1);
  const categoryCount = view.query.groupBy?.length ?? 0;
  const valueCount = view.query.aggregations?.length ?? 0;
  const counts = `${categoryCount} ${categoryCount === 1 ? "category" : "categories"} · ${valueCount} ${valueCount === 1 ? "value" : "values"}`;

  if (chartType === "donut") return `Slices ${category} by ${firstValue} · ${counts}`;
  if (chartType === "scatter") return `Plots ${firstValue} against ${secondValue} by ${category} · ${counts}`;
  return `Plots ${category} against ${firstValue} · ${counts}`;
}

function labelForGroupBy(view: View, fieldsById: Map<string, Field>): string {
  const group = view.query.groupBy?.[0];
  if (!group) return "category";
  const field = fieldsById.get(group.fieldId);
  return group.label?.trim() || field?.name || "category";
}

function labelForAggregation(view: View, fieldsById: Map<string, Field>, index: number): string {
  const aggregation = view.query.aggregations?.[index];
  if (!aggregation) return `value ${index + 1}`;
  if (aggregation.label?.trim()) return aggregation.label.trim();
  if (aggregation.fieldId === "*") return readableAgg(aggregation.agg);
  const field = fieldsById.get(aggregation.fieldId);
  return `${readableAgg(aggregation.agg)} ${field?.name ?? "value"}`;
}

function readableAgg(agg: AggregationSpec["agg"]): string {
  const labels: Record<AggregationSpec["agg"], string> = {
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
  if ((view.query.columns?.length ?? 0) > 0) parts.push(`${view.query.columns!.length} columns`);
  if (view.query.filter) parts.push("filtered");
  if ((view.query.groupBy?.length ?? 0) > 0) parts.push("grouped");
  if ((view.query.sort?.length ?? 0) > 0) parts.push("sorted");
  return parts.length > 0 ? parts.join(" · ") : "Saved columns and records.";
}

function viewStatsViewDescription(view: View): string {
  const groupBy = view.query.groupBy?.length ?? 0;
  const aggs = view.query.aggregations?.length ?? 0;
  if (groupBy > 0) return `First group bucket · ${aggs} ${aggs === 1 ? "value" : "values"}`;
  return "First record · visible fields";
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
            options={[{ id: "", label: "(pick a dashboard)" }, ...props.dashboards.map((d) => ({ id: d.id, label: d.name, description: d.description ?? undefined }))]}
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
              ...allViews().map(({ view, tableName }) => ({ id: view.id, label: `${tableName} · ${view.name}`, description: embeddedViewDescription(view) })),
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

function WidgetEditorSection(props: { title: string; subtitle?: string; icon: string; children: JSX.Element }) {
  return (
    <section class="paper p-4">
      <header class="mb-2 flex items-start gap-2">
        <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-dimmed dark:bg-zinc-800">
          <i class={`${props.icon} text-sm`} />
        </span>
        <div class="min-w-0">
          <h3 class="text-xs font-semibold uppercase tracking-[0.12em] text-secondary">{props.title}</h3>
          <Show when={props.subtitle}>
            <p class="mt-0.5 text-[11px] leading-snug text-dimmed">{props.subtitle}</p>
          </Show>
        </div>
      </header>
      <div class="flex flex-col gap-3">{props.children}</div>
    </section>
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
    if (!isChartReadyView(view)) return "Chart views need Group by and Aggregation.";
    if (widget.chartType === "scatter" && (view.query.aggregations?.length ?? 0) < 2) return "Scatter needs two Aggregations.";
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
  return null;
}
