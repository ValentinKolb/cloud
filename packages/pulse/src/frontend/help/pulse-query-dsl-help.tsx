import { DataTable, type DataTableColumn, DocCode, DocInlineCode, DocLead, DocNote, DocRows, DocSection } from "@valentinkolb/cloud/ui";
import { pulseQueryHighlight } from "../query-authoring";
import { PulseCopyCell, PulseDocPage, PulseExampleList, PulseStepList } from "./pulse-help-primitives";

type SyntaxRow = {
  clause: string;
  appliesTo: string;
  meaning: string;
  example: string;
};

type AggregationRow = {
  name: string;
  meaning: string;
  bestFor: string;
  example: string;
};

const metricSyntax = `metric <metric> <aggregation>
  [every <duration>]
  [since <duration>]
  [source <uuid>]
  [entity <id>]
  [entity_type <type>]
  [where <key>=<value>, ...]`;

const eventsSyntax = `events [<kind>|*]
  [count|sum|unique actor|unique session]
  [every <duration>]
  [group by <dimension>, ...]
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
  {
    clause: "metric <metric> <aggregation>",
    appliesTo: "metric",
    meaning: "Select one numeric signal and define how samples are reduced. Metrics default to every 5m since 24h.",
    example: "metric orders.created increase",
  },
  {
    clause: "events [<kind>|*]",
    appliesTo: "events",
    meaning: "Return event rows by kind. Omit the kind or use * for all events. Events default to since 24h limit 500.",
    example: "events deploy.finished",
  },
  {
    clause: "count | sum | unique actor | unique session",
    appliesTo: "events",
    meaning: "Aggregate matched events in SQL and return time-series points instead of raw rows.",
    example: "events page.viewed unique actor every 1d since 30d",
  },
  {
    clause: "group by <dimension>, ...",
    appliesTo: "aggregated events",
    meaning: "Split an event aggregation by one to four dimension keys. Other event field roles cannot be grouped.",
    example: "group by campaign, country",
  },
  {
    clause: "states [<key>|*]",
    appliesTo: "states",
    meaning:
      "Return current state rows by key. Omit the key or use * for all states. States default to limit 500 with no stale-time filter.",
    example: "states host.online",
  },
  {
    clause: "every <duration>",
    appliesTo: "metric, aggregated events",
    meaning: "Bucket metric samples or aggregated events into fixed time windows. Use compact durations such as 5m, 1h, or 7d.",
    example: "every 15m",
  },
  {
    clause: "since <duration>",
    appliesTo: "metric, events, states",
    meaning: "Limit by time. Durations use m, h, or d and may not exceed 90 days. For states, since hides stale current values.",
    example: "since 7d",
  },
  {
    clause: "source <uuid>",
    appliesTo: "all",
    meaning: "Restrict results to one source. The value must be a valid source UUID copied from Pulse.",
    example: "source 00000000-0000-4000-8000-000000000000",
  },
  {
    clause: "entity <id>",
    appliesTo: "all",
    meaning: "Restrict results to one resource identifier. The UI calls this a resource; Query DSL calls it an entity.",
    example: "entity container:app-core",
  },
  {
    clause: "entity_type <type>",
    appliesTo: "all",
    meaning: "Restrict results to one resource class such as host, container, service, device, order, or customer.",
    example: "entity_type container",
  },
  {
    clause: "where <key>=<value>",
    appliesTo: "all",
    meaning: "Filter dimensions by exact equality. Separate multiple filters with commas.",
    example: "where env=prod, region=eu",
  },
  {
    clause: "limit <rows>",
    appliesTo: "events, states",
    meaning: "Limit returned rows. Use a positive integer no larger than 1000.",
    example: "limit 100",
  },
];

const aggregationRows: AggregationRow[] = [
  {
    name: "avg",
    meaning: "Average samples in each bucket.",
    bestFor: "Gauges such as utilization, temperature, output, or quality scores.",
    example: "metric solar.output_watts avg every 15m since 7d",
  },
  {
    name: "latest",
    meaning: "Latest value per series in each bucket.",
    bestFor: "Current gauges and status numbers.",
    example: "metric battery.charge_percent latest every 5m since 24h",
  },
  {
    name: "min / max",
    meaning: "Smallest or largest sample in each bucket.",
    bestFor: "Dips, peaks, and capacity checks.",
    example: "metric inventory.stock_level max every 1h since 30d",
  },
  {
    name: "sum",
    meaning: "Add samples in each bucket.",
    bestFor: "Combined totals across series.",
    example: "metric solar.output_watts sum every 5m since 24h",
  },
  {
    name: "count",
    meaning: "Count samples, not their values.",
    bestFor: "Sample presence and collection checks.",
    example: "metric website.visitors count every 1h since 7d",
  },
  {
    name: "rate",
    meaning: "Counter change per second, with resets clamped.",
    bestFor: "Requests/sec, bytes/sec, and throughput.",
    example: "metric http_requests_total rate every 1m since 1h",
  },
  {
    name: "increase",
    meaning: "Counter increase inside each bucket.",
    bestFor: "Orders, visitors, requests, or bytes per bucket.",
    example: "metric sales.orders increase every 1h since 7d",
  },
  {
    name: "p50 / p90 / p95 / p99",
    meaning: "Percentiles over samples in each bucket.",
    bestFor: "Latency and distribution metrics.",
    example: "metric http_request_duration_seconds p95 every 5m since 24h",
  },
  {
    name: "events count / sum",
    meaning: "Count events or sum their numeric value in each bucket.",
    bestFor: "Visits, orders, errors, revenue, and other point-in-time facts.",
    example: "events order.created sum every 1h since 7d group by currency",
  },
  {
    name: "events unique actor / session",
    meaning: "Count distinct first-class actorId or sessionId values in each bucket.",
    bestFor: "Visitors, active users, sessions, and engagement without high-cardinality dimensions.",
    example: "events page.viewed unique actor every 1d since 30d",
  },
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

export const PulseQueryDslHelpPage = () => (
  <PulseDocPage>
    <DocLead>
      Query DSL answers one data question at a time. Pick whether you need a metric series, raw or aggregated events, or current states,
      then narrow the query with source, resource, and dimension filters.
    </DocLead>

    <DocSection title="Pick the statement by question" eyebrow="Query DSL">
      <DocRows
        items={[
          {
            title: "How did a number change?",
            icon: "ti-chart-line",
            text: (
              <>
                Use <DocInlineCode>metric</DocInlineCode>. Add an aggregation such as <DocInlineCode>avg</DocInlineCode>,{" "}
                <DocInlineCode>latest</DocInlineCode>, <DocInlineCode>rate</DocInlineCode>, or <DocInlineCode>increase</DocInlineCode>.
              </>
            ),
          },
          {
            title: "What happened recently?",
            icon: "ti-bolt",
            text: (
              <>
                Use <DocInlineCode>events</DocInlineCode>. Return raw rows for inspection, or count, sum, and count unique actors or
                sessions in SQL.
              </>
            ),
          },
          {
            title: "What is true now?",
            icon: "ti-toggle-right",
            text: (
              <>
                Use <DocInlineCode>states</DocInlineCode>. States return the latest known value for facts such as online status, version,
                configuration, inventory, or current health.
              </>
            ),
          },
        ]}
      />
    </DocSection>

    <DocSection title="Build a query in four steps">
      <PulseStepList
        items={[
          { title: "Name the signal", text: "Choose the metric, event kind, or state key from the UI or Inventory." },
          {
            title: "Choose the shape",
            text: "Metrics need an aggregation. Events can return rows or use count, sum, or unique aggregation.",
          },
          { title: "Set the time range", text: "Use since for the range, and every for metric or aggregated-event buckets." },
          {
            title: "Narrow the scope",
            text: "Add source, entity, entity_type, or where filters when the result includes too many variants or rows.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Statement types" eyebrow="Query DSL">
      <div class="grid gap-3 lg:grid-cols-3">
        <DocCode
          title="Metric"
          code={metricSyntax}
          highlight={pulseQueryHighlight}
          copyText="metric <metric> <aggregation> [every <duration>] [since <duration>] [source <uuid>] [entity <id>] [entity_type <type>] [where <key>=<value>, ...]"
          copy
        />
        <DocCode
          title="Events"
          code={eventsSyntax}
          highlight={pulseQueryHighlight}
          copyText="events [<kind>|*] [count|sum|unique actor|unique session] [every <duration>] [group by <dimension>, ...] [since <duration>] [source <uuid>] [entity <id>] [entity_type <type>] [where <key>=<value>, ...] [limit <rows>]"
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

    <DocSection title="Examples" eyebrow="Copy and adapt">
      <PulseExampleList
        items={[
          {
            title: "Current value for one device",
            query: 'metric battery.charge_percent latest every 5m since 24h where device="garage-battery"',
            reason: "Use latest when the newest gauge value matters more than the average trend.",
          },
          {
            title: "Trend over time",
            query: "metric solar.output_watts avg every 15m since 7d where inverter=main",
            reason: "Use avg to smooth noisy gauge samples without changing the unit.",
          },
          {
            title: "Throughput from a counter",
            query: "metric http_requests_total rate every 1m since 1h where route=/api",
            reason: "Use rate when a counter keeps growing and you want per-second throughput.",
          },
          {
            title: "Business volume per bucket",
            query: "metric orders.created increase every 1h since 7d where channel=web",
            reason: "Use increase when the question is how many new things happened inside each bucket.",
          },
          {
            title: "Recent events",
            query: "events deploy.finished since 7d where env=prod limit 100",
            reason: "Use raw events for rows you want to inspect or audit.",
          },
          {
            title: "Daily unique visitors",
            query: "events page.viewed unique actor every 1d since 30d where channel=web",
            reason: "Use first-class actor identities for unique counts instead of creating one dimension value per visitor.",
          },
          {
            title: "Current states",
            query: 'states integration.enabled entity "webshop" limit 50',
            reason: "Use states for current truth. Add since only when stale values should disappear.",
          },
        ]}
      />
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
          if (col.id === "copy") return PulseCopyCell(String(value));
          return <span class="text-dimmed">{String(value)}</span>;
        }}
      />
    </DocSection>

    <DocSection title="Aggregations">
      <p>
        Choose aggregation from the shape of the data, not from the chart you want. Gauges describe a value at a time, counters only grow,
        and latency distributions need percentiles.
      </p>
      <DataTable
        rows={aggregationRows}
        columns={aggregationColumns}
        getRowId={(row) => row.name}
        class="paper overflow-auto"
        density="compact"
        renderCell={({ row, col, value }) => {
          if (col.id === "name") return <code class="font-mono text-secondary">{row.name}</code>;
          if (col.id === "copy") return PulseCopyCell(String(value));
          return <span class="text-dimmed">{String(value)}</span>;
        }}
      />
    </DocSection>

    <DocSection title="Rules that matter">
      <div class="grid gap-3 text-sm lg:grid-cols-2">
        <DocNote title="Metrics aggregate samples" variant="info">
          <DocInlineCode>metric</DocInlineCode> requires a metric and aggregation. Use <DocInlineCode>every</DocInlineCode> to choose
          buckets and <DocInlineCode>since</DocInlineCode> to define the time range.
        </DocNote>
        <DocNote title="Events return rows or points" variant="tip">
          <DocInlineCode>events</DocInlineCode> starts as table output. Add <DocInlineCode>count</DocInlineCode>,{" "}
          <DocInlineCode>sum</DocInlineCode>, <DocInlineCode>unique actor</DocInlineCode>, or <DocInlineCode>unique session</DocInlineCode>{" "}
          for SQL time-series aggregation. <DocInlineCode>states</DocInlineCode> returns current rows. Use{" "}
          <DocInlineCode>source</DocInlineCode>, <DocInlineCode>entity</DocInlineCode>, <DocInlineCode>entity_type</DocInlineCode>,{" "}
          <DocInlineCode>where</DocInlineCode>, and <DocInlineCode>limit</DocInlineCode> to narrow them.
        </DocNote>
        <DocNote title="Names and values" variant="info">
          Use quotes when a metric, event, state, entity, or dimension value contains spaces, commas, or equals signs. Use{" "}
          <DocInlineCode>*</DocInlineCode> or omit the name for all events or all states.
        </DocNote>
        <DocNote title="Performance limits" variant="warning">
          Metric queries fail when more than 250 series match. Add <DocInlineCode>source</DocInlineCode>,{" "}
          <DocInlineCode>entity</DocInlineCode>, or <DocInlineCode>where</DocInlineCode> filters. Raw event and state limits are capped at
          1000 rows; event aggregations accept at most four group keys and return at most 1000 points.
        </DocNote>
      </div>
    </DocSection>
  </PulseDocPage>
);
