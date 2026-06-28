import { fuzzy } from "@valentinkolb/stdlib";
import { AppWorkspace, CopyButton, DataTable, DocCode, DocInlineCode, DocNote, DocPage, DocSection, TextInput, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { navigate } from "@valentinkolb/ssr/nav";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { PulseCurrentState, PulseMetricSeries, PulseMetricSummary, PulseRecordedEvent, PulseSource } from "../contracts";
import { buildPulseQuery, pulseQueryHighlight } from "./query-authoring";

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
type SyntaxRow = { clause: string; appliesTo: string; meaning: string; example: string };
type AggregationRow = { name: string; meaning: string; bestFor: string; example: string };
type DashboardStatementRow = { statement: string; scope: string; meaning: string; example: string };
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

const formatPulseQuery = (query: string): string =>
  query
    .replace(/\s+(every|since|source|entity|entity_type|where|limit)\b/gi, "\n$1")
    .replace(/,\s*/g, ",\n  ");

const quoteQueryValue = (value: string): string =>
  /[\s,=]/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value;

const copyCell = (value: string) => <CopyButton text={value} class="icon-btn h-8 w-8 text-dimmed hover:text-primary" />;

const metricSyntax = `metric <metric> <aggregation>
  [every <duration>]
  [since <duration>]
  [source <uuid>]
  [entity <id>]
  [entity_type <type>]
  [where <key>=<value>, ...]`;

const eventsSyntax = `events [<kind>|*]
  [since <duration>]
  [source <uuid>]
  [entity <id>]
  [entity_type <type>]
  [where <key>=<value>, ...]
  [limit <rows>]`;

const statesSyntax = `states [<key>|*]
  [since <duration>]
  [source <uuid>]
  [entity <id>]
  [entity_type <type>]
  [where <key>=<value>, ...]
  [limit <rows>]`;

const dashboardSyntax = `dashboard "Name" {
  description "Optional context."

  controls {
    range "Range" variable range default 24h options 1h, 6h, 24h, 7d
    source "Source" variable source_id default 00000000-0000-4000-8000-000000000000
    entity "Entity" variable entity_id type container default container:app-core
    label "Region" variable region default eu options eu, us
    text "Search" variable search default ""
  }

  section "Section" {
    grid height md {
      chart "Chart title" {
        query metric orders.created increase every 1h since $range source $source_id where region=$region
        warn when value > 100
      }
    }

    table "Recent events" {
      query events deploy.finished since $range entity $entity_id limit 50
    }

    table "Current states" {
      query states service.online entity $entity_id limit 50
    }

    markdown "Notes" {
      """
      ## Markdown content
      Add context, links, and operating notes.
      """
    }
  }
}`;

const dashboardExample = `dashboard "Solar overview" {
  description "Live power, battery state, and grid interaction."

  section "Today" {
    description "Operational view for the current day."

    card "Battery" {
      description "Shows current charge and recent charge/discharge trend."

      gauge "Charge" {
        description "Latest state of charge reported by the inverter."
        query metric solar.battery.charge_percent latest since 10m
        warn when value < 20 message "Battery is low"
        critical when value < 10 message "Battery is critical"
      }
    }

    markdown "Notes" {
      """
      ## Operating notes

      - Values update every minute.
      - Grid import above 2 kW usually means the battery is empty.
      - Check inverter status if output drops while irradiance is high.
      """
    }
  }
}`;

const syntaxRows: SyntaxRow[] = [
  { clause: "metric <metric> <aggregation>", appliesTo: "metric", meaning: "Select one numeric metric and define how samples are reduced.", example: "metric orders.created increase" },
  { clause: "events [<kind>|*]", appliesTo: "events", meaning: "Return event rows by kind. Omit the kind or use * for all events.", example: "events deploy.finished" },
  { clause: "states [<key>|*]", appliesTo: "states", meaning: "Return current state rows by key. Omit the key or use * for all states.", example: "states host.online" },
  { clause: "every <duration>", appliesTo: "metric", meaning: "Bucket metric samples into fixed time windows. Defaults to 5m.", example: "every 15m" },
  { clause: "since <duration>", appliesTo: "metric, events, states", meaning: "Limit by time. Metric/events default to 24h. States only filter stale current values when provided.", example: "since 7d" },
  { clause: "source <uuid>", appliesTo: "all", meaning: "Restrict results to one source.", example: "source 00000000-0000-4000-8000-000000000000" },
  { clause: "entity <id>", appliesTo: "all", meaning: "Restrict results to one entity identifier such as a customer, order, device, service, or host.", example: "entity order-1001" },
  { clause: "entity_type <type>", appliesTo: "all", meaning: "Restrict results to one entity type.", example: "entity_type order" },
  { clause: "where <key>=<value>", appliesTo: "all", meaning: "Filter dimensions. Separate multiple filters with commas.", example: "where env=prod, region=eu" },
  { clause: "limit <rows>", appliesTo: "events, states", meaning: "Limit returned rows. Values above 1000 are clamped.", example: "limit 100" },
];

const aggregationRows: AggregationRow[] = [
  { name: "avg", meaning: "Average samples in each bucket.", bestFor: "Gauges like utilization, temperature, output, or quality scores.", example: "metric solar.output_watts avg every 15m since 7d" },
  { name: "latest", meaning: "Latest value per series in each bucket.", bestFor: "Current-ish gauges and status numbers.", example: "metric battery.charge_percent latest every 5m since 24h" },
  { name: "min / max", meaning: "Smallest or largest sample in each bucket.", bestFor: "Dips, peaks, capacity checks.", example: "metric inventory.stock_level max every 1h since 30d" },
  { name: "sum", meaning: "Add samples in each bucket.", bestFor: "Combined totals across series.", example: "metric solar.output_watts sum every 5m since 24h" },
  { name: "count", meaning: "Count samples, not their values.", bestFor: "Sample presence and collection checks.", example: "metric website.visitors count every 1h since 7d" },
  { name: "rate", meaning: "Counter change per second, with resets clamped.", bestFor: "Requests/sec, bytes/sec, throughput.", example: "metric http_requests_total rate every 1m since 1h" },
  { name: "increase", meaning: "Counter increase inside each bucket.", bestFor: "Orders, visitors, requests per bucket.", example: "metric sales.orders increase every 1h since 7d" },
  { name: "p50 / p90 / p95 / p99", meaning: "Percentiles over samples in each bucket.", bestFor: "Latency and distribution metrics.", example: "metric http_request_duration_seconds p95 every 5m since 24h" },
];

const syntaxColumns: DataTableColumn<SyntaxRow>[] = [
  { id: "clause", header: "Clause", value: "clause", cellClass: "min-w-56" },
  { id: "appliesTo", header: "Applies to", value: "appliesTo", cellClass: "w-36 whitespace-nowrap" },
  { id: "meaning", header: "Meaning", value: "meaning" },
  { id: "copy", header: "", value: (row) => row.example, headerClass: "w-12", cellClass: "w-12" },
];

const aggregationColumns: DataTableColumn<AggregationRow>[] = [
  { id: "name", header: "Aggregation", value: "name", cellClass: "w-32 whitespace-nowrap" },
  { id: "meaning", header: "Meaning", value: "meaning" },
  { id: "bestFor", header: "Best for", value: "bestFor" },
  { id: "copy", header: "", value: (row) => row.example, headerClass: "w-12", cellClass: "w-12" },
];

const dashboardStatementRows: DashboardStatementRow[] = [
  { statement: 'dashboard "Name" { ... }', scope: "root", meaning: "Defines one dashboard document. This is the canonical editable source.", example: 'dashboard "Ops" { section "Main" {} }' },
  { statement: 'description "Text"', scope: "dashboard, section, card, widget", meaning: "Adds reader-facing context without changing data queries.", example: 'description "Live operational view."' },
  { statement: "controls { ... }", scope: "dashboard", meaning: "Declares reusable variables rendered above the dashboard.", example: 'controls { range "Range" variable range default 24h options 1h, 24h }' },
  { statement: 'range/source/entity/entity_type/label/text "Label"', scope: "controls", meaning: "Creates a control. Use variable, default, options, and type where useful.", example: 'entity "Container" variable entity_id type container default container:app-core' },
  { statement: 'section "Name" { ... }', scope: "dashboard, section", meaning: "Groups related rows and nested sections.", example: 'section "Today" { chart "Orders" { query metric orders.created increase since 24h } }' },
  { statement: "row height sm|md|lg { ... }", scope: "section, card", meaning: "Places multiple widgets in one row. grid is an alias.", example: 'grid height lg { chart "CPU" { query metric system.cpu.usage avg since 6h } }' },
  { statement: 'card "Name" [span n] { ... }', scope: "section, row, card", meaning: "Frames related child widgets and optional markdown.", example: 'card "Battery" span 6 { gauge "Charge" { query metric battery.charge latest since 10m } }' },
  { statement: 'markdown "Name" [span n] { """ ... """ }', scope: "section, row, card", meaning: "Adds Markdown notes, explanations, runbooks, or links.", example: 'markdown "Notes" { """## Notes\\n- Check importer health.""" }' },
  { statement: 'chart/line/bar/stat/gauge/barGauge/histogram/heatmap/table "Name"', scope: "section, row, card", meaning: "Adds a query-backed widget. table is also used for events and states.", example: 'gauge "Charge" { query metric battery.charge latest since 10m }' },
  { statement: "query <Query DSL>", scope: "widget", meaning: "Embeds metric, events, or states Query DSL. Dashboard controls may be referenced as $variables.", example: "query metric orders.created increase every 1h since $range where region=$region" },
  { statement: "warn|critical when value <op> <value>", scope: "metric/state widget", meaning: "Applies visual state only. It does not send alerts or call webhooks.", example: 'critical when value > 95 message "Capacity almost full"' },
];

const dashboardStatementColumns: DataTableColumn<DashboardStatementRow>[] = [
  { id: "statement", header: "Statement", value: "statement", cellClass: "min-w-72" },
  { id: "scope", header: "Scope", value: "scope", cellClass: "w-40 whitespace-nowrap" },
  { id: "meaning", header: "Meaning", value: "meaning" },
  { id: "copy", header: "", value: (row) => row.example, headerClass: "w-12", cellClass: "w-12" },
];

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

  const renderQueryDsl = () => (
    <DocPage class="mx-0 max-w-none">
      <DocSection title="Statement types" eyebrow="Query DSL">
        <div class="grid gap-3 lg:grid-cols-3">
          <DocCode
            title="Metric"
            code={metricSyntax}
            highlight={pulseQueryHighlight}
            copyText="metric <metric> <aggregation> [every <duration>] [since <duration>] [source <uuid>] [where <key>=<value>, ...]"
            copy
          />
          <DocCode
            title="Events"
            code={eventsSyntax}
            highlight={pulseQueryHighlight}
            copyText="events [<kind>|*] [since <duration>] [source <uuid>] [entity <id>] [entity_type <type>] [where <key>=<value>, ...] [limit <rows>]"
            copy
          />
          <DocCode
            title="States"
            code={statesSyntax}
            highlight={pulseQueryHighlight}
            copyText="states [<key>|*] [since <duration>] [source <uuid>] [entity <id>] [entity_type <type>] [where <key>=<value>, ...] [limit <rows>]"
            copy
          />
        </div>
      </DocSection>

      <DocSection title="Clause reference">
        <DataTable
          rows={syntaxRows}
          columns={syntaxColumns}
          getRowId={(row) => row.clause}
          class="paper overflow-auto"
          density="compact"
          renderCell={({ row, col, value }) => {
            if (col.id === "clause") return <code class="font-mono text-secondary">{row.clause}</code>;
            if (col.id === "copy") return copyCell(String(value));
            return <span class="text-dimmed">{String(value)}</span>;
          }}
        />
      </DocSection>

      <DocSection title="Aggregations">
        <DataTable
          rows={aggregationRows}
          columns={aggregationColumns}
          getRowId={(row) => row.name}
          class="paper overflow-auto"
          density="compact"
          renderCell={({ row, col, value }) => {
            if (col.id === "name") return <code class="font-mono text-secondary">{row.name}</code>;
            if (col.id === "copy") return copyCell(String(value));
            return <span class="text-dimmed">{String(value)}</span>;
          }}
        />
      </DocSection>

      <DocSection title="Rules">
        <div class="grid gap-3 text-sm lg:grid-cols-2">
          <DocNote title="Metrics aggregate samples" variant="info">
            <DocInlineCode>metric</DocInlineCode> requires a metric and aggregation. Use <DocInlineCode>every</DocInlineCode> to choose
            buckets and <DocInlineCode>since</DocInlineCode> to define the time range.
          </DocNote>
          <DocNote title="Events and states return rows" variant="tip">
            <DocInlineCode>events</DocInlineCode> and <DocInlineCode>states</DocInlineCode> start as table output. Use{" "}
            <DocInlineCode>source</DocInlineCode>, <DocInlineCode>entity</DocInlineCode>, <DocInlineCode>entity_type</DocInlineCode>,{" "}
            <DocInlineCode>where</DocInlineCode>, and <DocInlineCode>limit</DocInlineCode> to narrow them.
          </DocNote>
          <DocNote title="Names and values" variant="info">
            Use quotes when a metric, event, state, entity, or dimension value contains spaces, commas, or equals signs. Use{" "}
            <DocInlineCode>*</DocInlineCode> or omit the name for all events or all states.
          </DocNote>
          <DocNote title="Performance limits" variant="warning">
            Metric queries fail when more than 250 series match. Add <DocInlineCode>source</DocInlineCode> or{" "}
            <DocInlineCode>where</DocInlineCode> filters. Event and state limits are capped at 1000 rows.
          </DocNote>
        </div>
      </DocSection>
    </DocPage>
  );

  const renderDashboardDsl = () => (
    <DocPage class="mx-0 max-w-none">
      <DocSection title="Dashboard DSL" eyebrow="Layout">
        <div class="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <DocCode title="Shape" code={dashboardSyntax} copy />
          <DocCode title="Example" code={dashboardExample} copy />
        </div>
        <div class="mt-4">
          <h3 class="mb-2 text-sm font-semibold text-secondary">Statement reference</h3>
          <DataTable
            rows={dashboardStatementRows}
            columns={dashboardStatementColumns}
            getRowId={(row) => row.statement}
            class="paper max-h-[520px] overflow-auto"
            density="compact"
            renderCell={({ row, col, value }) => {
              if (col.id === "statement") return <code class="font-mono text-secondary">{row.statement}</code>;
              if (col.id === "copy") return copyCell(String(value));
              return <span class="text-dimmed">{String(value ?? "-")}</span>;
            }}
          />
        </div>
        <div class="mt-3 grid gap-3 text-sm lg:grid-cols-2">
          <DocNote title="Dashboards compose query output" variant="info">
            Dashboard DSL describes sections, cards, markdown, and visual widgets. The widget <DocInlineCode>query</DocInlineCode> line
            uses the same Query DSL documented below.
          </DocNote>
          <DocNote title="Use it for repeatable layouts" variant="tip">
            Prefer Dashboard DSL when a dashboard should be reviewed, copied, generated, or changed as text. It keeps layout intent and
            query intent close together.
          </DocNote>
          <DocNote title="Controls define variables" variant="info">
            Declare controls once with <DocInlineCode>controls</DocInlineCode>, then use variables such as <DocInlineCode>$range</DocInlineCode>{" "}
            or <DocInlineCode>$entity_id</DocInlineCode> inside widget queries. Pulse renders controls above the dashboard.
          </DocNote>
          <DocNote title="Public displays use defaults" variant="info">
            Public dashboard links render with each control's default value. Keep public dashboards deterministic by choosing useful defaults.
          </DocNote>
          <DocNote title="Conditions are visual" variant="warning">
            Use <DocInlineCode>warn when value &gt; 80</DocInlineCode> or <DocInlineCode>critical when value = false</DocInlineCode> to
            mark widgets visually. Alert delivery and webhooks are a separate future layer.
          </DocNote>
        </div>
      </DocSection>
    </DocPage>
  );

  const renderOverview = () => (
    <DocPage class="mx-0 max-w-none">
      <DocSection title="What this reference covers" eyebrow="Overview">
        <div class="grid gap-3 text-sm lg:grid-cols-3">
          <DocNote title="Query DSL" variant="info">
            Use Query DSL to fetch metrics, event rows, and current states. It is the language used by the explorer and by dashboard widgets.
          </DocNote>
          <Show when={props.includeDashboardDsl}>
            <DocNote title="Dashboard DSL" variant="tip">
              Use Dashboard DSL to describe sections, cards, markdown notes, and visual widgets as text.
            </DocNote>
          </Show>
          <DocNote title="Inventory" variant="info">
            Inventory is generated from this Pulse base. Filter by source or entity, then copy scoped snippets into the explorer or dashboard DSL.
          </DocNote>
        </div>
      </DocSection>
      <DocSection title="Common snippets" eyebrow="Copy and adapt">
        <div class="grid gap-3 lg:grid-cols-2">
          <DocCode title="Counter throughput" code="metric http_requests_total rate every 1m since 1h where route=/api" highlight={pulseQueryHighlight} format={formatPulseQuery} copy />
          <DocCode title="Orders per hour" code="metric orders.created increase every 1h since 7d where channel=web" highlight={pulseQueryHighlight} format={formatPulseQuery} copy />
          <DocCode title="Recent errors" code="events app.error since 24h where severity=critical limit 100" highlight={pulseQueryHighlight} format={formatPulseQuery} copy />
          <DocCode title="Fresh integration states" code="states integration.online since 10m where integration=webshop limit 200" highlight={pulseQueryHighlight} format={formatPulseQuery} copy />
        </div>
      </DocSection>
    </DocPage>
  );

  const renderInventory = () => (
    <>
      <section class="paper flex flex-col gap-4 p-4">
        <div>
          <h2 class="text-base font-semibold text-primary">Inventory</h2>
          <p class="text-sm text-dimmed">Filter the reference by source or entity. Copied snippets include the active scope where the Query DSL supports it.</p>
        </div>
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
