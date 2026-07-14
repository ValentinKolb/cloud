import { DataTable, Panes, StructuredDataPreview, type DataTableColumn, type PanesValue } from "@valentinkolb/cloud/ui";
import { createEffect, createMemo, createSignal, Show, type Accessor, type JSX, type Setter } from "solid-js";
import type { PulseCurrentState, PulseRecordedEvent, PulseResourceMetric, PulseResourceSummary } from "../../contracts";
import {
  compactDateWithDelta,
  dimensionsSummary,
  formatMetricValue,
  formatSignalValue,
  formatValue,
  signalSubject,
  type PulseDateContext,
} from "./helpers";
import DetailHero from "./DetailHero";

export type ResourceDetailProps = {
  resource: PulseResourceSummary;
  metrics: PulseResourceMetric[];
  states: PulseCurrentState[];
  events: PulseRecordedEvent[];
  dateContext: PulseDateContext;
  sourceNameById: () => Map<string, string>;
  openSource: (sourceId: string | null | undefined) => void;
  openMetricQuery: (metric: PulseResourceMetric) => void;
  openMetricVariants: (metric: string) => void;
  openStateQuery: (state: PulseCurrentState) => void;
  openStateVariants: (key: string) => void;
  openEventQuery: (event: PulseRecordedEvent) => void;
  openEventVariants: (kind: string) => void;
};

const SourceLink = (props: {
  sourceId: string | null | undefined;
  sourceNameById: () => Map<string, string>;
  openSource: (sourceId: string | null | undefined) => void;
}) => {
  if (!props.sourceId) return <span class="text-xs text-dimmed">-</span>;
  return (
    <button
      type="button"
      class="inline-flex max-w-full items-center gap-1 truncate text-xs font-medium text-secondary transition hover:app-accent-text"
      onClick={(event) => {
        event.stopPropagation();
        props.openSource(props.sourceId);
      }}
      title="Open source"
    >
      <i class="ti ti-database-share shrink-0" />
      <span class="truncate">{props.sourceNameById().get(props.sourceId) ?? "Unknown source"}</span>
    </button>
  );
};

type ResourceSignalTab = "metrics" | "states" | "events";

const metricColumns: DataTableColumn<PulseResourceMetric>[] = [
  { id: "metric", header: "Metric", value: "metric", cellClass: "min-w-72" },
  { id: "current", header: "Current", cellClass: "w-28 whitespace-nowrap" },
  { id: "type", header: "Type", value: "type", cellClass: "w-24 whitespace-nowrap" },
  { id: "unit", header: "Unit", cellClass: "w-24 whitespace-nowrap" },
  { id: "source", header: "Source", cellClass: "w-40 whitespace-nowrap" },
  { id: "dimensions", header: "Dimensions", cellClass: "min-w-64" },
  { id: "lastSeen", header: "Last seen", cellClass: "w-44 whitespace-nowrap" },
];

const stateColumns: DataTableColumn<PulseCurrentState>[] = [
  { id: "key", header: "State", value: "key", cellClass: "min-w-72" },
  { id: "value", header: "Value", cellClass: "min-w-40" },
  { id: "source", header: "Source", cellClass: "w-40 whitespace-nowrap" },
  { id: "dimensions", header: "Dimensions", cellClass: "min-w-64" },
  { id: "updated", header: "Updated", cellClass: "w-44 whitespace-nowrap" },
];

const eventColumns: DataTableColumn<PulseRecordedEvent>[] = [
  { id: "kind", header: "Event", value: "kind", cellClass: "min-w-72" },
  { id: "subject", header: "Subject", cellClass: "min-w-56" },
  { id: "source", header: "Source", cellClass: "w-40 whitespace-nowrap" },
  { id: "value", header: "Value", cellClass: "w-24 whitespace-nowrap" },
  { id: "time", header: "Time", cellClass: "w-44 whitespace-nowrap" },
];

const createResourceTabsValue = (): PanesValue => ({
  root: {
    type: "leaf",
    id: "signals",
    elementIds: ["metrics", "states", "events"],
    activeElementId: "metrics",
    presentation: "tabs",
  },
});

const findLeafActiveElement = (node: PanesValue["root"], leafId: string): string | undefined => {
  if (node.type === "leaf") return node.id === leafId ? (node.activeElementId ?? node.elementIds[0]) : undefined;
  for (const child of node.children) {
    const activeElement = findLeafActiveElement(child, leafId);
    if (activeElement) return activeElement;
  }
  return undefined;
};

const resourceStateId = (state: PulseCurrentState) =>
  `${state.key}:${state.sourceId ?? ""}:${state.entityId}:${JSON.stringify(state.dimensions)}`;

const metricValue = (metric: PulseResourceMetric) =>
  metric.latestValue === null ? "-" : formatMetricValue(metric.latestValue, metric.unit);

const renderDimensions = (dimensions: Record<string, string>): JSX.Element => {
  const summary = dimensionsSummary(dimensions, 8);
  return (
    <span
      class="line-clamp-2 text-xs text-secondary"
      title={Object.entries(dimensions)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ")}
    >
      {summary || "-"}
    </span>
  );
};

const metricLastSeen = (metric: PulseResourceMetric, dateContext: PulseDateContext): string => {
  if (metric.latestSampleAt) return compactDateWithDelta(metric.latestSampleAt, dateContext);
  return metric.lastSeenAt ? compactDateWithDelta(metric.lastSeenAt, dateContext) : "-";
};

const clearMissingSelection = <Row,>(rows: Row[], selectedId: string, rowId: (row: Row) => string, setSelectedId: (id: string) => void) => {
  if (selectedId && !rows.some((row) => rowId(row) === selectedId)) setSelectedId("");
};

const renderMetricCell = (
  row: PulseResourceMetric,
  col: DataTableColumn<PulseResourceMetric>,
  render: (value: unknown) => JSX.Element,
  props: Pick<ResourceDetailProps, "dateContext" | "sourceNameById" | "openSource">,
): JSX.Element => {
  if (col.id === "current") return <span class="text-xs font-medium text-primary">{metricValue(row)}</span>;
  if (col.id === "unit") return <span class="text-xs text-secondary">{row.unit ?? "-"}</span>;
  if (col.id === "source")
    return <SourceLink sourceId={row.sourceId} sourceNameById={props.sourceNameById} openSource={props.openSource} />;
  if (col.id === "dimensions") return renderDimensions(row.dimensions);
  if (col.id === "lastSeen") return <span class="text-xs text-secondary">{metricLastSeen(row, props.dateContext)}</span>;
  return render(row[col.id as keyof PulseResourceMetric]);
};

const renderStateCell = (
  row: PulseCurrentState,
  col: DataTableColumn<PulseCurrentState>,
  render: (value: unknown) => JSX.Element,
  props: Pick<ResourceDetailProps, "dateContext" | "sourceNameById" | "openSource">,
): JSX.Element => {
  if (col.id === "value") return <span class="line-clamp-2 text-xs text-secondary">{formatSignalValue(row.value)}</span>;
  if (col.id === "source")
    return <SourceLink sourceId={row.sourceId} sourceNameById={props.sourceNameById} openSource={props.openSource} />;
  if (col.id === "dimensions") return renderDimensions(row.dimensions);
  if (col.id === "updated") return <span class="text-xs text-secondary">{compactDateWithDelta(row.updatedAt, props.dateContext)}</span>;
  return render(row[col.id as keyof PulseCurrentState]);
};

const renderEventCell = (
  row: PulseRecordedEvent,
  col: DataTableColumn<PulseRecordedEvent>,
  render: (value: unknown) => JSX.Element,
  props: Pick<ResourceDetailProps, "dateContext" | "sourceNameById" | "openSource">,
): JSX.Element => {
  if (col.id === "subject") return <span class="truncate text-xs text-secondary">{signalSubject(row)}</span>;
  if (col.id === "source")
    return <SourceLink sourceId={row.sourceId} sourceNameById={props.sourceNameById} openSource={props.openSource} />;
  if (col.id === "value") return <span class="text-xs text-secondary">{row.value === null ? "-" : formatValue(row.value)}</span>;
  if (col.id === "time") return <span class="text-xs text-secondary">{compactDateWithDelta(row.ts, props.dateContext)}</span>;
  return render(row[col.id as keyof PulseRecordedEvent]);
};

const ResourceHeader = (props: Pick<ResourceDetailProps, "resource" | "dateContext">) => (
  <header class="flex shrink-0 items-center gap-3">
    <span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 app-accent-text dark:bg-zinc-900">
      <i class="ti ti-cube text-base" />
    </span>
    <div class="min-w-0">
      <p class="text-label text-[11px]">{props.resource.type ?? "Resource"}</p>
      <h1 class="mt-0.5 truncate text-lg font-semibold leading-6 text-primary">{props.resource.label || props.resource.id}</h1>
      <p class="mt-0.5 truncate text-xs text-dimmed">
        {props.resource.id}
        {props.resource.lastSeenAt ? ` · ${compactDateWithDelta(props.resource.lastSeenAt, props.dateContext)}` : ""}
      </p>
    </div>
  </header>
);

const ResourceDimensions = (props: Pick<ResourceDetailProps, "resource">) => (
  <section class="detail-section shrink-0">
    <StructuredDataPreview title="Dimensions" data={props.resource.dimensions} empty="No dimensions." />
  </section>
);

export type ResourceDetailSelection = {
  activeTab: Accessor<ResourceSignalTab>;
  panesValue: Accessor<PanesValue>;
  updatePanesValue: (value: PanesValue) => void;
  selectedMetric: Accessor<PulseResourceMetric | null>;
  selectedState: Accessor<PulseCurrentState | null>;
  selectedEvent: Accessor<PulseRecordedEvent | null>;
  selectMetric: (metric: PulseResourceMetric) => void;
  selectState: (state: PulseCurrentState) => void;
  selectEvent: (event: PulseRecordedEvent) => void;
  close: () => void;
  open: Accessor<boolean>;
};

export const createResourceDetailSelection = (props: {
  metrics: Accessor<PulseResourceMetric[]>;
  states: Accessor<PulseCurrentState[]>;
  events: Accessor<PulseRecordedEvent[]>;
}): ResourceDetailSelection => {
  const [activeTab, setActiveTab] = createSignal<ResourceSignalTab>("metrics");
  const [panesValue, setPanesValue] = createSignal<PanesValue>(createResourceTabsValue());
  const [selectedMetricId, setSelectedMetricId] = createSignal("");
  const [selectedStateId, setSelectedStateId] = createSignal("");
  const [selectedEventId, setSelectedEventId] = createSignal("");

  createEffect(() => {
    clearMissingSelection(props.metrics(), selectedMetricId(), (metric) => metric.seriesId, setSelectedMetricId);
    clearMissingSelection(props.states(), selectedStateId(), resourceStateId, setSelectedStateId);
    clearMissingSelection(props.events(), selectedEventId(), (event) => event.id, setSelectedEventId);
  });

  const selectedMetric = createMemo(() => props.metrics().find((metric) => metric.seriesId === selectedMetricId()) ?? null);
  const selectedState = createMemo(() => props.states().find((state) => resourceStateId(state) === selectedStateId()) ?? null);
  const selectedEvent = createMemo(() => props.events().find((event) => event.id === selectedEventId()) ?? null);

  const updatePanesValue = (value: PanesValue) => {
    setPanesValue(value);
    const activeElement = findLeafActiveElement(value.root, "signals");
    if (activeElement === "metrics" || activeElement === "states" || activeElement === "events") setActiveTab(activeElement);
  };
  const close = () => {
    if (activeTab() === "metrics") setSelectedMetricId("");
    if (activeTab() === "states") setSelectedStateId("");
    if (activeTab() === "events") setSelectedEventId("");
  };

  return {
    activeTab,
    panesValue,
    updatePanesValue,
    selectedMetric,
    selectedState,
    selectedEvent,
    selectMetric: (metric) => {
      setActiveTab("metrics");
      setSelectedMetricId(metric.seriesId);
    },
    selectState: (state) => {
      setActiveTab("states");
      setSelectedStateId(resourceStateId(state));
    },
    selectEvent: (event) => {
      setActiveTab("events");
      setSelectedEventId(event.id);
    },
    close,
    open: createMemo(() => {
      if (activeTab() === "metrics") return selectedMetric() !== null;
      if (activeTab() === "states") return selectedState() !== null;
      return selectedEvent() !== null;
    }),
  };
};

type ResourceSignalPanesProps = ResourceDetailProps & {
  selection: ResourceDetailSelection;
};

const ResourceSignalPanes = (props: ResourceSignalPanesProps) => (
  <section class="h-[min(68vh,54rem)] min-h-[32rem] shrink-0 overflow-hidden">
    <Panes.Root
      value={props.selection.panesValue()}
      onChange={props.selection.updatePanesValue}
      class="h-full min-h-0"
      allowMove={false}
      allowReorder={false}
      allowHorizontalSplit={false}
      allowVerticalSplit={false}
    >
      <Panes.Element id="metrics" title={`Metrics ${props.metrics.length}`} icon="ti-chart-dots">
        <div class="flex h-full min-h-0 flex-col overflow-hidden">
          <DataTable
            rows={props.metrics}
            columns={metricColumns}
            getRowId={(metric) => metric.seriesId}
            selectedRowId={props.selection.selectedMetric()?.seriesId ?? null}
            density="compact"
            fillHeight
            class="min-h-0 flex-1 overflow-auto"
            empty="No metrics for this resource."
            scrollPreserveKey={`pulse-resource-${props.resource.key}-metrics`}
            onRowClick={props.selection.selectMetric}
            renderCell={({ row, col, render }) => renderMetricCell(row, col, render, props)}
          />
        </div>
      </Panes.Element>

      <Panes.Element id="states" title={`States ${props.states.length}`} icon="ti-toggle-right">
        <div class="flex h-full min-h-0 flex-col overflow-hidden">
          <DataTable
            rows={props.states}
            columns={stateColumns}
            getRowId={resourceStateId}
            selectedRowId={props.selection.selectedState() ? resourceStateId(props.selection.selectedState()!) : null}
            density="compact"
            fillHeight
            class="min-h-0 flex-1 overflow-auto"
            empty="No states for this resource."
            scrollPreserveKey={`pulse-resource-${props.resource.key}-states`}
            onRowClick={props.selection.selectState}
            renderCell={({ row, col, render }) => renderStateCell(row, col, render, props)}
          />
        </div>
      </Panes.Element>

      <Panes.Element id="events" title={`Events ${props.events.length}`} icon="ti-bolt">
        <div class="flex h-full min-h-0 flex-col overflow-hidden">
          <DataTable
            rows={props.events}
            columns={eventColumns}
            getRowId={(event) => event.id}
            selectedRowId={props.selection.selectedEvent()?.id ?? null}
            density="compact"
            fillHeight
            class="min-h-0 flex-1 overflow-auto"
            empty="No recent events for this resource."
            scrollPreserveKey={`pulse-resource-${props.resource.key}-events`}
            onRowClick={props.selection.selectEvent}
            renderCell={({ row, col, render }) => renderEventCell(row, col, render, props)}
          />
        </div>
      </Panes.Element>
    </Panes.Root>
  </section>
);

export const ResourceSignalDetail = (props: ResourceSignalPanesProps) => (
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <Show when={props.selection.selectedMetric()}>
      {(metric) => (
        <div class={props.selection.activeTab() === "metrics" ? "flex h-full min-h-0 flex-col overflow-hidden" : "hidden"}>
          <DetailHero
            eyebrow="Metric value"
            title={metric().metric}
            icon="ti ti-chart-dots"
            description={`${metric().type}${metric().unit ? ` · ${metric().unit}` : ""}${
              metric().latestSampleAt ? ` · ${compactDateWithDelta(metric().latestSampleAt!, props.dateContext)}` : ""
            }`}
            actions={
              <button type="button" class="icon-btn" aria-label="Close metric details" onClick={props.selection.close}>
                <i class="ti ti-x" />
              </button>
            }
            quickActions={
              <>
                <button type="button" class="btn-secondary btn-sm" onClick={() => props.openMetricQuery(metric())}>
                  <i class="ti ti-code" /> Open query
                </button>
                <button type="button" class="btn-secondary btn-sm" onClick={() => props.openMetricVariants(metric().metric)}>
                  <i class="ti ti-stack-2" /> All variants
                </button>
              </>
            }
          />
          <div class="detail-stack">
            <section class="detail-section">
              <SourceLink sourceId={metric().sourceId} sourceNameById={props.sourceNameById} openSource={props.openSource} />
              <p class="mt-3 text-3xl font-semibold text-primary">{metricValue(metric())}</p>
            </section>
            <section class="detail-section">
              <StructuredDataPreview title="Metric dimensions" data={metric().dimensions} empty="No dimensions." />
            </section>
          </div>
        </div>
      )}
    </Show>

    <Show when={props.selection.selectedState()}>
      {(state) => (
        <div class={props.selection.activeTab() === "states" ? "flex h-full min-h-0 flex-col overflow-hidden" : "hidden"}>
          <DetailHero
            eyebrow="State value"
            title={state().key}
            icon="ti ti-toggle-right"
            description={compactDateWithDelta(state().updatedAt, props.dateContext)}
            actions={
              <button type="button" class="icon-btn" aria-label="Close state details" onClick={props.selection.close}>
                <i class="ti ti-x" />
              </button>
            }
            quickActions={
              <>
                <button type="button" class="btn-secondary btn-sm" onClick={() => props.openStateQuery(state())}>
                  <i class="ti ti-code" /> Open query
                </button>
                <button type="button" class="btn-secondary btn-sm" onClick={() => props.openStateVariants(state().key)}>
                  <i class="ti ti-stack-2" /> All variants
                </button>
              </>
            }
          />
          <div class="detail-stack">
            <section class="detail-section">
              <SourceLink sourceId={state().sourceId} sourceNameById={props.sourceNameById} openSource={props.openSource} />
              <p class="mt-3 break-words text-2xl font-semibold text-primary">{formatSignalValue(state().value)}</p>
            </section>
            <section class="detail-section">
              <StructuredDataPreview title="State dimensions" data={state().dimensions} empty="No dimensions." />
            </section>
          </div>
        </div>
      )}
    </Show>

    <Show when={props.selection.selectedEvent()}>
      {(event) => (
        <div class={props.selection.activeTab() === "events" ? "flex h-full min-h-0 flex-col overflow-hidden" : "hidden"}>
          <DetailHero
            eyebrow="Event row"
            title={event().kind}
            icon="ti ti-bolt"
            description={`${signalSubject(event())} · ${compactDateWithDelta(event().ts, props.dateContext)}`}
            actions={
              <button type="button" class="icon-btn" aria-label="Close event details" onClick={props.selection.close}>
                <i class="ti ti-x" />
              </button>
            }
            quickActions={
              <>
                <button type="button" class="btn-secondary btn-sm" onClick={() => props.openEventQuery(event())}>
                  <i class="ti ti-code" /> Open query
                </button>
                <button type="button" class="btn-secondary btn-sm" onClick={() => props.openEventVariants(event().kind)}>
                  <i class="ti ti-stack-2" /> All variants
                </button>
              </>
            }
          />
          <div class="detail-stack">
            <section class="detail-section">
              <SourceLink sourceId={event().sourceId} sourceNameById={props.sourceNameById} openSource={props.openSource} />
              <p class="mt-3 text-2xl font-semibold text-primary">{event().value === null ? "-" : formatValue(event().value)}</p>
            </section>
            <section class="detail-section">
              <StructuredDataPreview title="Event dimensions" data={event().dimensions} empty="No dimensions." />
            </section>
            <section class="detail-section">
              <StructuredDataPreview title="Event payload" data={event().payload} empty="No payload." />
            </section>
          </div>
        </div>
      )}
    </Show>
  </div>
);

export default function ResourceDetailView(props: ResourceDetailProps & { selection: ResourceDetailSelection }) {
  return (
    <section class="flex min-h-0 flex-1 flex-col gap-2">
      <ResourceHeader resource={props.resource} dateContext={props.dateContext} />
      <ResourceDimensions resource={props.resource} />
      <ResourceSignalPanes {...props} />
    </section>
  );
}
