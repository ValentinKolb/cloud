import { FilterChip, TextInput } from "@valentinkolb/cloud/ui";
import { For, Show, type Accessor } from "solid-js";
import { METRIC_TYPE_FILTER_OPTIONS } from "./helpers";

export type SignalCatalogKind = "events" | "states" | "metrics";

export type SignalCatalogTab = {
  kind: SignalCatalogKind;
  label: string;
  icon: string;
  count: number;
  open: () => void;
};

const signalCatalogTabClass = (active: boolean) =>
  `inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition ${
    active
      ? "bg-blue-50 text-blue-700 dark:bg-blue-950/70 dark:text-blue-200"
      : "bg-zinc-100/70 text-secondary hover:bg-zinc-100 hover:text-primary dark:bg-zinc-900/60 dark:hover:bg-zinc-900"
  }`;

export const signalCatalogKindForView = (view: string): SignalCatalogKind =>
  view === "activity-states" ? "states" : view === "activity-metrics" ? "metrics" : "events";

export function SignalCatalogTabs(props: { kind: SignalCatalogKind; tabs: SignalCatalogTab[] }) {
  return (
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      <For each={props.tabs}>
        {(tab) => (
          <button type="button" class={signalCatalogTabClass(tab.kind === props.kind)} aria-current={tab.kind === props.kind ? "page" : undefined} onClick={tab.open}>
            <i class={tab.icon} />
            <span>{tab.label}</span>
            <span class="text-dimmed">{tab.count}</span>
          </button>
        )}
      </For>
    </div>
  );
}

export function SignalCatalogToolbar(props: {
  kind: SignalCatalogKind;
  search: Accessor<string>;
  metricTypeFilter: Accessor<string>;
  onSearch: (value: string) => void;
  onMetricTypeFilter: (value: string[]) => void;
}) {
  return (
    <div class="flex min-w-0 flex-1 shrink-0 flex-wrap items-center gap-2">
      <div class="min-w-64 flex-1">
        <TextInput
          type="search"
          icon="ti ti-search"
          value={props.search}
          onInput={props.onSearch}
          placeholder={props.kind === "events" ? "Search events..." : props.kind === "states" ? "Search states..." : "Search metrics..."}
          clearable
        />
      </div>
      <Show when={props.kind === "metrics"}>
        <FilterChip
          label="Type"
          icon="ti ti-filter"
          value={props.metricTypeFilter() ? [props.metricTypeFilter()] : []}
          onChange={props.onMetricTypeFilter}
          options={METRIC_TYPE_FILTER_OPTIONS}
        />
      </Show>
    </div>
  );
}
