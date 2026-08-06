import type { DateContext } from "@k2b/stdlib";
import {
  NoticeCard,
  Button,
  confirmDiscardIfDirty,
  dialogCore,
  IconInput,
  MarkdownEditor,
  NumberInput,
  PanelDialog,
  panelDialogOptions,
  prompts,
  SegmentedControl,
  Select,
  TextInput,
} from "@k2b/ui";
import { createMemo, createSignal, type JSX, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import { gqlSourceRef } from "../../../query-dsl/source-format";
import type {
  ChartWidget,
  Dashboard,
  DashboardWidgetSource,
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
  WidgetValueFormat,
  Workflow,
  WorkflowButtonWidget,
} from "../../../service";
import { formatWidgetValue } from "../dashboard/widget-format";
import { GqlSourceEditor } from "../query/GqlSourceEditor";
import { errorMessage } from "../utils/api-helpers";
import { dashboardWorkflowOption, dashboardWorkflowSelectOption } from "./dashboard-workflow-options";

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

export const isChartReadyView = (view: View): boolean =>
  groupItemsFromSource(view.source).length > 0 && aggregateItemsFromSource(view.source).length > 0;

const isChartReadyForType = (view: View, chartType: ChartWidget["chartType"]): boolean => {
  if (!isChartReadyView(view)) return false;
  if (chartType === "scatter") return aggregateItemsFromSource(view.source).length >= 2;
  return true;
};

const tableQuery = (tableId: string, suffix = "") =>
  tableId ? `from ${gqlSourceRef("table", tableId)}${suffix ? `\n${suffix}` : ""}` : "";

export const defaultStatWidget = (tableId: string): StatWidget => ({
  id: newId("w"),
  kind: "stat",
  span: 3,
  title: "New stat",
  valueFormat: { style: "number" },
  tone: "blue",
  source: { kind: "gql", source: tableQuery(tableId, "aggregate count(*) as value") },
});

export const defaultViewWidget = (tableId: string): ViewWidget => ({
  id: newId("w"),
  kind: "view",
  span: 6,
  source: { kind: "gql", source: tableQuery(tableId, "limit 25") },
});

export const defaultChartWidget = (tableId: string): ChartWidget => ({
  id: newId("w"),
  kind: "chart",
  span: 6,
  chartType: "bar",
  title: "New chart",
  source: { kind: "gql", source: tableQuery(tableId) },
});

export const defaultViewStatsWidget = (tableId: string): ViewStatsWidget => ({
  id: newId("w"),
  kind: "view-stats",
  span: 6,
  source: { kind: "gql", source: tableQuery(tableId, "limit 1") },
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
    baseId: string;
    dashboardId: string;
    tables: Array<{ id: string; name: string; slug: string }>;
    dashboards: Dashboard[];
    dashboardWorkflows: Workflow[];
    fieldsByTable: Record<string, Field[]>;
    viewsByTable: Record<string, View[]>;
    formsByTable: Record<string, Form[]>;
    dateConfig?: DateContext;
  },
  options: { allowDelete?: boolean } = {},
): Promise<CellEditDialogResult | undefined> => {
  const title: Record<Widget["kind"], string> = {
    stat: "number",
    view: "records",
    chart: "chart",
    "view-stats": "summary",
    form: "form",
    markdown: "text",
    link: "link",
    "workflow-button": "workflow",
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
    const original = JSON.stringify(widget);
    const [draft, setDraft] = createSignal<Widget>(widget);
    const [validationError, setValidationError] = createSignal<string | null>(null);
    const [validating, setValidating] = createSignal(false);
    let validationErrorElement: HTMLDivElement | undefined;
    const isDirty = () => JSON.stringify(draft()) !== original;
    const closeIfClean = async () => {
      if (await confirmDiscardIfDirty(isDirty)) close();
    };
    const showValidationError = (message: string) => {
      setValidationError(message);
      queueMicrotask(() => {
        validationErrorElement?.scrollIntoView({ block: "nearest" });
        validationErrorElement?.focus();
      });
    };
    const updateDraft = (next: Widget) => {
      setValidationError(null);
      setDraft(next);
    };

    const save = async () => {
      const localError = validateWidgetDraft(draft(), ctx.viewsByTable);
      if (localError) {
        showValidationError(localError);
        return;
      }
      if (isQueryWidget(draft())) {
        setValidating(true);
        try {
          const response = await apiClient.dashboards[":dashboardId"].widgets.resolve.$post({
            param: { dashboardId: ctx.dashboardId },
            json: draft(),
          });
          if (!response.ok) throw new Error(await errorMessage(response, "Could not validate widget data"));
          const resolved = await response.json();
          if (resolved.kind === "error") {
            showValidationError(resolved.reason);
            return;
          }
        } catch (error) {
          showValidationError(error instanceof Error ? error.message : "Could not validate widget data");
          return;
        } finally {
          setValidating(false);
        }
      }
      close({ action: "save", widget: draft() });
    };
    const remove = async () => {
      const confirmed = await prompts.confirm("Delete this widget from the dashboard?", {
        title: "Delete widget?",
        variant: "danger",
        confirmText: "Delete",
      });
      if (confirmed) close({ action: "delete" });
    };
    const action = options.allowDelete ? "Edit" : "Add";

    return (
      <PanelDialog>
        <PanelDialog.Header title={`${action} ${title[widget.kind]} widget`} icon={icon[widget.kind]} close={() => void closeIfClean()} />
        <PanelDialog.Body>
          <Show when={validationError()}>
            {(message) => (
              <NoticeCard ref={validationErrorElement} tone="danger" icon={false} role="alert" tabIndex={-1}>
                {message()}
              </NoticeCard>
            )}
          </Show>
          <CellEditorBody
            widget={draft()}
            onUpdate={updateDraft}
            baseId={ctx.baseId}
            tables={ctx.tables}
            dashboards={ctx.dashboards}
            dashboardWorkflows={ctx.dashboardWorkflows}
            fieldsByTable={ctx.fieldsByTable}
            viewsByTable={ctx.viewsByTable}
            formsByTable={ctx.formsByTable}
            dateConfig={ctx.dateConfig}
          />
          <WidgetEditorSection title="Layout" subtitle="Choose how much horizontal space this widget uses." icon="ti ti-layout-columns">
            <Select
              label="Widget width"
              value={() => String(draft().span ?? 12)}
              onValueChange={(v) => setDraft({ ...draft(), span: Number(v) } as Widget)}
              options={[
                { id: "3", label: "Quarter row", description: "Best for a compact number or action." },
                { id: "4", label: "Third row", description: "Three equal widgets per row." },
                { id: "6", label: "Half row", description: "Two equal widgets per row." },
                { id: "8", label: "Two-thirds row", description: "A wide widget with room beside it." },
                { id: "9", label: "Three-quarters row", description: "A wide widget with a compact companion." },
                { id: "12", label: "Full row", description: "Uses all available width." },
              ]}
            />
          </WidgetEditorSection>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <Show when={options.allowDelete} fallback={<span />}>
            <Button variant="danger" size="sm" type="button" onClick={() => void remove()}>
              <i class="ti ti-trash" /> Delete widget
            </Button>
          </Show>
          <div class="flex items-center gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => void closeIfClean()}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="button" disabled={validating()} onClick={() => void save()}>
              <Show when={validating()} fallback={<i class="ti ti-check" />}>
                <i class="ti ti-loader-2 animate-spin" />
              </Show>
              {options.allowDelete ? "Save changes" : "Add widget"}
            </Button>
          </div>
        </PanelDialog.Footer>
      </PanelDialog>
    );
  }, panelDialogOptions);
};

function CellEditorBody(props: {
  widget: Widget;
  onUpdate: (w: Widget) => void;
  baseId: string;
  tables: Array<{ id: string; name: string; slug: string }>;
  dashboards: Dashboard[];
  dashboardWorkflows: Workflow[];
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
  formsByTable: Record<string, Form[]>;
  dateConfig?: DateContext;
}) {
  switch (props.widget.kind) {
    case "stat":
      return (
        <StatCellBody
          widget={props.widget}
          onUpdate={props.onUpdate as (w: StatWidget) => void}
          baseId={props.baseId}
          tables={props.tables}
          viewsByTable={props.viewsByTable}
          dateConfig={props.dateConfig}
        />
      );
    case "view":
      return (
        <ViewCellBody
          widget={props.widget}
          onUpdate={props.onUpdate as (w: ViewWidget) => void}
          baseId={props.baseId}
          tables={props.tables}
          viewsByTable={props.viewsByTable}
        />
      );
    case "chart":
      return (
        <ChartCellBody
          widget={props.widget}
          onUpdate={props.onUpdate as (w: ChartWidget) => void}
          baseId={props.baseId}
          tables={props.tables}
          fieldsByTable={props.fieldsByTable}
          viewsByTable={props.viewsByTable}
          dateConfig={props.dateConfig}
        />
      );
    case "view-stats":
      return (
        <ViewStatsCellBody
          widget={props.widget}
          onUpdate={props.onUpdate as (w: ViewStatsWidget) => void}
          baseId={props.baseId}
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

const VALUE_FORMAT_OPTIONS = [
  { id: "number", label: "Number" },
  { id: "integer", label: "Integer" },
  { id: "percent", label: "Percent" },
];

function DashboardValueFormatEditor(props: {
  value: WidgetValueFormat | undefined;
  onChange: (value: WidgetValueFormat) => void;
  dateConfig?: DateContext;
  label?: string;
}) {
  const value = (): WidgetValueFormat => props.value ?? { style: "number" };
  const setStyle = (style: WidgetValueFormat["style"]) => {
    const current = value();
    if (style === "percent") {
      props.onChange({ style, ...(current.style === "integer" ? {} : { decimalPlaces: current.decimalPlaces }) });
      return;
    }
    props.onChange({
      style,
      ...(style === "integer" || current.decimalPlaces === undefined ? {} : { decimalPlaces: current.decimalPlaces }),
      ...(style === "number" && current.unit ? { unit: current.unit, unitPosition: current.unitPosition ?? "suffix" } : {}),
    });
  };
  const setUnit = (unit: string) => {
    if (!unit.trim()) {
      const { unit: _unit, unitPosition: _unitPosition, ...rest } = value();
      props.onChange(rest);
      return;
    }
    props.onChange({ ...value(), unit, unitPosition: value().unitPosition ?? "suffix" });
  };

  return (
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Select
        label={props.label ?? "Format"}
        value={() => value().style}
        onValueChange={(style) => setStyle(style as WidgetValueFormat["style"])}
        options={VALUE_FORMAT_OPTIONS}
      />
      <Show when={value().style !== "integer"}>
        <NumberInput
          label="Decimal places"
          description="Leave empty for an automatic compact value."
          min={0}
          max={20}
          value={() => value().decimalPlaces ?? null}
          onValueChange={(decimalPlaces) =>
            props.onChange({ ...value(), ...(decimalPlaces === null ? { decimalPlaces: undefined } : { decimalPlaces }) })
          }
          clearable
        />
      </Show>
      <Show when={value().style === "number"}>
        <TextInput
          label="Unit"
          description="Optional text such as EUR, kg, or hours."
          value={() => value().unit ?? ""}
          onValueChange={setUnit}
          maxLength={20}
        />
        <Show when={value().unit}>
          <Select
            label="Unit position"
            value={() => value().unitPosition ?? "suffix"}
            onValueChange={(unitPosition) => props.onChange({ ...value(), unitPosition: unitPosition as "prefix" | "suffix" })}
            options={[
              { id: "prefix", label: "Before value" },
              { id: "suffix", label: "After value" },
            ]}
          />
        </Show>
      </Show>
      <p class="text-xs text-dimmed md:col-span-2">
        Preview: <code class="font-mono">{formatWidgetValue("1234.56", value(), props.dateConfig)}</code>
      </p>
    </div>
  );
}

const STAT_TONE_OPTIONS = [
  { id: "blue", label: "Blue", description: "Default for neutral numbers." },
  { id: "neutral", label: "Neutral", description: "Use when color should not signal anything." },
  { id: "green", label: "Green", description: "Positive or healthy value." },
  { id: "amber", label: "Amber", description: "Needs attention." },
  { id: "red", label: "Red", description: "Problem or error-like value." },
];

type DashboardSourceViewOption = { view: View; tableName: string; description?: string };

function DashboardDataSourceEditor(props: {
  baseId: string;
  source: DashboardWidgetSource;
  onChange: (source: DashboardWidgetSource) => void;
  views: DashboardSourceViewOption[];
  defaultGql: string;
  queryPlaceholder: string;
}) {
  const [queryDraft, setQueryDraft] = createSignal(props.source.kind === "gql" ? props.source.source : props.defaultGql);
  const [viewDraft, setViewDraft] = createSignal(props.source.kind === "view" ? props.source.viewId : (props.views[0]?.view.id ?? ""));

  const switchMode = (kind: DashboardWidgetSource["kind"]) => {
    if (kind === "gql") {
      props.onChange({ kind: "gql", source: queryDraft() });
      return;
    }
    props.onChange({ kind: "view", viewId: viewDraft() });
  };

  return (
    <div class="flex flex-col gap-2">
      <div class="flex justify-end">
        <SegmentedControl
          ariaLabel="Dashboard widget data source"
          value={() => props.source.kind}
          onValueChange={switchMode}
          options={[
            { value: "view", label: "Saved view", icon: "ti ti-bookmark" },
            { value: "gql", label: "Query", icon: "ti ti-code" },
          ]}
        />
      </div>
      <Show
        when={props.source.kind === "gql"}
        fallback={
          <Select
            label="Saved view"
            value={() => (props.source.kind === "view" ? props.source.viewId : viewDraft())}
            onValueChange={(viewId) => {
              if (viewId === null) return;
              setViewDraft(viewId);
              props.onChange({ kind: "view", viewId });
            }}
            options={[
              {
                id: "",
                label: props.views.length > 0 ? "(pick a view)" : "No saved views available",
              },
              ...props.views.map(({ view, tableName, description }) => ({
                id: view.id,
                label: `${tableName} · ${view.name}`,
                description,
              })),
            ]}
          />
        }
      >
        <div class="flex flex-col gap-1">
          <span class="text-xs font-medium text-primary">GQL query</span>
          <GqlSourceEditor
            baseId={props.baseId}
            value={() => (props.source.kind === "gql" ? props.source.source : queryDraft())}
            onValueChange={(source) => {
              setQueryDraft(source);
              props.onChange({ kind: "gql", source });
            }}
            lines={8}
            spellcheck={false}
            aria-label="Widget GQL source"
            placeholder={props.queryPlaceholder}
            variant="paper"
          />
        </div>
      </Show>
    </div>
  );
}

function StatCellBody(props: {
  widget: StatWidget;
  onUpdate: (w: StatWidget) => void;
  baseId: string;
  tables: Array<{ id: string; name: string; slug: string }>;
  viewsByTable: Record<string, View[]>;
  dateConfig?: DateContext;
}) {
  const allViews = createMemo(() => sortedViews(props.tables, props.viewsByTable));

  return (
    <WidgetEditorSection title="Source" subtitle="Choose the value calculated by this widget." icon="ti ti-database">
      <DashboardDataSourceEditor
        baseId={props.baseId}
        source={props.widget.source}
        onChange={(source) => props.onUpdate({ ...props.widget, source })}
        views={allViews().map(({ view, tableName }) => ({ view, tableName, description: statViewDescription(view) }))}
        defaultGql={tableQuery(props.tables[0]?.id ?? "", "aggregate count(*) as value")}
        queryPlaceholder={"from table Orders\nwhere Status = 'Open'\naggregate count(*) as value"}
      />
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextInput
          label="Title"
          value={() => props.widget.title ?? ""}
          onValueChange={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
        />
        <TextInput
          label="Sub-line"
          value={() => props.widget.sub ?? ""}
          onValueChange={(v) => props.onUpdate({ ...props.widget, sub: v || undefined })}
          placeholder="e.g. last 24h"
        />
        <Select
          label="Value color"
          value={() => props.widget.tone ?? "blue"}
          onValueChange={(v) => props.onUpdate({ ...props.widget, tone: v as StatWidget["tone"] })}
          options={STAT_TONE_OPTIONS}
        />
        <IconInput
          label="Icon"
          value={() => props.widget.icon ?? ""}
          onValueChange={(v) => props.onUpdate({ ...props.widget, icon: v || undefined })}
          placeholder="Search icons..."
        />
      </div>
      <DashboardValueFormatEditor
        value={props.widget.valueFormat}
        onChange={(valueFormat) => props.onUpdate({ ...props.widget, valueFormat })}
        dateConfig={props.dateConfig}
      />
      <StatTrendSection
        widget={props.widget}
        views={allViews().filter(({ view }) => isChartReadyView(view))}
        baseId={props.baseId}
        defaultGql={tableQuery(props.tables[0]?.id ?? "")}
        onUpdate={props.onUpdate}
      />
    </WidgetEditorSection>
  );
}

function StatTrendSection(props: {
  widget: StatWidget;
  views: Array<{ view: View; tableName: string }>;
  baseId: string;
  defaultGql: string;
  onUpdate: (w: StatWidget) => void;
}) {
  const trend = () => props.widget.trend;

  const enable = () => {
    const first = props.views[0]?.view;
    props.onUpdate({
      ...props.widget,
      trend: {
        source: first ? { kind: "view", viewId: first.id } : { kind: "gql", source: props.defaultGql },
        windowSize: 12,
      },
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
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-semibold uppercase tracking-wider text-dimmed">Trend</span>
        <Show
          when={trend()}
          fallback={
            <Button variant="success" size="sm" type="button" onClick={enable}>
              <i class="ti ti-plus" /> Add trend
            </Button>
          }
        >
          <Button variant="secondary" size="sm" type="button" onClick={disable}>
            Remove trend
          </Button>
        </Show>
      </div>
      <p class="text-xs text-dimmed">Adds a small history line from grouped saved-view or query data.</p>
      <Show when={trend()}>
        {(t) => (
          <div class="flex flex-col gap-3">
            <DashboardDataSourceEditor
              baseId={props.baseId}
              source={t().source}
              onChange={(source) => patchTrend({ source })}
              views={props.views.map(({ view, tableName }) => ({ view, tableName, description: statViewDescription(view) }))}
              defaultGql={props.defaultGql}
              queryPlaceholder={"from table Orders\ngroup by CreatedAt by month\naggregate sum(Total) as revenue\nsort CreatedAt asc"}
            />
            <Select
              label="Window size"
              value={() => String(t().windowSize)}
              onValueChange={(v) => patchTrend({ windowSize: Number(v) })}
              options={[6, 8, 12, 24, 30].map((n) => ({ id: String(n), label: `Last ${n}` }))}
            />
          </div>
        )}
      </Show>
    </div>
  );
}

function ViewStatsCellBody(props: {
  widget: ViewStatsWidget;
  onUpdate: (w: ViewStatsWidget) => void;
  baseId: string;
  tables: Array<{ id: string; name: string; slug: string }>;
  viewsByTable: Record<string, View[]>;
}) {
  const allViews = createMemo(() => sortedViews(props.tables, props.viewsByTable));
  return (
    <WidgetEditorSection title="Source" subtitle="Choose the data summarized by this widget." icon="ti ti-table-spark">
      <DashboardDataSourceEditor
        baseId={props.baseId}
        source={props.widget.source}
        onChange={(source) => props.onUpdate({ ...props.widget, source })}
        views={allViews().map(({ view, tableName }) => ({ view, tableName, description: viewStatsViewDescription(view) }))}
        defaultGql={tableQuery(props.tables[0]?.id ?? "", "limit 1")}
        queryPlaceholder={"from table Orders\nselect Status, Total\nsort CreatedAt desc\nlimit 1"}
      />
      <TextInput
        label="Title"
        value={() => props.widget.title ?? ""}
        onValueChange={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
        placeholder="Defaults to the saved view or query summary"
      />
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
    <WidgetEditorSection title="Source" subtitle="Choose the saved form shown on this dashboard." icon="ti ti-forms">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextInput
          label="Title"
          value={() => props.widget.title ?? ""}
          onValueChange={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
          placeholder="Defaults to the form name"
        />
        <Select
          label="Form"
          value={() => props.widget.formId}
          onValueChange={(v) => {
            if (v !== null) props.onUpdate({ ...props.widget, formId: v });
          }}
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
  baseId: string;
  viewsByTable: Record<string, View[]>;
  tables: Array<{ id: string; name: string; slug: string }>;
}) {
  const allViews = createMemo(() => sortedViews(props.tables, props.viewsByTable));

  return (
    <WidgetEditorSection title="Source" subtitle="Choose the records shown in this widget." icon="ti ti-table">
      <DashboardDataSourceEditor
        baseId={props.baseId}
        source={props.widget.source}
        onChange={(source) => props.onUpdate({ ...props.widget, source })}
        views={allViews().map(({ view, tableName }) => ({ view, tableName, description: embeddedViewDescription(view) }))}
        defaultGql={tableQuery(props.tables[0]?.id ?? "", "limit 25")}
        queryPlaceholder={"from table Orders\nwhere Status = 'Open'\nsort CreatedAt desc\nlimit 25"}
      />
      <TextInput
        label="Title"
        value={() => props.widget.title ?? ""}
        onValueChange={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
        placeholder="Defaults to the saved view or query results"
      />
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

const CHART_TYPE_HELP: Record<ChartWidget["chartType"], string> = {
  donut: "Shows parts of one total. The source needs one group and one summary value.",
  bar: "Compares categories. The source needs one group and at least one summary value.",
  line: "Shows change across an ordered group, such as days or months.",
  sparkline: "Shows one compact trend without axes.",
  scatter: "Compares two summary values for every group.",
};

function ChartCellBody(props: {
  widget: ChartWidget;
  onUpdate: (w: ChartWidget) => void;
  baseId: string;
  tables: Array<{ id: string; name: string; slug: string }>;
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
  dateConfig?: DateContext;
}) {
  const allViews = createMemo(() => sortedViews(props.tables, props.viewsByTable));
  const chartViews = createMemo(() => allViews().filter(({ view }) => isChartReadyForType(view, props.widget.chartType)));

  return (
    <WidgetEditorSection title="Source" subtitle="Choose grouped data for this chart." icon="ti ti-chart-bar">
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-primary">Chart type</span>
        <div class="flex flex-wrap items-center gap-2">
          {CHART_TYPE_OPTIONS.map((opt) => (
            <Button
              variant={props.widget.chartType === opt.id ? "primary" : "secondary"}
              size="sm"
              aria-pressed={props.widget.chartType === opt.id}
              onClick={() => props.onUpdate(withChartType(props.widget, opt.id))}
            >
              <i class={opt.icon} />
              {opt.label}
            </Button>
          ))}
        </div>
        <p class="text-xs text-dimmed">{CHART_TYPE_HELP[props.widget.chartType]}</p>
      </div>
      <DashboardDataSourceEditor
        baseId={props.baseId}
        source={props.widget.source}
        onChange={(source) => props.onUpdate({ ...props.widget, source })}
        views={chartViews().map(({ view, tableName }) => ({
          view,
          tableName,
          description: chartViewDescription(props.widget.chartType, view, props.fieldsByTable[view.tableId] ?? []),
        }))}
        defaultGql={tableQuery(props.tables[0]?.id ?? "")}
        queryPlaceholder={"from table Orders\ngroup by Status\naggregate count(*) as orders\nsort orders desc"}
      />
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextInput
          label="Title"
          value={() => props.widget.title ?? ""}
          onValueChange={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
          placeholder="e.g. Revenue by quarter"
        />
        <TextInput
          label="Subtitle"
          value={() => props.widget.subtitle ?? ""}
          onValueChange={(v) => props.onUpdate({ ...props.widget, subtitle: v || undefined })}
          placeholder="e.g. last 12 months"
        />
        <TextInput
          label="Limit"
          description="Optional. Uses the source order and keeps the last N rows."
          value={() => (props.widget.limit !== undefined ? String(props.widget.limit) : "")}
          onValueChange={(raw) => {
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
          <TextInput
            label="X-axis label"
            value={() => props.widget.xAxisLabel ?? ""}
            onValueChange={(v) => props.onUpdate({ ...props.widget, xAxisLabel: v || undefined })}
          />
          <TextInput
            label="Y-axis label"
            value={() => props.widget.yAxisLabel ?? ""}
            onValueChange={(v) => props.onUpdate({ ...props.widget, yAxisLabel: v || undefined })}
          />
        </Show>
      </div>
      <Show when={props.widget.chartType !== "donut" && props.widget.chartType !== "sparkline"}>
        <DashboardValueFormatEditor
          label="Y-axis format"
          value={props.widget.valueFormat}
          onChange={(valueFormat) => props.onUpdate({ ...props.widget, valueFormat })}
          dateConfig={props.dateConfig}
        />
      </Show>
    </WidgetEditorSection>
  );
}

function withChartType(widget: ChartWidget, chartType: ChartWidget["chartType"]): ChartWidget {
  if (chartType !== "donut" && chartType !== "sparkline") return { ...widget, chartType };
  const { valueFormat: _valueFormat, xAxisLabel: _xAxisLabel, yAxisLabel: _yAxisLabel, ...rest } = widget;
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
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-primary">Target type</span>
        <div class="flex flex-wrap items-center gap-2">
          {LINK_TARGET_OPTIONS.map((opt) => (
            <Button
              variant={props.widget.target.kind === opt.id ? "primary" : "secondary"}
              size="sm"
              aria-pressed={props.widget.target.kind === opt.id}
              onClick={() => setTargetKind(opt.id)}
            >
              <i class={opt.icon} />
              {opt.label}
            </Button>
          ))}
        </div>
      </div>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextInput
          label="Title"
          value={() => props.widget.title ?? ""}
          onValueChange={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
          placeholder="Defaults to target name"
        />
        <IconInput
          label="Icon"
          value={() => props.widget.icon ?? ""}
          onValueChange={(v) => props.onUpdate({ ...props.widget, icon: v || undefined })}
          placeholder="Search icons..."
        />
        <TextInput
          label="Description"
          value={() => props.widget.description ?? ""}
          onValueChange={(v) => props.onUpdate({ ...props.widget, description: v || undefined })}
        />
        <Show when={props.widget.target.kind === "dashboard"}>
          <Select
            label="Dashboard"
            value={() => (props.widget.target.kind === "dashboard" ? props.widget.target.dashboardId : "")}
            onValueChange={(v) => {
              if (v !== null) props.onUpdate({ ...props.widget, target: { kind: "dashboard", dashboardId: v } });
            }}
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
            onValueChange={(v) => {
              if (v !== null) props.onUpdate({ ...props.widget, target: { kind: "table", tableId: v } });
            }}
            options={[{ id: "", label: "(pick a table)" }, ...props.tables.map((t) => ({ id: t.id, label: t.name }))]}
          />
        </Show>
        <Show when={props.widget.target.kind === "view"}>
          <Select
            label="View"
            value={() => (props.widget.target.kind === "view" ? props.widget.target.viewId : "")}
            onValueChange={(v) => {
              if (v !== null) props.onUpdate({ ...props.widget, target: { kind: "view", viewId: v } });
            }}
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
            onValueChange={(v) => {
              if (v !== null) props.onUpdate({ ...props.widget, target: { kind: "form", formId: v } });
            }}
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
            onValueChange={(v) => props.onUpdate({ ...props.widget, target: { kind: "url", url: v } })}
            placeholder="https://..."
          />
        </Show>
      </div>
    </WidgetEditorSection>
  );
}

function MarkdownCellBody(props: { widget: MarkdownWidget; onUpdate: (w: MarkdownWidget) => void }) {
  return (
    <WidgetEditorSection title="Content" subtitle="Add notes, links, or instructions with Markdown." icon="ti ti-markdown">
      <TextInput
        label="Title"
        value={() => props.widget.title ?? ""}
        onValueChange={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
        placeholder="Optional"
      />
      <MarkdownEditor
        aria-label="Markdown content"
        value={() => props.widget.markdown ?? ""}
        onValueChange={(value) => props.onUpdate({ ...props.widget, markdown: value })}
        lines={12}
        placeholder="Add instructions, links, or context..."
      />
    </WidgetEditorSection>
  );
}

function WorkflowButtonCellBody(props: {
  widget: WorkflowButtonWidget;
  onUpdate: (w: WorkflowButtonWidget) => void;
  dashboardWorkflows: Workflow[];
}) {
  return (
    <WidgetEditorSection title="Action" subtitle="Run one workflow from this dashboard." icon="ti ti-route">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextInput
          label="Title"
          value={() => props.widget.title ?? ""}
          onValueChange={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
          placeholder="Defaults to workflow name"
        />
        <TextInput
          label="Button text"
          value={() => props.widget.buttonLabel ?? ""}
          onValueChange={(v) => props.onUpdate({ ...props.widget, buttonLabel: v || undefined })}
          placeholder="Run"
        />
        <TextInput
          label="Description"
          value={() => props.widget.description ?? ""}
          onValueChange={(v) => props.onUpdate({ ...props.widget, description: v || undefined })}
          placeholder="Optional context shown above the button"
        />
        <Select
          label="Workflow"
          description="Workflows with dashboard or scanner launchers are listed."
          value={() => props.widget.launcherId}
          onValueChange={(v) => {
            if (v === null) return;
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

const isQueryWidget = (widget: Widget): widget is StatWidget | ChartWidget | ViewWidget | ViewStatsWidget =>
  widget.kind === "stat" || widget.kind === "chart" || widget.kind === "view" || widget.kind === "view-stats";

const validateDataSourceDraft = (source: DashboardWidgetSource, viewsByTable: Record<string, View[]>): string | null => {
  if (source.kind === "gql") return source.source.trim() ? null : "Enter a GQL query.";
  if (!source.viewId) return "Pick a saved view.";
  return Object.values(viewsByTable)
    .flat()
    .some((candidate) => candidate.id === source.viewId)
    ? null
    : "Pick an existing saved view.";
};

function validateWidgetDraft(widget: Widget, viewsByTable: Record<string, View[]>): string | null {
  if (widget.kind === "chart") {
    const sourceError = validateDataSourceDraft(widget.source, viewsByTable);
    if (sourceError) return sourceError;
    if (widget.source.kind === "view") {
      const viewId = widget.source.viewId;
      const view = Object.values(viewsByTable)
        .flat()
        .find((candidate) => candidate.id === viewId);
      if (!view || !isChartReadyView(view)) return "Chart views need grouped rows and at least one summary value.";
      if (widget.chartType === "scatter" && aggregateItemsFromSource(view.source).length < 2) {
        return "Scatter needs two summary values.";
      }
    }
  }
  if (widget.kind === "stat") {
    const sourceError = validateDataSourceDraft(widget.source, viewsByTable);
    if (sourceError) return sourceError;
    if (widget.trend) {
      const trendError = validateDataSourceDraft(widget.trend.source, viewsByTable);
      if (trendError) return `Trend: ${trendError}`;
    }
  }
  if (widget.kind === "view" || widget.kind === "view-stats") {
    const sourceError = validateDataSourceDraft(widget.source, viewsByTable);
    if (sourceError) return sourceError;
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
