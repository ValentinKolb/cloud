import { DataTable, FilterChip, TextInput, type DataTableColumn, type FilterChipSection } from "@valentinkolb/cloud/ui";
import { createMemo, For, Show } from "solid-js";
import type { PulseInventory, PulseResourceSummary } from "../../contracts";
import { compactDateWithDelta, dimensionsSummary, plural, type PulseDateContext } from "./helpers";

type Props = {
  search: () => string;
  setSearch: (value: string) => void;
  sourceFilter: () => string;
  setSourceFilter: (value: string[]) => void;
  typeFilter: () => string;
  setTypeFilter: (value: string[]) => void;
  clearFilters: () => void;
  inventory: () => PulseInventory;
  filteredResources: () => PulseResourceSummary[];
  selectedResource: () => PulseResourceSummary | null;
  dateContext: PulseDateContext;
  openResource: (key: string) => void;
  resourceSourceLabel: (resource: PulseResourceSummary) => string;
  sourceNameById: () => Map<string, string>;
};

const resourceIcon = (type: string | null) => {
  if (type === "container") return "ti ti-box";
  if (type === "host") return "ti ti-server";
  if (type === "service") return "ti ti-route";
  if (type === "project") return "ti ti-layout-grid";
  if (type === "filesystem") return "ti ti-folder";
  if (type === "network") return "ti ti-network";
  if (type === "source") return "ti ti-database-share";
  return "ti ti-cube";
};

export default function ResourceBrowserView(props: Props) {
  const resourceColumns: DataTableColumn<PulseResourceSummary>[] = [
    { id: "resource", header: "Resource", value: "label", cellClass: "min-w-72" },
    { id: "type", header: "Type", value: "type", cellClass: "w-32 whitespace-nowrap" },
    { id: "source", header: "Source", cellClass: "min-w-40" },
    { id: "signals", header: "Signals", cellClass: "w-40 whitespace-nowrap" },
    { id: "lastSeen", header: "Last seen", value: "lastSeenAt", cellClass: "w-44 whitespace-nowrap" },
  ];
  const typeCounts = createMemo(() => {
    const counts = new Map<string, number>();
    for (const resource of props.inventory().resources) {
      const type = resource.type ?? "resource";
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  });
  const sourceLabel = (sourceId: string) => props.sourceNameById().get(sourceId) ?? "Unknown source";
  const sourceCounts = createMemo(() => {
    const counts = new Map<string, number>();
    for (const resource of props.inventory().resources) {
      for (const sourceId of resource.sourceIds) counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || sourceLabel(left[0]).localeCompare(sourceLabel(right[0])));
  });
  const sourceCount = createMemo(() => new Set(props.inventory().resources.flatMap((resource) => resource.sourceIds)).size);
  const selectedSourceLabel = createMemo(() => (props.sourceFilter() ? sourceLabel(props.sourceFilter()) : ""));
  const selectedTypeLabel = createMemo(() => props.typeFilter());
  const hasFilters = createMemo(() => Boolean(props.sourceFilter() || props.typeFilter()));
  const typeFilterOptions = createMemo<FilterChipSection[]>(() => [
    {
      options: typeCounts().map(([type, count]) => ({
        value: type,
        label: `${type} (${count})`,
        icon: resourceIcon(type),
      })),
    },
  ]);
  const sourceFilterOptions = createMemo<FilterChipSection[]>(() => [
    {
      options: sourceCounts().map(([sourceId, count]) => ({
        value: sourceId,
        label: `${sourceLabel(sourceId)} (${count})`,
        icon: "ti ti-database-share",
      })),
    },
  ]);

  const renderResourceCell = (resource: PulseResourceSummary, col: DataTableColumn<PulseResourceSummary>) => {
    if (col.id === "resource") {
      return (
        <div class="flex min-w-0 items-center gap-2">
          <span class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
            <i class={`${resourceIcon(resource.type)} text-sm`} />
          </span>
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-primary">{resource.label || resource.id}</p>
            <p class="mt-0.5 truncate text-[11px] text-dimmed">{dimensionsSummary(resource.dimensions, 3) || resource.id}</p>
          </div>
        </div>
      );
    }
    if (col.id === "type") return <span class="text-xs text-secondary">{resource.type ?? "resource"}</span>;
    if (col.id === "source") return <span class="text-xs text-secondary">{props.resourceSourceLabel(resource)}</span>;
    if (col.id === "signals") {
      const count = resource.metricCount + resource.stateCount + resource.eventCount;
      return (
        <span class="text-xs text-secondary">
          {plural(count, "signal")}{" "}
          <span class="text-dimmed">
            ({resource.metricCount}m/{resource.stateCount}s/{resource.eventCount}e)
          </span>
        </span>
      );
    }
    if (col.id === "lastSeen")
      return <span class="text-xs text-secondary">{resource.lastSeenAt ? compactDateWithDelta(resource.lastSeenAt, props.dateContext) : "-"}</span>;
    return resource[col.id as keyof PulseResourceSummary] as string;
  };

  return (
    <section class="flex min-h-0 flex-1 flex-col gap-3">
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <div class="min-w-64 flex-1">
          <TextInput
            type="search"
            icon="ti ti-search"
            value={props.search}
            onInput={props.setSearch}
            placeholder="Search resources, sources, labels, hosts, services..."
            clearable
          />
        </div>
        <FilterChip
          label="Source"
          icon="ti ti-database-share"
          options={sourceFilterOptions()}
          value={props.sourceFilter() ? [props.sourceFilter()] : []}
          onChange={props.setSourceFilter}
          isActive={Boolean(props.sourceFilter())}
          defaultValue={[]}
        />
        <FilterChip
          label="Type"
          icon="ti ti-filter"
          options={typeFilterOptions()}
          value={props.typeFilter() ? [props.typeFilter()] : []}
          onChange={props.setTypeFilter}
          isActive={Boolean(props.typeFilter())}
          defaultValue={[]}
        />
      </div>

      <div class="paper shrink-0 px-3 py-2">
        <div class="flex flex-wrap items-center gap-2 text-xs text-secondary">
          <span class="chip border-0">
            <i class="ti ti-cube" />
            {plural(props.filteredResources().length, "resource")}
            <Show when={props.filteredResources().length !== props.inventory().resources.length}>
              <span class="text-dimmed">of {props.inventory().resources.length.toLocaleString()}</span>
            </Show>
          </span>
          <span class="chip border-0">
            <i class="ti ti-database-share" />
            {plural(sourceCount(), "source")}
          </span>
          <Show when={props.sourceFilter()}>
            <button type="button" class="chip border-0 bg-blue-50 text-blue-700 dark:bg-blue-950/70 dark:text-blue-200" onClick={() => props.setSourceFilter([])}>
              <i class="ti ti-database-share" />
              {selectedSourceLabel()}
              <i class="ti ti-x text-[10px]" />
            </button>
          </Show>
          <Show when={props.typeFilter()}>
            <button type="button" class="chip border-0 bg-blue-50 text-blue-700 dark:bg-blue-950/70 dark:text-blue-200" onClick={() => props.setTypeFilter([])}>
              <i class={resourceIcon(props.typeFilter())} />
              {selectedTypeLabel()}
              <i class="ti ti-x text-[10px]" />
            </button>
          </Show>
          <Show when={hasFilters()}>
            <button type="button" class="chip border-0 text-dimmed transition hover:text-primary" onClick={props.clearFilters}>
              <i class="ti ti-filter-off" />
              Clear filters
            </button>
          </Show>
          <For each={typeCounts().slice(0, 8)}>
            {([type, count]) => (
              <span class="chip border-0">
                <i class={resourceIcon(type)} />
                {type} · {count}
              </span>
            )}
          </For>
          <Show when={typeCounts().length > 8}>
            <span class="text-xs text-dimmed">+{typeCounts().length - 8} types</span>
          </Show>
        </div>
      </div>

      <DataTable
        rows={props.filteredResources()}
        columns={resourceColumns}
        getRowId={(resource) => resource.key}
        selectedRowId={props.selectedResource()?.key ?? null}
        onRowClick={(resource) => props.openResource(resource.key)}
        density="compact"
        fillHeight
        class="paper flex-1 min-h-0 overflow-auto"
        empty="No resources detected yet."
        scrollPreserveKey="pulse-resources-table"
        renderCell={({ row, col }) => renderResourceCell(row, col)}
      />
    </section>
  );
}
