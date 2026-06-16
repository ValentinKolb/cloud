import { DataTable, StatCell, StatGrid, StructuredDataPreview, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { createEffect, createMemo, createSignal, Show, type JSX } from "solid-js";
import type {
  PulseCurrentState,
  PulseRecordedEvent,
  PulseResourceMetric,
  PulseResourceSummary,
} from "../../contracts";
import { compactDateWithDelta, dimensionsSummary, formatSignalValue, formatValue, plural, signalSubject, type PulseDateContext } from "./helpers";

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

const SourceLink = (props: { sourceId: string | null | undefined; sourceNameById: () => Map<string, string>; openSource: (sourceId: string | null | undefined) => void }) => {
  if (!props.sourceId) return <span class="text-xs text-dimmed">-</span>;
  return (
    <button
      type="button"
      class="inline-flex max-w-full items-center gap-1 truncate text-xs font-medium text-secondary transition hover:text-blue-600 dark:hover:text-blue-300"
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

export default function ResourceDetailView(props: Props) {
  type ResourceSignalTab = "metrics" | "states" | "events";
  const stateId = (state: PulseCurrentState) => `${state.key}:${state.sourceId ?? ""}:${state.entityId}:${JSON.stringify(state.dimensions)}`;
  const [activeTab, setActiveTab] = createSignal<ResourceSignalTab>("metrics");
  const [selectedMetricId, setSelectedMetricId] = createSignal(props.metrics[0]?.seriesId ?? "");
  const [selectedStateId, setSelectedStateId] = createSignal(props.states[0] ? stateId(props.states[0]) : "");
  const [selectedEventId, setSelectedEventId] = createSignal(props.events[0]?.id ?? "");

  createEffect(() => {
    if (!props.metrics.some((metric) => metric.seriesId === selectedMetricId())) setSelectedMetricId(props.metrics[0]?.seriesId ?? "");
    if (!props.states.some((state) => stateId(state) === selectedStateId())) setSelectedStateId(props.states[0] ? stateId(props.states[0]) : "");
    if (!props.events.some((event) => event.id === selectedEventId())) setSelectedEventId(props.events[0]?.id ?? "");
  });

  const selectedMetric = createMemo(() => props.metrics.find((metric) => metric.seriesId === selectedMetricId()) ?? props.metrics[0] ?? null);
  const selectedState = createMemo(() => props.states.find((state) => stateId(state) === selectedStateId()) ?? props.states[0] ?? null);
  const selectedEvent = createMemo(() => props.events.find((event) => event.id === selectedEventId()) ?? props.events[0] ?? null);

  const metricValue = (metric: PulseResourceMetric) =>
    metric.latestValue === null ? "-" : `${formatValue(metric.latestValue)}${metric.unit ? ` ${metric.unit}` : ""}`;
  const tabCount = (tab: ResourceSignalTab) =>
    tab === "metrics" ? props.metrics.length : tab === "states" ? props.states.length : props.events.length;
  const tabButtonClass = (tab: ResourceSignalTab) =>
    `inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition ${
      activeTab() === tab
        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/70 dark:text-blue-200"
        : "bg-zinc-100/70 text-secondary hover:bg-zinc-100 hover:text-primary dark:bg-zinc-900/60 dark:hover:bg-zinc-900"
    }`;

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
  const renderDimensions = (dimensions: Record<string, string>): JSX.Element => {
    const summary = dimensionsSummary(dimensions, 8);
    return (
      <span class="line-clamp-2 text-xs text-secondary" title={Object.entries(dimensions).map(([key, value]) => `${key}=${value}`).join(", ")}>
        {summary || "-"}
      </span>
    );
  };

  return (
    <section class="flex min-h-0 flex-1 flex-col gap-3">
      <section class="paper shrink-0 p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-label text-xs">{props.resource.type ?? "Resource"}</p>
            <h2 class="mt-1 truncate text-xl font-semibold text-primary">{props.resource.label || props.resource.id}</h2>
            <p class="mt-1 truncate text-sm text-dimmed">
              {props.resource.id}
              {props.resource.lastSeenAt ? ` · ${compactDateWithDelta(props.resource.lastSeenAt, props.dateContext)}` : ""}
            </p>
          </div>
        </div>
      </section>

      <StatGrid columns={4}>
        <StatCell label="Signals" value={(props.resource.metricCount + props.resource.stateCount + props.resource.eventCount).toLocaleString()} sub="linked to this resource" />
        <StatCell label="Metrics" value={props.resource.metricCount.toLocaleString()} sub={plural(props.resource.metricSeriesCount, "variant")} accent={{ tone: "blue", icon: "ti ti-chart-dots" }} />
        <StatCell label="States" value={props.resource.stateCount.toLocaleString()} sub="current values" />
        <StatCell label="Events" value={props.resource.eventCount.toLocaleString()} sub="recent rows" />
      </StatGrid>

      <section class="paper shrink-0 p-4">
        <StructuredDataPreview title="Dimensions" data={props.resource.dimensions} empty="No dimensions." />
      </section>

      <section class="grid min-h-[36rem] flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,30rem)]">
        <div class="flex min-h-0 flex-col gap-2">
          <div class="flex shrink-0 flex-wrap items-center gap-2">
            <button type="button" class={tabButtonClass("metrics")} onClick={() => setActiveTab("metrics")}>
              <i class="ti ti-chart-dots" /> Metrics <span class="text-dimmed">{tabCount("metrics")}</span>
            </button>
            <button type="button" class={tabButtonClass("states")} onClick={() => setActiveTab("states")}>
              <i class="ti ti-toggle-right" /> States <span class="text-dimmed">{tabCount("states")}</span>
            </button>
            <button type="button" class={tabButtonClass("events")} onClick={() => setActiveTab("events")}>
              <i class="ti ti-bolt" /> Events <span class="text-dimmed">{tabCount("events")}</span>
            </button>
          </div>

          <Show when={activeTab() === "metrics"}>
            <div class="paper min-h-0 flex-1 overflow-hidden">
              <DataTable
                rows={props.metrics}
                columns={metricColumns}
                getRowId={(metric) => metric.seriesId}
                selectedRowId={selectedMetric()?.seriesId ?? null}
                density="compact"
                fillHeight
                empty="No metrics for this resource."
                scrollPreserveKey={`pulse-resource-${props.resource.key}-metrics`}
                onRowClick={(metric) => setSelectedMetricId(metric.seriesId)}
                renderCell={({ row, col, render }) => {
                  if (col.id === "current") return <span class="text-xs font-medium text-primary">{metricValue(row)}</span>;
                  if (col.id === "unit") return <span class="text-xs text-secondary">{row.unit ?? "-"}</span>;
                  if (col.id === "source") return <SourceLink sourceId={row.sourceId} sourceNameById={props.sourceNameById} openSource={props.openSource} />;
                  if (col.id === "dimensions") return renderDimensions(row.dimensions);
                  if (col.id === "lastSeen")
                    return (
                      <span class="text-xs text-secondary">
                        {row.latestSampleAt
                          ? compactDateWithDelta(row.latestSampleAt, props.dateContext)
                          : row.lastSeenAt
                            ? compactDateWithDelta(row.lastSeenAt, props.dateContext)
                            : "-"}
                      </span>
                    );
                  return render(row[col.id as keyof PulseResourceMetric]);
                }}
              />
            </div>
          </Show>

          <Show when={activeTab() === "states"}>
            <div class="paper min-h-0 flex-1 overflow-hidden">
              <DataTable
                rows={props.states}
                columns={stateColumns}
                getRowId={stateId}
                selectedRowId={selectedState() ? stateId(selectedState()!) : null}
                density="compact"
                fillHeight
                empty="No states for this resource."
                scrollPreserveKey={`pulse-resource-${props.resource.key}-states`}
                onRowClick={(state) => setSelectedStateId(stateId(state))}
                renderCell={({ row, col, render }) => {
                  if (col.id === "value") return <span class="line-clamp-2 text-xs text-secondary">{formatSignalValue(row.value)}</span>;
                  if (col.id === "source") return <SourceLink sourceId={row.sourceId} sourceNameById={props.sourceNameById} openSource={props.openSource} />;
                  if (col.id === "dimensions") return renderDimensions(row.dimensions);
                  if (col.id === "updated") return <span class="text-xs text-secondary">{compactDateWithDelta(row.updatedAt, props.dateContext)}</span>;
                  return render(row[col.id as keyof PulseCurrentState]);
                }}
              />
            </div>
          </Show>

          <Show when={activeTab() === "events"}>
            <div class="paper min-h-0 flex-1 overflow-hidden">
              <DataTable
                rows={props.events}
                columns={eventColumns}
                getRowId={(event) => event.id}
                selectedRowId={selectedEvent()?.id ?? null}
                density="compact"
                fillHeight
                empty="No recent events for this resource."
                scrollPreserveKey={`pulse-resource-${props.resource.key}-events`}
                onRowClick={(event) => setSelectedEventId(event.id)}
                renderCell={({ row, col, render }) => {
                  if (col.id === "subject") return <span class="truncate text-xs text-secondary">{signalSubject(row)}</span>;
                  if (col.id === "source") return <SourceLink sourceId={row.sourceId} sourceNameById={props.sourceNameById} openSource={props.openSource} />;
                  if (col.id === "value") return <span class="text-xs text-secondary">{row.value === null ? "-" : formatValue(row.value)}</span>;
                  if (col.id === "time") return <span class="text-xs text-secondary">{compactDateWithDelta(row.ts, props.dateContext)}</span>;
                  return render(row[col.id as keyof PulseRecordedEvent]);
                }}
              />
            </div>
          </Show>
        </div>

        <aside class="grid min-h-0 content-start gap-3 overflow-auto">
          <Show when={selectedMetric()}>
            {(metric) => (
              <section class={activeTab() === "metrics" ? "paper p-4" : "hidden"}>
                <p class="text-label text-xs">Metric value</p>
                <h3 class="mt-2 break-words text-lg font-semibold text-primary">{metric().metric}</h3>
                <p class="mt-1 text-sm text-dimmed">
                  {metric().type}
                  {metric().unit ? ` · ${metric().unit}` : ""}
                  {metric().latestSampleAt ? ` · ${compactDateWithDelta(metric().latestSampleAt!, props.dateContext)}` : ""}
                </p>
                <div class="mt-3">
                  <SourceLink sourceId={metric().sourceId} sourceNameById={props.sourceNameById} openSource={props.openSource} />
                </div>
                <p class="mt-4 text-3xl font-semibold text-primary">{metricValue(metric())}</p>
                <div class="mt-4 flex flex-wrap gap-2">
                  <button type="button" class="btn-input btn-input-sm" onClick={() => props.openMetricQuery(metric())}>
                    <i class="ti ti-code" /> Open query
                  </button>
                  <button type="button" class="btn-input btn-input-sm" onClick={() => props.openMetricVariants(metric().metric)}>
                    <i class="ti ti-stack-2" /> All variants
                  </button>
                </div>
              </section>
            )}
          </Show>

          <Show when={selectedState()}>
            {(state) => (
              <section class={activeTab() === "states" ? "paper p-4" : "hidden"}>
                <p class="text-label text-xs">State value</p>
                <h3 class="mt-2 break-words text-lg font-semibold text-primary">{state().key}</h3>
                <p class="mt-1 text-sm text-dimmed">{compactDateWithDelta(state().updatedAt, props.dateContext)}</p>
                <div class="mt-3">
                  <SourceLink sourceId={state().sourceId} sourceNameById={props.sourceNameById} openSource={props.openSource} />
                </div>
                <p class="mt-4 break-words text-2xl font-semibold text-primary">{formatSignalValue(state().value)}</p>
                <div class="mt-4 flex flex-wrap gap-2">
                  <button type="button" class="btn-input btn-input-sm" onClick={() => props.openStateQuery(state())}>
                    <i class="ti ti-code" /> Open query
                  </button>
                  <button type="button" class="btn-input btn-input-sm" onClick={() => props.openStateVariants(state().key)}>
                    <i class="ti ti-stack-2" /> All variants
                  </button>
                </div>
              </section>
            )}
          </Show>

          <Show when={selectedEvent()}>
            {(event) => (
              <section class={activeTab() === "events" ? "paper p-4" : "hidden"}>
                <p class="text-label text-xs">Event row</p>
                <h3 class="mt-2 break-words text-lg font-semibold text-primary">{event().kind}</h3>
                <p class="mt-1 text-sm text-dimmed">
                  {signalSubject(event())}
                  {" · "}
                  {compactDateWithDelta(event().ts, props.dateContext)}
                </p>
                <div class="mt-3">
                  <SourceLink sourceId={event().sourceId} sourceNameById={props.sourceNameById} openSource={props.openSource} />
                </div>
                <p class="mt-4 text-2xl font-semibold text-primary">{event().value === null ? "-" : formatValue(event().value)}</p>
                <div class="mt-4 flex flex-wrap gap-2">
                  <button type="button" class="btn-input btn-input-sm" onClick={() => props.openEventQuery(event())}>
                    <i class="ti ti-code" /> Open query
                  </button>
                  <button type="button" class="btn-input btn-input-sm" onClick={() => props.openEventVariants(event().kind)}>
                    <i class="ti ti-stack-2" /> All variants
                  </button>
                </div>
              </section>
            )}
          </Show>

          <Show when={selectedMetric()}>
            {(metric) => (
              <section class={activeTab() === "metrics" ? "paper p-4" : "hidden"}>
                <StructuredDataPreview title="Metric dimensions" data={metric().dimensions} empty="No dimensions." />
              </section>
            )}
          </Show>
          <Show when={selectedState()}>
            {(state) => (
              <section class={activeTab() === "states" ? "paper p-4" : "hidden"}>
                <StructuredDataPreview title="State dimensions" data={state().dimensions} empty="No dimensions." />
              </section>
            )}
          </Show>
          <Show when={selectedEvent()}>
            {(event) => (
              <section class={activeTab() === "events" ? "paper p-4" : "hidden"}>
                <StructuredDataPreview title="Event dimensions" data={event().dimensions} empty="No dimensions." />
              </section>
            )}
          </Show>
          <Show when={selectedEvent()}>
            {(event) => (
              <section class={activeTab() === "events" ? "paper p-4" : "hidden"}>
                <StructuredDataPreview title="Event payload" data={event().payload} empty="No payload." />
              </section>
            )}
          </Show>
        </aside>
      </section>
    </section>
  );
}
