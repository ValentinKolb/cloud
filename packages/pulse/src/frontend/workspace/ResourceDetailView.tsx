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

type Props = {
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

const createResourcePanesValue = (): PanesValue => ({
  root: {
    type: "split",
    id: "resource-detail-root",
    direction: "horizontal",
    sizes: [62, 38],
    children: [
      {
        type: "leaf",
        id: "signals",
        elementIds: ["metrics", "states", "events"],
        activeElementId: "metrics",
        presentation: "tabs",
      },
      {
        type: "leaf",
        id: "detail",
        elementIds: ["detail"],
        activeElementId: "detail",
        presentation: "single",
      },
    ],
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

const syncSelectedId = <Row,>(rows: Row[], selectedId: string, fallbackId: (row: Row) => string, setSelectedId: (id: string) => void) => {
  if (!rows.some((row) => fallbackId(row) === selectedId)) setSelectedId(rows[0] ? fallbackId(rows[0]) : "");
};

const renderMetricCell = (
  row: PulseResourceMetric,
  col: DataTableColumn<PulseResourceMetric>,
  render: (value: unknown) => JSX.Element,
  props: Pick<Props, "dateContext" | "sourceNameById" | "openSource">,
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
  props: Pick<Props, "dateContext" | "sourceNameById" | "openSource">,
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
  props: Pick<Props, "dateContext" | "sourceNameById" | "openSource">,
): JSX.Element => {
  if (col.id === "subject") return <span class="truncate text-xs text-secondary">{signalSubject(row)}</span>;
  if (col.id === "source")
    return <SourceLink sourceId={row.sourceId} sourceNameById={props.sourceNameById} openSource={props.openSource} />;
  if (col.id === "value") return <span class="text-xs text-secondary">{row.value === null ? "-" : formatValue(row.value)}</span>;
  if (col.id === "time") return <span class="text-xs text-secondary">{compactDateWithDelta(row.ts, props.dateContext)}</span>;
  return render(row[col.id as keyof PulseRecordedEvent]);
};

const ResourceHeader = (props: Pick<Props, "resource" | "dateContext">) => (
  <DetailHero
    eyebrow={props.resource.type ?? "Resource"}
    title={props.resource.label || props.resource.id}
    icon="ti ti-cube"
    description={
      <>
        {props.resource.id}
        {props.resource.lastSeenAt ? ` · ${compactDateWithDelta(props.resource.lastSeenAt, props.dateContext)}` : ""}
      </>
    }
  />
);

const ResourceDimensions = (props: Pick<Props, "resource">) => (
  <section class="detail-section shrink-0">
    <StructuredDataPreview title="Dimensions" data={props.resource.dimensions} empty="No dimensions." />
  </section>
);

type ResourceSignalPanesProps = Props & {
  activeTab: Accessor<ResourceSignalTab>;
  panesValue: Accessor<PanesValue>;
  updatePanesValue: (value: PanesValue) => void;
  selectedMetric: Accessor<PulseResourceMetric | null>;
  selectedState: Accessor<PulseCurrentState | null>;
  selectedEvent: Accessor<PulseRecordedEvent | null>;
  setSelectedMetricId: Setter<string>;
  setSelectedStateId: Setter<string>;
  setSelectedEventId: Setter<string>;
};

const ResourceSignalPanes = (props: ResourceSignalPanesProps) => (
  <section class="h-[min(68vh,54rem)] min-h-[32rem] shrink-0 overflow-hidden">
    <Panes.Root
      value={props.panesValue()}
      onChange={props.updatePanesValue}
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
            selectedRowId={props.selectedMetric()?.seriesId ?? null}
            density="compact"
            fillHeight
            class="min-h-0 flex-1 overflow-auto"
            empty="No metrics for this resource."
            scrollPreserveKey={`pulse-resource-${props.resource.key}-metrics`}
            onRowClick={(metric) => props.setSelectedMetricId(metric.seriesId)}
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
            selectedRowId={props.selectedState() ? resourceStateId(props.selectedState()!) : null}
            density="compact"
            fillHeight
            class="min-h-0 flex-1 overflow-auto"
            empty="No states for this resource."
            scrollPreserveKey={`pulse-resource-${props.resource.key}-states`}
            onRowClick={(state) => props.setSelectedStateId(resourceStateId(state))}
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
            selectedRowId={props.selectedEvent()?.id ?? null}
            density="compact"
            fillHeight
            class="min-h-0 flex-1 overflow-auto"
            empty="No recent events for this resource."
            scrollPreserveKey={`pulse-resource-${props.resource.key}-events`}
            onRowClick={(event) => props.setSelectedEventId(event.id)}
            renderCell={({ row, col, render }) => renderEventCell(row, col, render, props)}
          />
        </div>
      </Panes.Element>

      <Panes.Element id="detail" title="Detail" icon="ti-info-circle">
        <ResourceSignalDetail {...props} />
      </Panes.Element>
    </Panes.Root>
  </section>
);

const ResourceSignalDetail = (props: ResourceSignalPanesProps) => (
  <aside class="detail-stack h-full min-h-0 overflow-auto">
    <Show when={props.selectedMetric()}>
      {(metric) => (
        <div class={props.activeTab() === "metrics" ? "grid gap-2" : "hidden"}>
          <DetailHero
            eyebrow="Metric value"
            title={metric().metric}
            icon="ti ti-chart-dots"
            description={`${metric().type}${metric().unit ? ` · ${metric().unit}` : ""}${
              metric().latestSampleAt ? ` · ${compactDateWithDelta(metric().latestSampleAt!, props.dateContext)}` : ""
            }`}
          />
          <section class="detail-section">
            <SourceLink sourceId={metric().sourceId} sourceNameById={props.sourceNameById} openSource={props.openSource} />
            <p class="mt-3 text-3xl font-semibold text-primary">{metricValue(metric())}</p>
            <div class="mt-4 flex flex-wrap gap-2">
              <button type="button" class="btn-input btn-input-sm" onClick={() => props.openMetricQuery(metric())}>
                <i class="ti ti-code" /> Open query
              </button>
              <button type="button" class="btn-input btn-input-sm" onClick={() => props.openMetricVariants(metric().metric)}>
                <i class="ti ti-stack-2" /> All variants
              </button>
            </div>
          </section>
        </div>
      )}
    </Show>

    <Show when={props.selectedState()}>
      {(state) => (
        <div class={props.activeTab() === "states" ? "grid gap-2" : "hidden"}>
          <DetailHero
            eyebrow="State value"
            title={state().key}
            icon="ti ti-toggle-right"
            description={compactDateWithDelta(state().updatedAt, props.dateContext)}
          />
          <section class="detail-section">
            <SourceLink sourceId={state().sourceId} sourceNameById={props.sourceNameById} openSource={props.openSource} />
            <p class="mt-3 break-words text-2xl font-semibold text-primary">{formatSignalValue(state().value)}</p>
            <div class="mt-4 flex flex-wrap gap-2">
              <button type="button" class="btn-input btn-input-sm" onClick={() => props.openStateQuery(state())}>
                <i class="ti ti-code" /> Open query
              </button>
              <button type="button" class="btn-input btn-input-sm" onClick={() => props.openStateVariants(state().key)}>
                <i class="ti ti-stack-2" /> All variants
              </button>
            </div>
          </section>
        </div>
      )}
    </Show>

    <Show when={props.selectedEvent()}>
      {(event) => (
        <div class={props.activeTab() === "events" ? "grid gap-2" : "hidden"}>
          <DetailHero
            eyebrow="Event row"
            title={event().kind}
            icon="ti ti-bolt"
            description={`${signalSubject(event())} · ${compactDateWithDelta(event().ts, props.dateContext)}`}
          />
          <section class="detail-section">
            <SourceLink sourceId={event().sourceId} sourceNameById={props.sourceNameById} openSource={props.openSource} />
            <p class="mt-3 text-2xl font-semibold text-primary">{event().value === null ? "-" : formatValue(event().value)}</p>
            <div class="mt-4 flex flex-wrap gap-2">
              <button type="button" class="btn-input btn-input-sm" onClick={() => props.openEventQuery(event())}>
                <i class="ti ti-code" /> Open query
              </button>
              <button type="button" class="btn-input btn-input-sm" onClick={() => props.openEventVariants(event().kind)}>
                <i class="ti ti-stack-2" /> All variants
              </button>
            </div>
          </section>
        </div>
      )}
    </Show>

    <Show when={props.selectedMetric()}>
      {(metric) => (
        <section class={props.activeTab() === "metrics" ? "detail-section" : "hidden"}>
          <StructuredDataPreview title="Metric dimensions" data={metric().dimensions} empty="No dimensions." />
        </section>
      )}
    </Show>
    <Show when={props.selectedState()}>
      {(state) => (
        <section class={props.activeTab() === "states" ? "detail-section" : "hidden"}>
          <StructuredDataPreview title="State dimensions" data={state().dimensions} empty="No dimensions." />
        </section>
      )}
    </Show>
    <Show when={props.selectedEvent()}>
      {(event) => (
        <section class={props.activeTab() === "events" ? "detail-section" : "hidden"}>
          <StructuredDataPreview title="Event dimensions" data={event().dimensions} empty="No dimensions." />
        </section>
      )}
    </Show>
    <Show when={props.selectedEvent()}>
      {(event) => (
        <section class={props.activeTab() === "events" ? "detail-section" : "hidden"}>
          <StructuredDataPreview title="Event payload" data={event().payload} empty="No payload." />
        </section>
      )}
    </Show>
  </aside>
);

export default function ResourceDetailView(props: Props) {
  const [activeTab, setActiveTab] = createSignal<ResourceSignalTab>("metrics");
  const [panesValue, setPanesValue] = createSignal<PanesValue>(createResourcePanesValue());
  const [selectedMetricId, setSelectedMetricId] = createSignal(props.metrics[0]?.seriesId ?? "");
  const [selectedStateId, setSelectedStateId] = createSignal(props.states[0] ? resourceStateId(props.states[0]) : "");
  const [selectedEventId, setSelectedEventId] = createSignal(props.events[0]?.id ?? "");

  createEffect(() => {
    syncSelectedId(props.metrics, selectedMetricId(), (metric) => metric.seriesId, setSelectedMetricId);
    syncSelectedId(props.states, selectedStateId(), resourceStateId, setSelectedStateId);
    syncSelectedId(props.events, selectedEventId(), (event) => event.id, setSelectedEventId);
  });

  const selectedMetric = createMemo(
    () => props.metrics.find((metric) => metric.seriesId === selectedMetricId()) ?? props.metrics[0] ?? null,
  );
  const selectedState = createMemo(
    () => props.states.find((state) => resourceStateId(state) === selectedStateId()) ?? props.states[0] ?? null,
  );
  const selectedEvent = createMemo(() => props.events.find((event) => event.id === selectedEventId()) ?? props.events[0] ?? null);

  const updatePanesValue = (value: PanesValue) => {
    setPanesValue(value);
    const activeElement = findLeafActiveElement(value.root, "signals");
    if (activeElement === "metrics" || activeElement === "states" || activeElement === "events") setActiveTab(activeElement);
  };

  return (
    <section class="flex min-h-0 flex-1 flex-col gap-3 pb-2">
      <ResourceHeader resource={props.resource} dateContext={props.dateContext} />
      <ResourceDimensions resource={props.resource} />
      <ResourceSignalPanes
        {...props}
        activeTab={activeTab}
        panesValue={panesValue}
        updatePanesValue={updatePanesValue}
        selectedMetric={selectedMetric}
        selectedState={selectedState}
        selectedEvent={selectedEvent}
        setSelectedMetricId={setSelectedMetricId}
        setSelectedStateId={setSelectedStateId}
        setSelectedEventId={setSelectedEventId}
      />
    </section>
  );
}
