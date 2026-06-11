import { StructuredDataPreview, TextInput } from "@valentinkolb/cloud/ui";
import { For, Show } from "solid-js";
import type {
  PulseCurrentState,
  PulseInventory,
  PulseRecordedEvent,
  PulseResourceMetric,
  PulseResourceSummary,
} from "../../contracts";
import { compactDateWithDelta, dimensionsSummary, formatSignalValue, plural } from "./helpers";

type Props = {
  search: () => string;
  setSearch: (value: string) => void;
  inventory: () => PulseInventory;
  filteredResources: () => PulseResourceSummary[];
  selectedResource: () => PulseResourceSummary | null;
  setSelectedResourceKey: (key: string) => void;
  resourceSourceLabel: (resource: PulseResourceSummary) => string;
  selectedResourceMetrics: () => PulseResourceMetric[];
  selectedResourceStates: () => PulseCurrentState[];
  selectedResourceEvents: () => PulseRecordedEvent[];
  sourceNameById: () => Map<string, string>;
  openMetricQuery: (metric: PulseResourceMetric) => void;
  openStateQuery: (state: PulseCurrentState) => void;
  openEventQuery: (event: PulseRecordedEvent) => void;
};

export default function ResourceBrowserView(props: Props) {
  return (
    <section class="flex min-h-0 flex-1 flex-col gap-3">
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <div class="min-w-64 flex-1">
          <TextInput
            type="search"
            icon="ti ti-search"
            value={props.search}
            onInput={props.setSearch}
            placeholder="Search resources, sources, labels, hosts, containers..."
            clearable
          />
        </div>
        <span class="chip">
          <i class="ti ti-cube" />
          {plural(props.inventory().resources.length, "resource")}
        </span>
        <span class="chip">
          <i class="ti ti-chart-dots" />
          {plural(props.inventory().metrics.length, "variant")}
        </span>
      </div>

      <div class="grid min-h-0 flex-1 gap-3 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <aside class="paper min-h-0 overflow-hidden">
          <div class="flex h-full min-h-0 flex-col">
            <div class="shrink-0 px-3 py-2">
              <p class="text-label text-xs">Resources</p>
              <p class="mt-1 text-xs text-dimmed">Hosts, containers, services, jobs, and other entities inferred from incoming data.</p>
            </div>
            <div class="min-h-0 flex-1 overflow-auto px-2 pb-2">
              <Show when={props.filteredResources().length > 0} fallback={<p class="px-2 py-3 text-xs text-dimmed">No matching resources.</p>}>
                <For each={props.filteredResources()}>
                  {(item) => {
                    const selected = () => props.selectedResource()?.key === item.key;
                    return (
                      <button
                        type="button"
                        class="block w-full rounded px-2 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                        classList={{ "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200": selected() }}
                        onClick={() => props.setSelectedResourceKey(item.key)}
                      >
                        <span class="flex min-w-0 items-center gap-2">
                          <i class={`ti ${item.type === "container" ? "ti-box" : item.type === "host" ? "ti-server" : "ti-cube"} text-sm`} />
                          <span class="min-w-0 flex-1 truncate text-sm font-semibold">{item.id}</span>
                          <span class="text-[11px] text-dimmed">{item.type ?? "resource"}</span>
                        </span>
                        <span class="mt-1 block truncate text-[11px] text-dimmed">{props.resourceSourceLabel(item)}</span>
                        <span class="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-dimmed">
                          <span>{plural(item.metricCount, "metric")}</span>
                          <span>{plural(item.stateCount, "state")}</span>
                          <span>{plural(item.eventCount, "event")}</span>
                        </span>
                      </button>
                    );
                  }}
                </For>
              </Show>
            </div>
          </div>
        </aside>

        <Show
          when={props.selectedResource()}
          fallback={
            <div class="paper flex min-h-0 items-center justify-center p-6 text-center text-sm text-dimmed">
              No resources detected yet. Push or scrape data with host, service, container, or entity dimensions to make Pulse browsable.
            </div>
          }
        >
          {(item) => (
            <div class="min-h-0 overflow-auto">
              <div class="grid gap-3">
                <section class="paper p-4">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                      <p class="text-label text-xs">Selected resource</p>
                      <h2 class="mt-1 truncate text-xl font-semibold text-primary">{item().id}</h2>
                      <p class="mt-1 text-sm text-dimmed">
                        {item().type ?? "resource"} · {props.resourceSourceLabel(item())}
                        {item().lastSeenAt ? ` · ${compactDateWithDelta(item().lastSeenAt as string)}` : ""}
                      </p>
                    </div>
                    <div class="flex flex-wrap gap-2 text-xs text-dimmed">
                      <span class="chip">
                        <i class="ti ti-chart-dots" />
                        {plural(item().metricCount, "metric")}
                      </span>
                      <span class="chip">
                        <i class="ti ti-toggle-right" />
                        {plural(item().stateCount, "state")}
                      </span>
                      <span class="chip">
                        <i class="ti ti-bolt" />
                        {plural(item().eventCount, "event")}
                      </span>
                    </div>
                  </div>
                  <Show when={Object.keys(item().dimensions).length > 0}>
                    <div class="mt-3">
                      <StructuredDataPreview title="Dimensions" data={item().dimensions} empty="No dimensions." />
                    </div>
                  </Show>
                </section>

                <div class="grid min-h-0 gap-3 2xl:grid-cols-3">
                  <section class="paper min-h-80 overflow-hidden">
                    <div class="flex items-center justify-between gap-2 px-3 py-2">
                      <h3 class="text-label text-xs">Metrics</h3>
                      <span class="text-[11px] text-dimmed">{plural(props.selectedResourceMetrics().length, "variant")}</span>
                    </div>
                    <div class="max-h-[36rem] overflow-auto px-2 pb-2">
                      <Show when={props.selectedResourceMetrics().length > 0} fallback={<p class="px-1 py-3 text-xs text-dimmed">No metrics for this resource.</p>}>
                        <For each={props.selectedResourceMetrics()}>
                          {(metric) => (
                            <button
                              type="button"
                              class="group block w-full rounded px-2 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                              onClick={() => props.openMetricQuery(metric)}
                            >
                              <span class="flex min-w-0 items-center gap-2">
                                <i class="ti ti-chart-dots text-dimmed" />
                                <span class="min-w-0 flex-1 truncate text-sm font-medium text-secondary">{metric.metric}</span>
                                <i class="ti ti-arrow-right text-dimmed opacity-0 transition group-hover:opacity-100" />
                              </span>
                              <span class="mt-1 block truncate text-[11px] text-dimmed">
                                {metric.type}
                                {metric.unit ? ` · ${metric.unit}` : ""} · {props.sourceNameById().get(metric.sourceId ?? "") ?? "No source"}
                              </span>
                              <Show when={dimensionsSummary(metric.dimensions)}>
                                {(summary) => <span class="mt-1 block truncate text-[11px] text-dimmed">{summary()}</span>}
                              </Show>
                            </button>
                          )}
                        </For>
                      </Show>
                    </div>
                  </section>

                  <section class="paper min-h-80 overflow-hidden">
                    <div class="flex items-center justify-between gap-2 px-3 py-2">
                      <h3 class="text-label text-xs">States</h3>
                      <span class="text-[11px] text-dimmed">{plural(props.selectedResourceStates().length, "state")}</span>
                    </div>
                    <div class="max-h-[36rem] overflow-auto px-2 pb-2">
                      <Show when={props.selectedResourceStates().length > 0} fallback={<p class="px-1 py-3 text-xs text-dimmed">No states for this resource.</p>}>
                        <For each={props.selectedResourceStates()}>
                          {(state) => (
                            <button
                              type="button"
                              class="group block w-full rounded px-2 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                              onClick={() => props.openStateQuery(state)}
                            >
                              <span class="flex min-w-0 items-center gap-2">
                                <i class="ti ti-toggle-right text-dimmed" />
                                <span class="min-w-0 flex-1 truncate text-sm font-medium text-secondary">{state.key}</span>
                                <i class="ti ti-arrow-right text-dimmed opacity-0 transition group-hover:opacity-100" />
                              </span>
                              <span class="mt-1 block truncate text-[11px] text-dimmed">{formatSignalValue(state.value)}</span>
                              <span class="mt-1 block truncate text-[11px] text-dimmed">
                                {props.sourceNameById().get(state.sourceId ?? "") ?? "No source"} · {compactDateWithDelta(state.updatedAt)}
                              </span>
                            </button>
                          )}
                        </For>
                      </Show>
                    </div>
                  </section>

                  <section class="paper min-h-80 overflow-hidden">
                    <div class="flex items-center justify-between gap-2 px-3 py-2">
                      <h3 class="text-label text-xs">Events</h3>
                      <span class="text-[11px] text-dimmed">{plural(props.selectedResourceEvents().length, "recent event")}</span>
                    </div>
                    <div class="max-h-[36rem] overflow-auto px-2 pb-2">
                      <Show when={props.selectedResourceEvents().length > 0} fallback={<p class="px-1 py-3 text-xs text-dimmed">No recent events for this resource.</p>}>
                        <For each={props.selectedResourceEvents()}>
                          {(event) => (
                            <button
                              type="button"
                              class="group block w-full rounded px-2 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                              onClick={() => props.openEventQuery(event)}
                            >
                              <span class="flex min-w-0 items-center gap-2">
                                <i class="ti ti-bolt text-dimmed" />
                                <span class="min-w-0 flex-1 truncate text-sm font-medium text-secondary">{event.kind}</span>
                                <i class="ti ti-arrow-right text-dimmed opacity-0 transition group-hover:opacity-100" />
                              </span>
                              <span class="mt-1 block truncate text-[11px] text-dimmed">
                                {props.sourceNameById().get(event.sourceId ?? "") ?? "No source"} · {compactDateWithDelta(event.ts)}
                              </span>
                            </button>
                          )}
                        </For>
                      </Show>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          )}
        </Show>
      </div>
    </section>
  );
}
