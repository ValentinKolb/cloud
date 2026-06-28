import {
  DocCode,
  DocConceptGrid,
  DocInlineCode,
  DocLead,
  DocNote,
  DocPage,
  DocRows,
  DocSection,
} from "@valentinkolb/cloud/ui";
import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { highlight } from "@valentinkolb/stdlib";
import { For, type JSX } from "solid-js";
import { AGGREGATIONS } from "../contracts";

type Example = {
  title: string;
  query: string;
  reason: string;
};

const pulseDocHighlight = highlight.compile(
  [
    { kind: "string", match: /"(?:\\[\s\S]|[^"\\])*"/ },
    { kind: "placeholder", match: /<[^>\n]+>|\[[^\]\n]+\]/ },
    { kind: "uuid", match: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i },
    { kind: "keyword", match: /\b(?:metric|events|states|every|since|source|entity|entity_type|limit|where)\b/i },
    { kind: "aggregation", match: new RegExp(`\\b(?:${AGGREGATIONS.join("|")})\\b`, "i") },
    { kind: "duration", match: /\b\d+(?:m|h|d)\b/i },
    { kind: "operator", match: /=|,/ },
    { kind: "path", match: /\/[^\s,]+/ },
    { kind: "identifier", match: /[A-Za-z_][A-Za-z0-9_.-]*/ },
  ],
  { classPrefix: "doc-token-" },
);

const formatPulseDocQuery = (query: string): string =>
  query
    .replace(/\s+(every|since|source|entity|entity_type|where|limit)\b/gi, "\n$1")
    .replace(/,\s*/g, ",\n  ");

const QuerySnippet = (props: { code: string }) => <DocCode code={props.code} highlight={pulseDocHighlight} format={formatPulseDocQuery} />;

const AggregationReference = () => (
  <DocRows
    items={[
      { title: "avg", text: "Average all matching samples in each bucket. Good for gauges such as utilization, temperature, output, or quality scores." },
      { title: "sum", text: "Add all matching samples. Use it for totals where combined volume matters." },
      { title: "min", text: "Smallest sample in the bucket. Useful for lower bounds and dips." },
      { title: "max", text: "Largest sample in the bucket. Useful for peaks and capacity checks." },
      { title: "count", text: "Number of samples in the bucket, not the sum of values." },
      { title: "latest", text: "Latest value per series in each bucket, averaged when multiple series match." },
      { title: "rate", text: "Counter change per second inside each bucket. Resets are clamped to zero." },
      { title: "increase", text: "Counter increase inside each bucket. Use this for requests, bytes, sales, or visitors counted over time." },
      { title: "p50", text: "Median sample value. Useful when typical latency matters." },
      { title: "p90", text: "90th percentile. Shows high-but-common values without chasing the single worst sample." },
      { title: "p95", text: "95th percentile. A common latency and load threshold for user-visible performance." },
      { title: "p99", text: "99th percentile. Use when rare slow or high values are operationally important." },
    ]}
  />
);

const ExampleList = (props: { items: Example[] }) => (
  <div class="space-y-4">
    <For each={props.items}>
      {(item) => (
        <article class="space-y-2">
          <p class="font-semibold text-primary">{item.title}</p>
          <QuerySnippet code={item.query} />
          <p>{item.reason}</p>
        </article>
      )}
    </For>
  </div>
);

const StartTab = () => (
  <DocPage>
    <DocLead>
      Pulse collects telemetry into one base, keeps it queryable, and turns it into live dashboards. It works for product metrics,
      business events, web analytics, infrastructure signals, energy data, and automation state.
    </DocLead>

    <DocSection title="Mental model" eyebrow="Start here">
      <DocConceptGrid
        items={[
          {
            title: "Base",
            icon: "ti-database",
            text: "One monitoring workspace with its own access, retention, sources, dashboards, and saved queries.",
          },
          {
            title: "Source",
            icon: "ti-database-share",
            text: "Where data enters Pulse: a scraped metrics endpoint, a token-backed HTTP push source, or an internal app integration.",
          },
          {
            title: "Metric",
            icon: "ti-chart-dots",
            text: "Numeric time-series data for charts, aggregation, comparison, dashboard widgets, and alerts later.",
          },
          {
            title: "Event",
            icon: "ti-bolt",
            text: "A point-in-time fact such as a deploy, error, checkout, signup, or automation action.",
          },
          {
            title: "State",
            icon: "ti-toggle-right",
            text: "The latest known value for an entity, such as current status, inventory level, or battery mode.",
          },
          {
            title: "Dashboard",
            icon: "ti-layout-dashboard",
            text: "A saved Dashboard DSL document. Public dashboards expose only the data used by that DSL through a UUID URL.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="First useful path">
      <ol class="space-y-2">
        <For
          each={[
            "Create a base for one system or one reporting area.",
            "Add one source and wait until it publishes data.",
            "Open Sources to verify scrape or ingest health.",
            "Create a dashboard and open its DSL editor.",
            "Use the editor inventory to insert metrics, states, events, sources, resources, or saved queries as DSL snippets.",
          ]}
        >
          {(step, index) => (
            <li class="grid grid-cols-[1.75rem_1fr] gap-3">
              <span class="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">{index() + 1}</span>
              <span>{step}</span>
            </li>
          )}
        </For>
      </ol>
    </DocSection>

    <DocNote title="Naming rule">
      Metric names describe the measured fact, for example <DocInlineCode>orders.created</DocInlineCode> or{" "}
      <DocInlineCode>system.cpu.usage</DocInlineCode>. Dimensions describe the series, for example channel, product, route, tenant, host,
      device, or region. This keeps queries fast and dashboards readable.
    </DocNote>
  </DocPage>
);

const FeaturesTab = () => (
  <DocPage>
    <DocLead>
      Pulse keeps the feature surface small: collect data, inspect what arrived, query it, then publish it through live dashboards. The
      same primitives work for infrastructure data and for future app-specific telemetry.
    </DocLead>

    <DocSection title="Core surfaces">
      <DocRows
        items={[
          {
            title: "Sources",
            icon: "ti-database-share",
            text: "Show how data arrives and whether recent attempts worked. Metrics endpoints include scrape status, duration, errors, and ingested counts.",
          },
          {
            title: "Metrics endpoint",
            icon: "ti-plug",
            text: (
              <>
                Scrapes a standard <DocInlineCode>/metrics</DocInlineCode> endpoint. Optional bearer tokens are stored encrypted.
              </>
            ),
          },
          {
            title: "HTTP ingest",
            icon: "ti-webhook",
            text: (
              <>
                Accepts batches with <DocInlineCode>metrics</DocInlineCode>, <DocInlineCode>events</DocInlineCode>, and{" "}
                <DocInlineCode>states</DocInlineCode> from other apps.
              </>
            ),
          },
          {
            title: "Signals",
            icon: "ti-list-search",
            text: "Search events, states, and metrics by name. Filter metrics by type when you know whether the value is a gauge, counter, histogram, or summary.",
          },
          {
            title: "Query explorer",
            icon: "ti-terminal-2",
            text: "Runs Pulse queries for metrics, events, and states. Metric queries can render as charts or tables; events and states start as tables and compiled query output.",
          },
          {
            title: "Realtime",
            icon: "ti-refresh",
            text: "Workspace data and public dashboards refresh live. Public dashboards receive only data referenced by the dashboard DSL.",
          },
          {
            title: "Retention",
            icon: "ti-recycle",
            text: "Raw telemetry is kept according to base settings. Rollups and downsampling keep longer ranges usable while old raw rows are collected.",
          },
          {
            title: "Access",
            icon: "ti-lock",
            text: "Base permissions control who can view, edit, or administer a Pulse base. Public dashboards are separate link-based read views.",
          },
          {
            title: "Saved queries",
            icon: "ti-bookmark",
            text: "Name investigations you run repeatedly. Save first, then turn stable queries into dashboard DSL widgets.",
          },
        ]}
      />
    </DocSection>
  </DocPage>
);

const QueryTab = () => (
  <DocPage>
    <DocLead>
      Pulse queries support three statement types: <DocInlineCode>metric</DocInlineCode> for metric time series,{" "}
      <DocInlineCode>events</DocInlineCode> for event rows, and <DocInlineCode>states</DocInlineCode> for current state values. The same
      filters work across the model so queries can become dashboard widgets later.
    </DocLead>

    <DocSection title="Full syntax" eyebrow="Reference">
      <QuerySnippet code={"metric <metric> <aggregation> [every <duration>] [since <duration>] [source <uuid>] [where <key>=<value>[, <key>=<value>...]]"} />
      <QuerySnippet code={"events [<kind>|*] [since <duration>] [source <uuid>] [entity <id>] [entity_type <type>] [where <key>=<value>[, ...]] [limit <rows>]"} />
      <QuerySnippet code={"states [<key>|*] [since <duration>] [source <uuid>] [entity <id>] [entity_type <type>] [where <key>=<value>[, ...]] [limit <rows>]"} />
      <div class="mt-3 grid gap-2 text-sm">
        <p>
          <DocInlineCode>every</DocInlineCode> defaults to <DocInlineCode>5m</DocInlineCode>.{" "}
          <DocInlineCode>since</DocInlineCode> defaults to <DocInlineCode>24h</DocInlineCode> for metrics and events. States omit{" "}
          <DocInlineCode>since</DocInlineCode> by default because they already represent current values.
        </p>
        <p>
          Durations use compact units: <DocInlineCode>m</DocInlineCode> minutes, <DocInlineCode>h</DocInlineCode> hours, and{" "}
          <DocInlineCode>d</DocInlineCode> days. Quote values that contain spaces, commas, or equals signs.
        </p>
      </div>
    </DocSection>

    <DocSection title="How series are matched">
      <p>
        Pulse first finds all series with the metric name, then applies <DocInlineCode>source</DocInlineCode> and{" "}
        <DocInlineCode>where</DocInlineCode> filters. If more than 250 series match, the query fails so dashboards stay fast; add a source
        or dimension filter.
      </p>
    </DocSection>

    <DocSection title="Aggregations">
      <p>
        Choose the aggregation from the data type: gauges usually use averages or latest values; counters usually use rate or increase;
        latency distributions often use percentiles.
      </p>
      <AggregationReference />
    </DocSection>

    <DocSection title="Examples" eyebrow="Copy and adapt">
      <ExampleList
        items={[
          {
            title: "Orders per hour",
            query: "metric orders.created increase every 1h since 7d where channel=web",
            reason: "Increase turns a cumulative counter into per-bucket business volume.",
          },
          {
            title: "Latest battery charge for one device",
            query: 'metric battery.charge_percent latest every 5m since 24h where device="garage-battery"',
            reason: "Latest shows the current gauge value instead of a trend average.",
          },
          {
            title: "Request rate from a counter",
            query: "metric http_requests_total rate every 1m since 1h source 00000000-0000-4000-8000-000000000000",
            reason: "Counters grow over time. Rate converts that counter into per-second throughput and clamps resets.",
          },
          {
            title: "Solar output trend",
            query: "metric solar.output_watts avg every 15m since 7d where inverter=main",
            reason: "Averages make noisy power samples readable while keeping the value in watts.",
          },
          {
            title: "95th percentile latency",
            query: "metric http_request_duration_seconds p95 every 5m since 24h where route=/checkout, method=POST",
            reason: "p95 focuses on slow user-visible requests without letting one outlier dominate the chart.",
          },
          {
            title: "Long-range capacity trend",
            query: "metric system.disk.root.used_percent max every 1h since 30d",
            reason: "Max preserves peaks inside each hour and is a better capacity signal than average disk usage.",
          },
          {
            title: "Recent deploy events",
            query: "events deploy.finished since 7d where env=prod limit 100",
            reason: "Events return rows instead of buckets, which is better for audit trails, deploy history, incidents, and funnels later.",
          },
          {
            title: "Current integration states",
            query: 'states integration.enabled entity "webshop" limit 50',
            reason: "States answer what is true now. Add since only when you want to hide stale current values.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Why the language is explicit">
      The query runner compiles to SQL and rejects shapes that would be slow or ambiguous. Explicit metric, aggregation, bucket, range,
      source, and dimensions make queries easier to save, share, render, and run in production.
    </DocNote>
  </DocPage>
);

export default function PulseLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="pulse-start"
        title="Start: Pulse"
        icon="ti ti-activity-heartbeat"
        description="Core concepts, naming, and the first monitoring path."
        order={100}
      >
        <StartTab />
      </Layout.Help>
      <Layout.Help
        id="pulse-features"
        title="Pulse features"
        icon="ti ti-apps"
        description="Sources, signals, dashboards, realtime, access, and retention."
        order={110}
      >
        <FeaturesTab />
      </Layout.Help>
      <Layout.Help
        id="pulse-query-language"
        title="Query language"
        icon="ti ti-terminal-2"
        description="Full metric syntax, aggregations, filters, and examples."
        order={120}
      >
        <QueryTab />
      </Layout.Help>
    </>
  );
}
