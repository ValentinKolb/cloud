import { fuzzy } from "@valentinkolb/stdlib";
import { AppWorkspace, CopyButton, DataTable, TextInput, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { navigate } from "@valentinkolb/ssr/nav";
import { createMemo, createSignal, For } from "solid-js";
import type { PulseCurrentState, PulseMetricSeries, PulseMetricSummary, PulseRecordedEvent, PulseSource } from "../contracts";
import {
  PulseDashboardDslHelpPage,
  PulseInventoryReferenceIntro,
  PulseQueryDslHelpPage,
  PulseReferenceOverviewPage,
} from "./help/pulse-help-content";
import { buildPulseQuery } from "./query-authoring";

type Props = {
  baseName: string;
  includeDashboardDsl: boolean;
  initialTab?: ReferenceTab;
  metrics: PulseMetricSummary[];
  events: PulseRecordedEvent[];
  states: PulseCurrentState[];
  sources: PulseSource[];
  series: PulseMetricSeries[];
};

type MetricRow = PulseMetricSummary & { search: string; visibleSeriesCount: number; sampleSeries: PulseMetricSeries | null };
type EventKindRow = { kind: string; count: number; lastSeenAt: string; search: string };
type StateKeyRow = { key: string; count: number; lastSeenAt: string; search: string };
type ScopeChip = { id: string; label: string; hint: string; count: number; icon: string };
type ReferenceTab = "overview" | "query" | "dashboard" | "inventory";

const referenceTabs = (includeDashboardDsl: boolean) => [
  { value: "overview" as const, label: "Overview", icon: "ti ti-home" },
  { value: "query" as const, label: "Query DSL", icon: "ti ti-code" },
  ...(includeDashboardDsl ? [{ value: "dashboard" as const, label: "Dashboard DSL", icon: "ti ti-layout-dashboard" }] : []),
  { value: "inventory" as const, label: "Inventory", icon: "ti ti-database-search" },
];

const readInitialTab = (includeDashboardDsl: boolean, initialTab?: ReferenceTab): ReferenceTab => {
  if (initialTab === "query" || initialTab === "inventory" || initialTab === "overview") return initialTab;
  if (initialTab === "dashboard" && includeDashboardDsl) return initialTab;
  if (typeof window === "undefined") return includeDashboardDsl ? "dashboard" : "overview";
  const value = new URL(window.location.href).searchParams.get("tab");
  if (value === "query" || value === "inventory" || value === "overview") return value;
  if (value === "dashboard" && includeDashboardDsl) return value;
  return includeDashboardDsl ? "dashboard" : "overview";
};

const writeTabParam = (tab: ReferenceTab) => {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  navigate(`${url.pathname}${url.search}`, { replace: true, scroll: "preserve", viewTransition: false });
};

const quoteQueryValue = (value: string): string =>
  /[\s,=]/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value;

const copyCell = (value: string) => <CopyButton text={value} class="icon-btn h-8 w-8 text-dimmed hover:text-primary" />;

const sourceMatches = (value: { sourceId: string | null }, selectedSourceId: string) =>
  !selectedSourceId || value.sourceId === selectedSourceId;

const entityMatches = (value: { entityId: string | null }, selectedEntityId: string) =>
  !selectedEntityId || value.entityId === selectedEntityId;

const sourceName = (sources: Map<string, PulseSource>, sourceId: string | null): string =>
  sourceId ? (sources.get(sourceId)?.name ?? sourceId.slice(0, 8)) : "No source";

export default function PulseQueryReferenceWindow(props: Props) {
  const [activeTab, setActiveTab] = createSignal<ReferenceTab>(readInitialTab(props.includeDashboardDsl, props.initialTab));
  const [metricQuery, setMetricQuery] = createSignal("");
  const [eventQuery, setEventQuery] = createSignal("");
  const [stateQuery, setStateQuery] = createSignal("");
  const [selectedSourceId, setSelectedSourceId] = createSignal("");
  const [selectedEntityId, setSelectedEntityId] = createSignal("");

  const sourcesById = createMemo(() => new Map(props.sources.map((source) => [source.id, source])));

  const filteredSeries = createMemo(() =>
    props.series.filter((item) => sourceMatches(item, selectedSourceId()) && entityMatches(item, selectedEntityId())),
  );

  const filteredEvents = createMemo(() =>
    props.events.filter((event) => sourceMatches(event, selectedSourceId()) && entityMatches(event, selectedEntityId())),
  );

  const filteredStates = createMemo(() =>
    props.states.filter((state) => sourceMatches(state, selectedSourceId()) && entityMatches(state, selectedEntityId())),
  );

  const sourceChips = createMemo<ScopeChip[]>(() => {
    const counts = new Map<string, number>();
    for (const item of props.series) if (item.sourceId) counts.set(item.sourceId, (counts.get(item.sourceId) ?? 0) + 1);
    for (const item of props.events) if (item.sourceId) counts.set(item.sourceId, (counts.get(item.sourceId) ?? 0) + 1);
    for (const item of props.states) if (item.sourceId) counts.set(item.sourceId, (counts.get(item.sourceId) ?? 0) + 1);
    return props.sources
      .map((source) => ({
        id: source.id,
        label: source.name,
        hint: source.kind,
        count: counts.get(source.id) ?? 0,
        icon: "ti ti-database-share",
      }))
      .filter((chip) => chip.count > 0)
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  });

  const entityChips = createMemo<ScopeChip[]>(() => {
    const entities = new Map<string, { type: string | null; count: number }>();
    const add = (entityId: string | null, entityType: string | null) => {
      if (!entityId) return;
      const current = entities.get(entityId);
      entities.set(entityId, { type: current?.type ?? entityType, count: (current?.count ?? 0) + 1 });
    };
    for (const item of props.series) add(item.entityId, item.entityType);
    for (const item of props.events) add(item.entityId, item.entityType);
    for (const item of props.states) add(item.entityId, item.entityType);
    return [...entities.entries()]
      .map(([id, value]) => ({
        id,
        label: id,
        hint: value.type ?? "entity",
        count: value.count,
        icon: "ti ti-cube",
      }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
      .slice(0, 40);
  });

  const metricRows = createMemo<MetricRow[]>(() => {
    const seriesByMetric = new Map<string, PulseMetricSeries[]>();
    for (const item of filteredSeries()) {
      if (!seriesByMetric.has(item.metric)) seriesByMetric.set(item.metric, []);
      seriesByMetric.get(item.metric)!.push(item);
    }
    const scoped = selectedSourceId() || selectedEntityId();
    const rows = props.metrics
      .map((metric) => {
        const matchingSeries = seriesByMetric.get(metric.name) ?? [];
        return {
          ...metric,
          visibleSeriesCount: matchingSeries.length,
          sampleSeries: matchingSeries[0] ?? null,
          search: [
            metric.name,
            metric.type,
            metric.unit ?? "",
            ...matchingSeries.flatMap((item) => [sourceName(sourcesById(), item.sourceId), item.entityId ?? "", item.entityType ?? "", ...Object.keys(item.dimensions), ...Object.values(item.dimensions)]),
          ].join(" "),
        };
      })
      .filter((metric) => !scoped || metric.visibleSeriesCount > 0);
    const q = metricQuery().trim();
    return q ? fuzzy.filter(q, rows, { key: (row) => row.search, limit: 120 }).map((hit) => hit.item) : rows;
  });

  const eventRows = createMemo<EventKindRow[]>(() => {
    const byKind = new Map<string, EventKindRow>();
    for (const event of filteredEvents()) {
      const dimensionText = `${Object.keys(event.dimensions).join(" ")} ${Object.values(event.dimensions).join(" ")}`;
      const current = byKind.get(event.kind);
      if (!current) {
        byKind.set(event.kind, { kind: event.kind, count: 1, lastSeenAt: event.ts, search: `${event.kind} ${sourceName(sourcesById(), event.sourceId)} ${event.entityId ?? ""} ${event.entityType ?? ""} ${dimensionText}` });
      } else {
        current.count += 1;
        if (new Date(event.ts).getTime() > new Date(current.lastSeenAt).getTime()) current.lastSeenAt = event.ts;
        current.search += ` ${dimensionText} ${event.entityId ?? ""} ${event.entityType ?? ""}`;
      }
    }
    const rows = [...byKind.values()].sort((left, right) => left.kind.localeCompare(right.kind));
    const q = eventQuery().trim();
    return q ? fuzzy.filter(q, rows, { key: (row) => row.search, limit: 120 }).map((hit) => hit.item) : rows;
  });

  const stateRows = createMemo<StateKeyRow[]>(() => {
    const byKey = new Map<string, StateKeyRow>();
    for (const state of filteredStates()) {
      const dimensionText = `${Object.keys(state.dimensions).join(" ")} ${Object.values(state.dimensions).join(" ")}`;
      const current = byKey.get(state.key);
      if (!current) {
        byKey.set(state.key, { key: state.key, count: 1, lastSeenAt: state.updatedAt, search: `${state.key} ${sourceName(sourcesById(), state.sourceId)} ${state.entityId ?? ""} ${state.entityType ?? ""} ${dimensionText}` });
      } else {
        current.count += 1;
        if (new Date(state.updatedAt).getTime() > new Date(current.lastSeenAt).getTime()) current.lastSeenAt = state.updatedAt;
        current.search += ` ${dimensionText} ${state.entityId ?? ""} ${state.entityType ?? ""}`;
      }
    }
    const rows = [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
    const q = stateQuery().trim();
    return q ? fuzzy.filter(q, rows, { key: (row) => row.search, limit: 120 }).map((hit) => hit.item) : rows;
  });

  const selectedSourceClause = () => (selectedSourceId() ? ` source ${selectedSourceId()}` : "");
  const selectedEntityClause = () => (selectedEntityId() ? ` entity ${quoteQueryValue(selectedEntityId())}` : "");
  const selectedEntityTypeClause = () => {
    const entity = entityChips().find((item) => item.id === selectedEntityId());
    return entity?.hint && entity.hint !== "entity" ? ` entity_type ${quoteQueryValue(entity.hint)}` : "";
  };

  const metricCopyQuery = (row: MetricRow): string => {
    const aggregation = row.type === "counter" ? "rate" : row.type === "histogram" || row.type === "summary" ? "p95" : "avg";
    const dimensions = selectedEntityId() && row.sampleSeries ? row.sampleSeries.dimensions : {};
    return buildPulseQuery({ metric: row.name, aggregation, bucket: "5m", since: "24h", sourceId: selectedSourceId() || null, dimensions });
  };

  const eventCopyQuery = (row: EventKindRow): string =>
    `events ${quoteQueryValue(row.kind)} since 7d${selectedSourceClause()}${selectedEntityClause()}${selectedEntityTypeClause()} limit 100`;

  const stateCopyQuery = (row: StateKeyRow): string =>
    `states ${quoteQueryValue(row.key)}${selectedSourceClause()}${selectedEntityClause()}${selectedEntityTypeClause()} limit 100`;

  const metricColumns: DataTableColumn<MetricRow>[] = [
    { id: "name", header: "Metric", value: "name" },
    { id: "type", header: "Type", value: "type", headerClass: "w-28", cellClass: "w-28 whitespace-nowrap" },
    { id: "series", header: "Series", value: (row) => (selectedSourceId() || selectedEntityId() ? row.visibleSeriesCount : row.seriesCount), headerClass: "w-24", cellClass: "w-24 whitespace-nowrap" },
    { id: "copy", header: "", value: metricCopyQuery, headerClass: "w-12", cellClass: "w-12" },
  ];
  const eventColumns: DataTableColumn<EventKindRow>[] = [
    { id: "kind", header: "Event", value: "kind" },
    { id: "count", header: "Recent", value: "count", headerClass: "w-24", cellClass: "w-24 whitespace-nowrap" },
    { id: "copy", header: "", value: eventCopyQuery, headerClass: "w-12", cellClass: "w-12" },
  ];
  const stateColumns: DataTableColumn<StateKeyRow>[] = [
    { id: "key", header: "State", value: "key" },
    { id: "count", header: "Entities", value: "count", headerClass: "w-24", cellClass: "w-24 whitespace-nowrap" },
    { id: "copy", header: "", value: stateCopyQuery, headerClass: "w-12", cellClass: "w-12" },
  ];

  const ScopeChipRow = (props: {
    label: string;
    allLabel: string;
    selected: string;
    items: ScopeChip[];
    onSelect: (id: string) => void;
  }) => (
    <div class="flex flex-col gap-2">
      <p class="text-xs font-semibold text-dimmed">{props.label}</p>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class={`chip cursor-pointer border-0 ${!props.selected ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200" : ""}`}
          onClick={() => props.onSelect("")}
        >
          <i class="ti ti-asterisk" />
          <span>{props.allLabel}</span>
        </button>
        <For each={props.items}>
          {(item) => (
            <button
              type="button"
              class={`chip max-w-full cursor-pointer border-0 ${props.selected === item.id ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200" : ""}`}
              title={`${item.hint} · ${item.count}`}
              onClick={() => props.onSelect(item.id)}
            >
              <i class={item.icon} />
              <span class="truncate">{item.label}</span>
              <span class="text-dimmed">· {item.count}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  );

  const switchTab = (tab: ReferenceTab) => {
    setActiveTab(tab);
    writeTabParam(tab);
  };

  const renderReferenceNav = () => (
    <AppWorkspace.SidebarSection title="Reference">
      <For each={referenceTabs(props.includeDashboardDsl)}>
        {(tab) => (
          <AppWorkspace.SidebarItem icon={tab.icon} active={activeTab() === tab.value} onClick={() => switchTab(tab.value)}>
            {tab.label}
          </AppWorkspace.SidebarItem>
        )}
      </For>
    </AppWorkspace.SidebarSection>
  );

  const renderOverview = () => <PulseReferenceOverviewPage includeDashboardDsl={props.includeDashboardDsl} />;
  const renderQueryDsl = () => <PulseQueryDslHelpPage />;
  const renderDashboardDsl = () => <PulseDashboardDslHelpPage />;

  const renderInventory = () => (
    <>
      <PulseInventoryReferenceIntro />
      <section class="paper flex flex-col gap-4 p-4">
        <ScopeChipRow label="Sources" allLabel="All sources" selected={selectedSourceId()} items={sourceChips()} onSelect={setSelectedSourceId} />
        <ScopeChipRow label="Entities" allLabel="All entities" selected={selectedEntityId()} items={entityChips()} onSelect={setSelectedEntityId} />
      </section>

      <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section class="flex min-h-0 flex-col gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-secondary">
              <i class="ti ti-chart-dots" /> Metrics <span class="text-dimmed">{metricRows().length}</span>
            </h2>
            <div class="w-full sm:w-64">
              <TextInput value={metricQuery} onInput={setMetricQuery} icon="ti ti-search" placeholder="Search metrics..." clearable />
            </div>
          </div>
          <DataTable
            rows={metricRows()}
            columns={metricColumns}
            getRowId={(row) => row.name}
            class="paper max-h-[420px] min-h-64 overflow-auto"
            empty="No matching metrics"
            renderCell={({ row, col, value }) => {
              if (col.id === "name") return <code class="font-mono text-secondary">{row.name}</code>;
              if (col.id === "copy") return copyCell(String(value));
              return <span class="text-dimmed">{String(value ?? "-")}</span>;
            }}
          />
        </section>

        <section class="flex min-h-0 flex-col gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-secondary">
              <i class="ti ti-bolt" /> Events <span class="text-dimmed">{eventRows().length}</span>
            </h2>
            <div class="w-full sm:w-64">
              <TextInput value={eventQuery} onInput={setEventQuery} icon="ti ti-search" placeholder="Search events..." clearable />
            </div>
          </div>
          <DataTable
            rows={eventRows()}
            columns={eventColumns}
            getRowId={(row) => row.kind}
            class="paper max-h-[420px] min-h-64 overflow-auto"
            empty="No matching events"
            renderCell={({ row, col, value }) => {
              if (col.id === "kind") return <code class="font-mono text-secondary">{row.kind}</code>;
              if (col.id === "copy") return copyCell(String(value));
              return <span class="text-dimmed">{String(value ?? "-")}</span>;
            }}
          />
        </section>

        <section class="flex min-h-0 flex-col gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-secondary">
              <i class="ti ti-toggle-right" /> States <span class="text-dimmed">{stateRows().length}</span>
            </h2>
            <div class="w-full sm:w-64">
              <TextInput value={stateQuery} onInput={setStateQuery} icon="ti ti-search" placeholder="Search states..." clearable />
            </div>
          </div>
          <DataTable
            rows={stateRows()}
            columns={stateColumns}
            getRowId={(row) => row.key}
            class="paper max-h-[420px] min-h-64 overflow-auto"
            empty="No matching states"
            renderCell={({ row, col, value }) => {
              if (col.id === "key") return <code class="font-mono text-secondary">{row.key}</code>;
              if (col.id === "copy") return copyCell(String(value));
              return <span class="text-dimmed">{String(value ?? "-")}</span>;
            }}
          />
        </section>
      </div>
    </>
  );

  return (
    <AppWorkspace class="h-screen bg-zinc-50 p-3 dark:bg-zinc-950 md:p-4">
      <AppWorkspace.Sidebar>
        <AppWorkspace.SidebarHeader title="Pulse reference" subtitle={props.baseName} icon="ti ti-book" />
        <AppWorkspace.SidebarMobile>
          <AppWorkspace.SidebarMobileBody scrollPreserveKey="pulse-reference-mobile">{renderReferenceNav()}</AppWorkspace.SidebarMobileBody>
        </AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarDesktop>
          <AppWorkspace.SidebarBody scrollPreserveKey="pulse-reference-sidebar">{renderReferenceNav()}</AppWorkspace.SidebarBody>
        </AppWorkspace.SidebarDesktop>
      </AppWorkspace.Sidebar>

      <AppWorkspace.Main class="overflow-y-auto">
        <div class="mx-auto flex w-full max-w-7xl flex-col gap-5 p-1 pb-8">
          {activeTab() === "overview"
            ? renderOverview()
            : activeTab() === "query"
              ? renderQueryDsl()
              : activeTab() === "dashboard"
                ? renderDashboardDsl()
                : renderInventory()}
        </div>
      </AppWorkspace.Main>
    </AppWorkspace>
  );
}
