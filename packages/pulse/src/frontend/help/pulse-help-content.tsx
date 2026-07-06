import {
  CopyButton,
  DataTable,
  DocCode,
  DocConceptGrid,
  DocInlineCode,
  DocLead,
  DocNote,
  DocPage,
  DocRows,
  DocSection,
  type DataTableColumn,
} from "@valentinkolb/cloud/ui";
import { For, Show, type JSX } from "solid-js";
import { pulseQueryHighlight } from "../query-authoring";

export type PulseStep = {
  title: string;
  text: string;
};

type Example = {
  title: string;
  query: string;
  reason: string;
};

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

type DashboardStatementRow = {
  statement: string;
  scope: string;
  meaning: string;
  example: string;
};

export const PulseDocPage = (props: { children: JSX.Element }) => <DocPage class="!mx-0 !max-w-none w-full">{props.children}</DocPage>;

export const formatPulseDocQuery = (query: string): string =>
  query
    .replace(/\s+(every|since|source|entity|entity_type|where|limit)\b/gi, "\n$1")
    .replace(/,\s*/g, ",\n  ");

export const PulseQuerySnippet = (props: { code: string; title?: string; copyText?: string }) => (
  <DocCode title={props.title} code={props.code} copyText={props.copyText} highlight={pulseQueryHighlight} format={formatPulseDocQuery} copy />
);

const copyCell = (value: string) => <CopyButton text={value} class="icon-btn h-8 w-8 text-dimmed hover:text-primary" />;

const StepList = (props: { items: PulseStep[] }) => (
  <ol class="space-y-3">
    <For each={props.items}>
      {(item, index) => (
        <li class="grid grid-cols-[1.75rem_1fr] gap-3">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
            {index() + 1}
          </span>
          <span>
            <span class="font-semibold text-primary">{item.title}</span>
            <span class="mt-0.5 block text-dimmed">{item.text}</span>
          </span>
        </li>
      )}
    </For>
  </ol>
);

const ExampleList = (props: { items: Example[] }) => (
  <div class="space-y-4">
    <For each={props.items}>
      {(item) => (
        <article class="space-y-2">
          <p class="font-semibold text-primary">{item.title}</p>
          <PulseQuerySnippet code={item.query} />
          <p class="text-dimmed">{item.reason}</p>
        </article>
      )}
    </For>
  </div>
);

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
    row height md {
      line "Chart title" {
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
  { clause: "metric <metric> <aggregation>", appliesTo: "metric", meaning: "Select one numeric signal and define how samples are reduced.", example: "metric orders.created increase" },
  { clause: "events [<kind>|*]", appliesTo: "events", meaning: "Return event rows by kind. Omit the kind or use * for all events.", example: "events deploy.finished" },
  { clause: "states [<key>|*]", appliesTo: "states", meaning: "Return current state rows by key. Omit the key or use * for all states.", example: "states host.online" },
  { clause: "every <duration>", appliesTo: "metric", meaning: "Bucket metric samples into fixed time windows. Defaults to 5m.", example: "every 15m" },
  { clause: "since <duration>", appliesTo: "metric, events, states", meaning: "Limit by time. Metric and event queries default to 24h. States only filter stale current values when provided.", example: "since 7d" },
  { clause: "source <uuid>", appliesTo: "all", meaning: "Restrict results to one source.", example: "source 00000000-0000-4000-8000-000000000000" },
  { clause: "entity <id>", appliesTo: "all", meaning: "Restrict results to one entity or resource identifier.", example: "entity container:app-core" },
  { clause: "entity_type <type>", appliesTo: "all", meaning: "Restrict results to one entity type such as host, container, service, device, order, or customer.", example: "entity_type container" },
  { clause: "where <key>=<value>", appliesTo: "all", meaning: "Filter dimensions. Separate multiple filters with commas.", example: "where env=prod, region=eu" },
  { clause: "limit <rows>", appliesTo: "events, states", meaning: "Limit returned rows. Values above 1000 are clamped.", example: "limit 100" },
];

const aggregationRows: AggregationRow[] = [
  { name: "avg", meaning: "Average samples in each bucket.", bestFor: "Gauges such as utilization, temperature, output, or quality scores.", example: "metric solar.output_watts avg every 15m since 7d" },
  { name: "latest", meaning: "Latest value per series in each bucket.", bestFor: "Current gauges and status numbers.", example: "metric battery.charge_percent latest every 5m since 24h" },
  { name: "min / max", meaning: "Smallest or largest sample in each bucket.", bestFor: "Dips, peaks, and capacity checks.", example: "metric inventory.stock_level max every 1h since 30d" },
  { name: "sum", meaning: "Add samples in each bucket.", bestFor: "Combined totals across series.", example: "metric solar.output_watts sum every 5m since 24h" },
  { name: "count", meaning: "Count samples, not their values.", bestFor: "Sample presence and collection checks.", example: "metric website.visitors count every 1h since 7d" },
  { name: "rate", meaning: "Counter change per second, with resets clamped.", bestFor: "Requests/sec, bytes/sec, and throughput.", example: "metric http_requests_total rate every 1m since 1h" },
  { name: "increase", meaning: "Counter increase inside each bucket.", bestFor: "Orders, visitors, requests, or bytes per bucket.", example: "metric sales.orders increase every 1h since 7d" },
  { name: "p50 / p90 / p95 / p99", meaning: "Percentiles over samples in each bucket.", bestFor: "Latency and distribution metrics.", example: "metric http_request_duration_seconds p95 every 5m since 24h" },
];

const dashboardStatementRows: DashboardStatementRow[] = [
  { statement: 'dashboard "Name" { ... }', scope: "root", meaning: "Defines one dashboard document. This is the canonical editable source.", example: 'dashboard "Ops" { section "Main" {} }' },
  { statement: 'description "Text"', scope: "dashboard, section, card, widget", meaning: "Adds reader-facing context without changing data queries.", example: 'description "Live operational view."' },
  { statement: "controls { ... }", scope: "dashboard", meaning: "Declares reusable variables rendered above the dashboard.", example: 'controls { range "Range" variable range default 24h options 1h, 24h }' },
  { statement: 'range/source/entity/entity_type/label/text "Label"', scope: "controls", meaning: "Creates a control. Use variable, default, options, and type where useful.", example: 'entity "Container" variable entity_id type container default container:app-core' },
  { statement: 'section "Name" { ... }', scope: "dashboard, section", meaning: "Groups related rows and nested sections.", example: 'section "Today" { line "Orders" { query metric orders.created increase since 24h } }' },
  { statement: "row height sm|md|lg { ... }", scope: "section, card", meaning: "Places multiple widgets in one row.", example: 'row height lg { line "CPU" { query metric system.cpu.usage avg since 6h } }' },
  { statement: 'card "Name" [span n] { ... }', scope: "section, row, card", meaning: "Frames related child widgets and optional markdown.", example: 'card "Battery" span 6 { gauge "Charge" { query metric battery.charge latest since 10m } }' },
  { statement: 'markdown "Name" [span n] { """ ... """ }', scope: "section, row, card", meaning: "Adds Markdown notes, explanations, runbooks, or links.", example: 'markdown "Notes" { """## Notes\\n- Check importer health.""" }' },
  { statement: 'line/bar/stat/gauge/barGauge/histogram/heatmap/table "Name"', scope: "section, row, card", meaning: "Adds a query-backed widget. Table widgets also render events and states.", example: 'gauge "Charge" { query metric battery.charge latest since 10m }' },
  { statement: "query <Query DSL>", scope: "widget", meaning: "Embeds metric, events, or states Query DSL. Dashboard controls may be referenced as $variables.", example: "query metric orders.created increase every 1h since $range where region=$region" },
  { statement: "warn|critical when value <op> <value>", scope: "metric/state widget", meaning: "Applies visual state only. It does not send alerts or call webhooks.", example: 'critical when value > 95 message "Capacity almost full"' },
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

const dashboardStatementColumns: DataTableColumn<DashboardStatementRow>[] = [
  { id: "statement", header: "Statement", value: "statement", cellClass: "min-w-72" },
  { id: "scope", header: "Scope", value: "scope", cellClass: "w-40 whitespace-nowrap" },
  { id: "meaning", header: "Meaning", value: "meaning" },
  { id: "copy", header: "", value: (row) => row.example, headerClass: "w-12", cellClass: "w-12" },
];

export const PulseStartHelpPage = () => (
  <PulseDocPage>
    <DocLead>
      Pulse collects telemetry into one base, keeps it queryable, and turns it into live dashboards. It works for infrastructure signals,
      product metrics, business events, web analytics, energy data, and automation state.
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
            title: "Resource",
            icon: "ti-cube",
            text: "The thing being observed, such as a host, container, service, device, customer, order, shop, or battery.",
          },
          {
            title: "Signal",
            icon: "ti-list-search",
            text: "A metric, event, or state published by a source for zero or more resources.",
          },
          {
            title: "Variant",
            icon: "ti-stack-2",
            text: "One concrete series or row shape for a signal, identified by source, entity, entity type, and dimensions.",
          },
          {
            title: "Dashboard",
            icon: "ti-layout-dashboard",
            text: "A saved Dashboard DSL document. Public dashboards expose only the data referenced by that DSL through a UUID URL.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="First useful path">
      <StepList
        items={[
          { title: "Create a base", text: "Use one base for one product, environment, business area, or reporting context." },
          { title: "Add a source", text: "Connect a metrics endpoint or an HTTP ingest source and wait until it publishes data." },
          { title: "Check the source", text: "Open Sources to verify recent scrapes, token usage, and ingest health." },
          { title: "Browse resources", text: "Start from Resources when you want to know what Pulse has learned about a host, container, app, customer, or device." },
          { title: "Open a signal", text: "Use Metrics, Events, and States when you already know the signal name and want variants or recent values." },
          { title: "Write a dashboard", text: "Use Dashboard DSL to describe controls, sections, widgets, and notes as reviewable text." },
        ]}
      />
    </DocSection>

    <DocNote title="Naming rule">
      Metric, event, and state names describe the fact being recorded, for example <DocInlineCode>orders.created</DocInlineCode> or{" "}
      <DocInlineCode>system.cpu.usage</DocInlineCode>. Source, entity, entity type, and dimensions describe where that fact came from.
      This keeps queries readable and keeps the same model useful outside infrastructure monitoring.
    </DocNote>
  </PulseDocPage>
);

export const PulseWorkflowHelpPage = () => (
  <PulseDocPage>
    <DocLead>
      Most work in Pulse starts with a question: what data exists, which resource produced it, and how should it be viewed? The UI and DSL
      are designed around that path.
    </DocLead>

    <DocSection title="Choose the right starting point" eyebrow="Workflow">
      <DocRows
        items={[
          {
            title: "I know the resource",
            icon: "ti-cube",
            text: "Start in Resources. Open the host, container, device, customer, or service and inspect its metrics, states, and events together.",
          },
          {
            title: "I know the signal",
            icon: "ti-chart-dots",
            text: "Start in Metrics, Events, or States. Open the signal to see variants, entities, dimensions, recent values, and query snippets.",
          },
          {
            title: "I want a chart",
            icon: "ti-terminal-2",
            text: "Use Query explorer. Build one query, validate it, then copy it into Dashboard DSL once it is stable.",
          },
          {
            title: "I want an operating view",
            icon: "ti-layout-dashboard",
            text: "Use Dashboard DSL. Put the important controls first, then sections, rows, widgets, and markdown notes.",
          },
          {
            title: "I need a public display",
            icon: "ti-device-tv",
            text: "Create or copy the public link from dashboard settings. Public pages only read the dashboard data, not the whole base.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Resource-first example">
      <StepList
        items={[
          { title: "Open Resources", text: "Filter by source, type, or search text until the target resource is visible." },
          { title: "Select the resource", text: "Check its dimensions first. They explain what source labels mean for that resource." },
          { title: "Inspect signals", text: "Use the resource tabs to compare current metrics, states, and recent events without switching context." },
          { title: "Open a query", text: "Use the provided query action when a signal should become a chart, table, or dashboard widget." },
        ]}
      />
    </DocSection>
  </PulseDocPage>
);

export const PulseOperationsHelpPage = () => (
  <PulseDocPage>
    <DocLead>
      Pulse keeps operations explicit: sources bring data in, access controls who can change a base, retention controls storage growth, and
      public displays expose only selected dashboard data.
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
                <DocInlineCode>states</DocInlineCode> from other apps or ingest agents.
              </>
            ),
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
  </PulseDocPage>
);

export const PulseQueryDslHelpPage = () => (
  <PulseDocPage>
    <DocLead>
      Query DSL has three statement types: <DocInlineCode>metric</DocInlineCode> for numeric time series,{" "}
      <DocInlineCode>events</DocInlineCode> for event rows, and <DocInlineCode>states</DocInlineCode> for current state values. The same
      source, entity, entity type, and dimension filters work across the model.
    </DocLead>

    <DocSection title="Statement types" eyebrow="Query DSL">
      <div class="grid gap-3 lg:grid-cols-3">
        <DocCode title="Metric" code={metricSyntax} highlight={pulseQueryHighlight} copyText="metric <metric> <aggregation> [every <duration>] [since <duration>] [source <uuid>] [entity <id>] [entity_type <type>] [where <key>=<value>, ...]" copy />
        <DocCode title="Events" code={eventsSyntax} highlight={pulseQueryHighlight} copyText="events [<kind>|*] [since <duration>] [source <uuid>] [entity <id>] [entity_type <type>] [where <key>=<value>, ...] [limit <rows>]" copy />
        <DocCode title="States" code={statesSyntax} highlight={pulseQueryHighlight} copyText="states [<key>|*] [since <duration>] [source <uuid>] [entity <id>] [entity_type <type>] [where <key>=<value>, ...] [limit <rows>]" copy />
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
      <p>
        Choose the aggregation from the data type: gauges usually use averages or latest values; counters usually use rate or increase;
        latency distributions often use percentiles.
      </p>
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

    <DocSection title="Rules that matter">
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
          Metric queries fail when more than 250 series match. Add <DocInlineCode>source</DocInlineCode>, <DocInlineCode>entity</DocInlineCode>,{" "}
          or <DocInlineCode>where</DocInlineCode> filters. Event and state limits are capped at 1000 rows.
        </DocNote>
      </div>
    </DocSection>
  </PulseDocPage>
);

export const PulseDashboardDslHelpPage = () => (
  <PulseDocPage>
    <DocLead>
      Dashboard DSL is the only layout model for Pulse dashboards. It keeps the dashboard title, controls, sections, rows, cards, widgets,
      markdown notes, and conditional visual states in one reviewable text document.
    </DocLead>

    <DocSection title="Dashboard shape" eyebrow="Layout DSL">
      <div class="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <DocCode title="Shape" code={dashboardSyntax} highlight={pulseQueryHighlight} copy />
        <DocCode title="Example" code={dashboardExample} highlight={pulseQueryHighlight} copy />
      </div>
    </DocSection>

    <DocSection title="Statement reference">
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
    </DocSection>

    <DocSection title="Design rules">
      <div class="grid gap-3 text-sm lg:grid-cols-2">
        <DocNote title="Dashboards compose query output" variant="info">
          Widget <DocInlineCode>query</DocInlineCode> lines use the same Query DSL documented above. Use metric widgets for charts and
          values; use table widgets for events and states.
        </DocNote>
        <DocNote title="Controls define variables" variant="info">
          Declare controls once with <DocInlineCode>controls</DocInlineCode>, then use variables such as <DocInlineCode>$range</DocInlineCode>{" "}
          or <DocInlineCode>$entity_id</DocInlineCode> inside widget queries.
        </DocNote>
        <DocNote title="Public displays use defaults" variant="info">
          Public dashboard links render with each control's default value. Keep public dashboards deterministic by choosing useful defaults.
        </DocNote>
        <DocNote title="Conditions are visual" variant="warning">
          Use <DocInlineCode>warn when value &gt; 80</DocInlineCode> or <DocInlineCode>critical when value = false</DocInlineCode> to mark
          widgets visually. Alert delivery and webhooks are a separate future layer.
        </DocNote>
      </div>
    </DocSection>
  </PulseDocPage>
);

export const PulseInventoryHelpPage = () => (
  <PulseDocPage>
    <DocLead>
      Inventory is the live catalog of data in one Pulse base. Use it to discover sources, resources, metrics, events, states, entities,
      and dimensions before writing queries.
    </DocLead>

    <DocSection title="How to read inventory" eyebrow="Available data">
      <DocRows
        items={[
          {
            title: "Sources",
            icon: "ti-database-share",
            text: "Where the data came from. A source filter is useful when the same signal name appears in several systems.",
          },
          {
            title: "Entities and resources",
            icon: "ti-cube",
            text: "The observed objects. For infrastructure this may be hosts or containers; for business data it may be orders, customers, products, or stores.",
          },
          {
            title: "Metrics, events, states",
            icon: "ti-list-search",
            text: "The signal names currently known to Pulse. Copy a scoped snippet when you want to use one in the explorer or dashboard DSL.",
          },
          {
            title: "Dimensions",
            icon: "ti-tags",
            text: "Labels attached to a signal variant. Use dimensions in where clauses when source and entity are not specific enough.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Start broad, then narrow">
      If a query returns too many variants, add filters in this order: <DocInlineCode>source</DocInlineCode>, then{" "}
      <DocInlineCode>entity</DocInlineCode> or <DocInlineCode>entity_type</DocInlineCode>, then <DocInlineCode>where</DocInlineCode>{" "}
      dimensions. This usually keeps the query readable and fast.
    </DocNote>
  </PulseDocPage>
);

export const PulseInventoryReferenceIntro = () => (
  <section class="paper flex flex-col gap-4 p-4">
    <div>
      <h2 class="text-base font-semibold text-primary">Inventory</h2>
      <p class="text-sm text-dimmed">
        Filter this base by source or entity, then copy scoped snippets into the explorer or Dashboard DSL. Inventory is generated from
        observed data, so empty sections usually mean the source has not published that kind of signal yet.
      </p>
    </div>
  </section>
);

export const PulseReferenceOverviewPage = (props: { includeDashboardDsl?: boolean }) => (
  <PulseDocPage>
    <DocLead>
      This reference combines the Pulse mental model, Query DSL, Dashboard DSL, and live inventory for the current base. Read from the top
      when you are new; jump to Query DSL or Inventory when you are building.
    </DocLead>

    <DocSection title="What this reference covers" eyebrow="Overview">
      <div class="grid gap-3 text-sm lg:grid-cols-3">
        <DocNote title="Query DSL" variant="info">
          Fetch metrics, event rows, and current states. The explorer and dashboard widgets use the same language.
        </DocNote>
        <Show when={props.includeDashboardDsl}>
          <DocNote title="Dashboard DSL" variant="tip">
            Describe dashboard controls, sections, cards, markdown notes, and visual widgets as text.
          </DocNote>
        </Show>
        <DocNote title="Inventory" variant="info">
          Browse the current base. Filter by source or entity, then copy scoped snippets instead of memorizing names.
        </DocNote>
      </div>
    </DocSection>

    <DocSection title="Common snippets" eyebrow="Copy and adapt">
      <div class="grid gap-3 lg:grid-cols-2">
        <PulseQuerySnippet title="Counter throughput" code="metric http_requests_total rate every 1m since 1h where route=/api" />
        <PulseQuerySnippet title="Orders per hour" code="metric orders.created increase every 1h since 7d where channel=web" />
        <PulseQuerySnippet title="Recent errors" code="events app.error since 24h where severity=critical limit 100" />
        <PulseQuerySnippet title="Fresh integration states" code="states integration.online since 10m where integration=webshop limit 200" />
      </div>
    </DocSection>
  </PulseDocPage>
);

export const PulseTroubleshootingHelpPage = () => (
  <PulseDocPage>
    <DocLead>
      Most Pulse problems are either missing data, too broad queries, stale sources, or dashboard defaults that do not match the intended
      public view.
    </DocLead>

    <DocSection title="Common symptoms">
      <DocRows
        items={[
          {
            title: "No data appears",
            icon: "ti-database-off",
            text: "Check Sources first. A source must scrape or ingest successfully before resources, signals, or dashboards can show data.",
          },
          {
            title: "A query matches too much",
            icon: "ti-filter",
            text: "Open Inventory or the signal detail page, then add source, entity, entity_type, or where filters.",
          },
          {
            title: "A chart is empty",
            icon: "ti-chart-line",
            text: "Check the time range and aggregation. Counters usually need rate or increase; gauges usually need avg or latest.",
          },
          {
            title: "A public dashboard looks wrong",
            icon: "ti-device-tv",
            text: "Public displays use dashboard control defaults. Update the defaults in Dashboard DSL or dashboard settings.",
          },
          {
            title: "Rows look duplicated",
            icon: "ti-stack-2",
            text: "They are usually different variants of the same signal. Open the signal or resource detail view to compare dimensions.",
          },
        ]}
      />
    </DocSection>
  </PulseDocPage>
);
