import { fuzzy } from "@valentinkolb/stdlib";
import { CopyButton, DataTable, DocCode, DocInlineCode, DocNote, DocPage, DocSection, TextInput, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { createMemo, createSignal } from "solid-js";
import type { PulseCurrentState, PulseMetricSummary, PulseRecordedEvent } from "../contracts";
import { pulseQueryHighlight } from "./query-authoring";

type Props = {
  baseName: string;
  metrics: PulseMetricSummary[];
  events: PulseRecordedEvent[];
  states: PulseCurrentState[];
};

type MetricRow = PulseMetricSummary & { search: string };
type EventKindRow = { kind: string; count: number; lastSeenAt: string; search: string };
type StateKeyRow = { key: string; count: number; lastSeenAt: string; search: string };
type SyntaxRow = { clause: string; appliesTo: string; meaning: string; example: string };
type AggregationRow = { name: string; meaning: string; bestFor: string; example: string };

const formatPulseQuery = (query: string): string =>
  query
    .replace(/\s+(every|since|source|entity|entity_type|where|limit)\b/gi, "\n$1")
    .replace(/,\s*/g, ",\n  ");

const copyCell = (value: string) => <CopyButton text={value} class="icon-btn h-8 w-8 text-dimmed hover:text-primary" />;

const metricSyntax = `metric <metric> <aggregation>
  [every <duration>]
  [since <duration>]
  [source <uuid>]
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

const syntaxRows: SyntaxRow[] = [
  { clause: "metric <metric> <aggregation>", appliesTo: "metric", meaning: "Select one numeric metric and define how samples are reduced.", example: "metric orders.created increase" },
  { clause: "events [<kind>|*]", appliesTo: "events", meaning: "Return event rows by kind. Omit the kind or use * for all events.", example: "events deploy.finished" },
  { clause: "states [<key>|*]", appliesTo: "states", meaning: "Return current state rows by key. Omit the key or use * for all states.", example: "states host.online" },
  { clause: "every <duration>", appliesTo: "metric", meaning: "Bucket metric samples into fixed time windows. Defaults to 5m.", example: "every 15m" },
  { clause: "since <duration>", appliesTo: "metric, events, states", meaning: "Limit by time. Metric/events default to 24h. States only filter stale current values when provided.", example: "since 7d" },
  { clause: "source <uuid>", appliesTo: "all", meaning: "Restrict results to one source.", example: "source 00000000-0000-4000-8000-000000000000" },
  { clause: "entity <id>", appliesTo: "events, states", meaning: "Restrict rows to one entity identifier such as a customer, order, device, service, or host.", example: "entity order-1001" },
  { clause: "entity_type <type>", appliesTo: "events, states", meaning: "Restrict rows to one entity type.", example: "entity_type order" },
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

export default function PulseQueryReferenceWindow(props: Props) {
  const [query, setQuery] = createSignal("");

  const metricRows = createMemo<MetricRow[]>(() => {
    const rows = props.metrics.map((metric) => ({
      ...metric,
      search: `${metric.name} ${metric.type} ${metric.unit ?? ""}`,
    }));
    const q = query().trim();
    return q ? fuzzy.filter(q, rows, { key: (row) => row.search, limit: 120 }).map((hit) => hit.item) : rows;
  });

  const eventRows = createMemo<EventKindRow[]>(() => {
    const byKind = new Map<string, EventKindRow>();
    for (const event of props.events) {
      const current = byKind.get(event.kind);
      if (!current) {
        byKind.set(event.kind, { kind: event.kind, count: 1, lastSeenAt: event.ts, search: `${event.kind} ${Object.keys(event.dimensions).join(" ")}` });
      } else {
        current.count += 1;
        if (new Date(event.ts).getTime() > new Date(current.lastSeenAt).getTime()) current.lastSeenAt = event.ts;
        current.search += ` ${Object.keys(event.dimensions).join(" ")}`;
      }
    }
    const rows = [...byKind.values()].sort((left, right) => left.kind.localeCompare(right.kind));
    const q = query().trim();
    return q ? fuzzy.filter(q, rows, { key: (row) => row.search, limit: 120 }).map((hit) => hit.item) : rows;
  });

  const stateRows = createMemo<StateKeyRow[]>(() => {
    const byKey = new Map<string, StateKeyRow>();
    for (const state of props.states) {
      const current = byKey.get(state.key);
      if (!current) {
        byKey.set(state.key, { key: state.key, count: 1, lastSeenAt: state.updatedAt, search: `${state.key} ${Object.keys(state.dimensions).join(" ")}` });
      } else {
        current.count += 1;
        if (new Date(state.updatedAt).getTime() > new Date(current.lastSeenAt).getTime()) current.lastSeenAt = state.updatedAt;
        current.search += ` ${Object.keys(state.dimensions).join(" ")}`;
      }
    }
    const rows = [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
    const q = query().trim();
    return q ? fuzzy.filter(q, rows, { key: (row) => row.search, limit: 120 }).map((hit) => hit.item) : rows;
  });

  const metricColumns: DataTableColumn<MetricRow>[] = [
    { id: "name", header: "Metric", value: "name" },
    { id: "type", header: "Type", value: "type", headerClass: "w-28", cellClass: "w-28 whitespace-nowrap" },
    { id: "series", header: "Series", value: "seriesCount", headerClass: "w-24", cellClass: "w-24 whitespace-nowrap" },
    { id: "copy", header: "", value: (row) => `metric ${row.name} ${row.type === "counter" ? "rate" : "avg"} every 5m since 24h`, headerClass: "w-12", cellClass: "w-12" },
  ];
  const eventColumns: DataTableColumn<EventKindRow>[] = [
    { id: "kind", header: "Event", value: "kind" },
    { id: "count", header: "Recent", value: "count", headerClass: "w-24", cellClass: "w-24 whitespace-nowrap" },
    { id: "copy", header: "", value: (row) => `events ${row.kind} since 7d limit 100`, headerClass: "w-12", cellClass: "w-12" },
  ];
  const stateColumns: DataTableColumn<StateKeyRow>[] = [
    { id: "key", header: "State", value: "key" },
    { id: "count", header: "Entities", value: "count", headerClass: "w-24", cellClass: "w-24 whitespace-nowrap" },
    { id: "copy", header: "", value: (row) => `states ${row.key} limit 100`, headerClass: "w-12", cellClass: "w-12" },
  ];

  return (
    <main class="h-screen overflow-auto bg-zinc-50 p-4 dark:bg-zinc-950 md:p-6">
      <div class="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-5">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 class="text-2xl font-semibold tracking-normal">Pulse query reference</h1>
            <p class="text-sm text-dimmed">{props.baseName}</p>
          </div>
          <div class="w-full max-w-md">
            <TextInput value={query} onInput={setQuery} icon="ti ti-search" placeholder="Search metrics, events, states..." clearable />
          </div>
        </header>

        <DocPage class="mx-0 max-w-none">
          <DocSection title="Statement types" eyebrow="Syntax">
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

          <DocSection title="More examples" eyebrow="Copy and adapt">
            <div class="grid gap-3 lg:grid-cols-2">
              <DocCode title="Counter throughput" code="metric http_requests_total rate every 1m since 1h where route=/api" highlight={pulseQueryHighlight} format={formatPulseQuery} copy />
              <DocCode title="Orders per hour" code="metric orders.created increase every 1h since 7d where channel=web" highlight={pulseQueryHighlight} format={formatPulseQuery} copy />
              <DocCode title="Recent errors" code="events app.error since 24h where severity=critical limit 100" highlight={pulseQueryHighlight} format={formatPulseQuery} copy />
              <DocCode title="Deploy history" code="events deploy.finished since 30d entity service-api limit 200" highlight={pulseQueryHighlight} format={formatPulseQuery} copy />
              <DocCode title="All current order states" code="states * entity order-1001 limit 100" highlight={pulseQueryHighlight} format={formatPulseQuery} copy />
              <DocCode title="Fresh integration states" code="states integration.online since 10m where integration=webshop limit 200" highlight={pulseQueryHighlight} format={formatPulseQuery} copy />
            </div>
          </DocSection>
        </DocPage>

        <div class="grid min-h-96 grid-cols-1 gap-4 xl:grid-cols-3">
          <section class="flex min-h-0 flex-col gap-2">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-secondary">
              <i class="ti ti-chart-dots" /> Metrics <span class="text-dimmed">{metricRows().length}</span>
            </h2>
            <DataTable
              rows={metricRows()}
              columns={metricColumns}
              getRowId={(row) => row.name}
              class="paper min-h-0 flex-1 overflow-auto"
              empty="No matching metrics"
              renderCell={({ row, col, value }) => {
                if (col.id === "name") return <code class="font-mono text-secondary">{row.name}</code>;
                if (col.id === "copy") return copyCell(String(value));
                return <span class="text-dimmed">{String(value ?? "-")}</span>;
              }}
            />
          </section>

          <section class="flex min-h-0 flex-col gap-2">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-secondary">
              <i class="ti ti-bolt" /> Events <span class="text-dimmed">{eventRows().length}</span>
            </h2>
            <DataTable
              rows={eventRows()}
              columns={eventColumns}
              getRowId={(row) => row.kind}
              class="paper min-h-0 flex-1 overflow-auto"
              empty="No matching events"
              renderCell={({ row, col, value }) => {
                if (col.id === "kind") return <code class="font-mono text-secondary">{row.kind}</code>;
                if (col.id === "copy") return copyCell(String(value));
                return <span class="text-dimmed">{String(value ?? "-")}</span>;
              }}
            />
          </section>

          <section class="flex min-h-0 flex-col gap-2">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-secondary">
              <i class="ti ti-toggle-right" /> States <span class="text-dimmed">{stateRows().length}</span>
            </h2>
            <DataTable
              rows={stateRows()}
              columns={stateColumns}
              getRowId={(row) => row.key}
              class="paper min-h-0 flex-1 overflow-auto"
              empty="No matching states"
              renderCell={({ row, col, value }) => {
                if (col.id === "key") return <code class="font-mono text-secondary">{row.key}</code>;
                if (col.id === "copy") return copyCell(String(value));
                return <span class="text-dimmed">{String(value ?? "-")}</span>;
              }}
            />
          </section>
        </div>
      </div>
    </main>
  );
}
