import { DocConceptGrid, DocInlineCode, DocLead, DocNote, DocRows, DocSection } from "@valentinkolb/cloud/ui";
import { Show } from "solid-js";
import { PulseDocPage, PulseQuerySnippet, PulseStepList } from "./pulse-help-primitives";

export { PulseDashboardDslHelpPage } from "./pulse-dashboard-dsl-help";
export { PulseQueryDslHelpPage } from "./pulse-query-dsl-help";

export const PulseStartHelpPage = () => (
  <PulseDocPage>
    <DocLead>
      Pulse turns incoming telemetry into browsable data, query results, and dashboards. Start from the question you have, then let the UI
      reveal the source, resource, signal, and filters you need.
    </DocLead>

    <DocSection title="Start from the task" eyebrow="Overview">
      <DocRows
        items={[
          {
            title: "Check whether data arrives",
            icon: "ti-database-share",
            text: "Open Sources first. It shows scrape or ingest attempts, errors, counts, and token usage before you spend time debugging queries.",
          },
          {
            title: "Understand one observed thing",
            icon: "ti-cube",
            text: "Open Resources when you care about one host, container, device, customer, order, store, or app. This keeps metrics, states, and events in the same context.",
          },
          {
            title: "Inspect one named fact",
            icon: "ti-list-search",
            text: "Open Metrics, Events, or States when you already know the name, such as system.memory.usage or order.created.",
          },
          {
            title: "Build a query",
            icon: "ti-terminal-2",
            text: "Use Query explorer to test one metric, event, or state query. Copy filters from Inventory instead of memorizing labels.",
          },
          {
            title: "Build a dashboard",
            icon: "ti-layout-dashboard",
            text: "Use Dashboard DSL when the query is stable. Dashboards are text documents with controls, sections, rows, cards, widgets, and notes.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="First useful path">
      <PulseStepList
        items={[
          { title: "Create a base", text: "Use one base for one product, environment, business area, or reporting context." },
          {
            title: "Connect a source",
            text: "Add a metrics endpoint or HTTP ingest source and wait for the first successful scrape or batch.",
          },
          {
            title: "Browse what exists",
            text: "Use Resources when you know the object; use Metrics, Events, or States when you know the signal name.",
          },
          {
            title: "Open a query",
            text: "Start with a copied query snippet, then narrow it with source, entity, entity_type, or where filters.",
          },
          {
            title: "Write the dashboard",
            text: "Move useful, stable queries into Dashboard DSL. Add descriptions when the chart needs interpretation.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="One naming rule">
      Signal names describe the fact, such as <DocInlineCode>orders.created</DocInlineCode> or{" "}
      <DocInlineCode>system.cpu.usage</DocInlineCode>. Source, resource, and dimensions describe where that fact came from. This is why the
      same model works for servers, sales, websites, energy systems, and app workflows.
    </DocNote>
  </PulseDocPage>
);

export const PulseDataModelHelpPage = () => (
  <PulseDocPage>
    <DocLead>
      Pulse uses a small data model so different domains can share one query and dashboard language. Learn the nouns in the order you meet
      them while browsing data.
    </DocLead>

    <DocSection title="The path from ingest to chart" eyebrow="Data model">
      <DocConceptGrid
        items={[
          {
            title: "Base",
            icon: "ti-database",
            text: "A workspace with its own access, retention, sources, dashboards, and saved queries.",
          },
          {
            title: "Source",
            icon: "ti-database-share",
            text: "One input connection, such as a metrics endpoint, token-backed ingest source, or internal app integration.",
          },
          {
            title: "Resource",
            icon: "ti-cube",
            text: "The observed object: host, container, device, customer, order, store, service, battery, or any domain object.",
          },
          {
            title: "Signal",
            icon: "ti-list-search",
            text: "A named metric, event, or state. The name says what happened or what was measured.",
          },
          {
            title: "Variant",
            icon: "ti-stack-2",
            text: "One concrete signal shape for one source/resource/dimension set. Variants explain why one signal can have many rows or lines.",
          },
          {
            title: "Dimension",
            icon: "ti-tags",
            text: "A label on a variant, such as region, route, device, compose_service, channel, or customer_tier.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="How to read repeated rows">
      <DocRows
        items={[
          {
            title: "Same signal, different resources",
            icon: "ti-cube",
            text: "docker.container.cpu.usage can appear once per container. Open the signal to see variants, or open the resource to see only one container.",
          },
          {
            title: "Same resource, different dimensions",
            icon: "ti-tags",
            text: "A filesystem metric may appear once per mount. The dimensions show which mount, interface, route, region, or channel the row represents.",
          },
          {
            title: "Same source, different domains",
            icon: "ti-database-share",
            text: "A source can publish infrastructure data today and business events tomorrow. Pulse does not assume a fixed domain vocabulary.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Choose the right signal type">
      <DocRows
        items={[
          {
            title: "Metric: a bounded numeric time series",
            icon: "ti-chart-line",
            text: "Use metrics for repeated measurements such as CPU usage, power, latency, or revenue. Keep dimensions bounded: one metric may have at most 10,000 series in a base.",
          },
          {
            title: "Event: something happened",
            icon: "ti-bolt",
            text: "Use events for visits, QR opens, orders, requests, deployments, and other point-in-time facts. Events can carry high-cardinality detail without creating metric series.",
          },
          {
            title: "State: what is true now",
            icon: "ti-toggle-right",
            text: "Use states for online status, current version, operating mode, or another latest value. Pulse adds history only when the value actually changes.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Classify event fields">
      <DocRows
        items={[
          {
            title: "Dimensions filter and group",
            icon: "ti-tags",
            text: "Use bounded labels such as campaign, channel, country, outcome, or environment. Query DSL where and group by operate on dimensions.",
          },
          {
            title: "Attributes retain high-cardinality detail",
            icon: "ti-braces",
            text: "Use attributes for full URLs, request IDs, referrers, user agents, and irregular event detail that should remain visible on raw events.",
          },
          {
            title: "Sensitive fields expire independently",
            icon: "ti-shield-lock",
            text: "Use sensitive for raw IPs, precise geodata, and classified event data. Normal event results never expose it, and Pulse clears it before the remaining event expires.",
          },
          {
            title: "Payload stays opaque",
            icon: "ti-code-dots",
            text: "Use payload for nested domain data that should be returned as one object but does not need field discovery, filtering, or grouping.",
          },
          {
            title: "The field catalog stores shape, not values",
            icon: "ti-list-details",
            text: "Inventory records observed dimension, attribute, and sensitive field names, roles, value types, counts, and timestamps. It does not copy their values into the catalog.",
          },
          {
            title: "Identities support analytics",
            icon: "ti-fingerprint",
            text: "Use actorId, sessionId, and correlationId for high-cardinality identities. Pulse can count unique actors and sessions without turning them into dimensions.",
          },
          {
            title: "Resources stay stable",
            icon: "ti-cube",
            text: "Create resources for browsable objects such as a campaign, QR code, host, or service. A visit, session, request, timestamp, or IP address is not a resource.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Resource in the UI, entity in the DSL">
      The UI says resource because it is easier to read. Query DSL uses <DocInlineCode>entity</DocInlineCode> for the same identifier and{" "}
      <DocInlineCode>entity_type</DocInlineCode> for the resource class. For example,{" "}
      <DocInlineCode>entity container:app-core</DocInlineCode> means one resource; <DocInlineCode>entity_type container</DocInlineCode>{" "}
      means all container resources.
    </DocNote>
  </PulseDocPage>
);

export const PulseFindDataHelpPage = () => (
  <PulseDocPage>
    <DocLead>
      The fastest way to build a useful query is to find the right source, resource, or signal first, then copy a scoped snippet.
    </DocLead>

    <DocSection title="Choose the browser" eyebrow="Find data">
      <DocRows
        items={[
          {
            title: "Start with Sources when data is missing",
            icon: "ti-database-share",
            text: "Sources answer whether Pulse received anything recently. Check this before changing queries or dashboards.",
          },
          {
            title: "Start with Resources when you know the object",
            icon: "ti-cube",
            text: "Resources group the metrics, states, and events for one observed thing. This is the clearest path for hosts, containers, devices, customers, and orders.",
          },
          {
            title: "Start with Metrics, Events, or States when you know the name",
            icon: "ti-list-search",
            text: "Signal pages show variants, current values, dimensions, and query actions for one metric, event, or state.",
          },
          {
            title: "Use Inventory as the lookup table",
            icon: "ti-database-search",
            text: "Inventory is the live catalog for the current base. Filter it by source or entity, inspect observed field roles, then copy scoped snippets into Query explorer or Dashboard DSL.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Narrow in this order">
      <PulseStepList
        items={[
          { title: "Filter by source", text: "Use source when the same signal name appears in several systems or ingest pipelines." },
          {
            title: "Filter by resource",
            text: "Use entity or entity_type when the question is about one observed object or a resource class.",
          },
          {
            title: "Filter by dimensions",
            text: "Use where for labels such as route, region, channel, compose_service, mount, or device.",
          },
          {
            title: "Change the aggregation last",
            text: "If the query points at the right data but the chart looks wrong, revisit avg/latest/rate/increase.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Why variants matter">
      A metric with 50 variants is usually not duplicated. It often means 50 containers, mounts, routes, regions, products, or other labeled
      slices published the same signal name.
    </DocNote>
  </PulseDocPage>
);

export const PulseOperateHelpPage = () => (
  <PulseDocPage>
    <DocLead>
      Operation work in Pulse is about keeping data trustworthy: sources must be healthy, storage must stay bounded, access must be clear,
      and public displays must expose only the intended dashboard data.
    </DocLead>

    <DocSection title="Routine checks" eyebrow="Operate">
      <DocRows
        items={[
          {
            title: "Source health",
            icon: "ti-heartbeat",
            text: "Use Sources to verify the latest scrape or ingest, duration, errors, ingested counts, and token usage.",
          },
          {
            title: "Retention and clear data",
            icon: "ti-recycle",
            text: "Raw telemetry, hourly metric rollups, and classified sensitive event fields have independent retention. Sensitive expiry clears only the event's sensitive object; raw expiry removes the event. Clear telemetry to keep the base, sources, access, and settings while discarding collected data.",
          },
          {
            title: "Access",
            icon: "ti-lock",
            text: "Base permissions control who can view, edit, or administer a base. Public dashboards are separate link-based read views.",
          },
          {
            title: "Public displays",
            icon: "ti-device-tv",
            text: "A public display reads only the dashboard DSL output behind its UUID link. Use useful defaults because public viewers do not edit controls.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="HTTP ingest guarantees">
      <DocRows
        items={[
          {
            title: "Bounded batches",
            icon: "ti-box-multiple",
            text: "One request accepts up to 500 metrics, 500 events, and 500 states, with at most 1,500 signals in total. Split larger payloads into separate requests.",
          },
          {
            title: "Source-bound tokens",
            icon: "ti-key",
            text: "Every ingest token belongs to one source. Pulse ignores source identifiers in the payload and records all signals under the authenticated source.",
          },
          {
            title: "Retry-safe requests",
            icon: "ti-repeat",
            text: "Send the same Idempotency-Key when retrying one batch. Pulse returns the original result for 24 hours and rejects reuse with different content.",
          },
          {
            title: "Bounded metric cardinality",
            icon: "ti-chart-dots",
            text: "One metric may have at most 10,000 series in a base. Move request IDs, sessions, full URLs, IPs, and other unbounded values to events instead of metric dimensions.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Common symptoms">
      <DocRows
        items={[
          {
            title: "No data appears",
            icon: "ti-database-off",
            text: "Check the source first. A source must scrape or ingest successfully before resources, signals, or dashboards can show data.",
          },
          {
            title: "A query matches too much",
            icon: "ti-filter",
            text: "Open Inventory or the signal page, then add source, entity, entity_type, or where filters.",
          },
          {
            title: "A chart is empty",
            icon: "ti-chart-line",
            text: "Check the time range and aggregation. Counters usually need rate or increase; gauges usually need avg or latest.",
          },
          {
            title: "Rows look duplicated",
            icon: "ti-stack-2",
            text: "Open the resource or signal page. Repeated rows are usually variants with different resources or dimensions.",
          },
          {
            title: "A metric hits the series limit",
            icon: "ti-alert-triangle",
            text: "Inspect its dimensions. Keep stable grouping labels, then move unbounded identities or event detail into an event's first-class identities, attributes, sensitive fields, or payload.",
          },
        ]}
      />
    </DocSection>
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
      This is the canonical Pulse reference for building queries and dashboards. Use the syntax sections for stable rules, then use
      Inventory to copy the exact names, source ids, resource ids, and dimensions from the current base.
    </DocLead>

    <DocSection title="What this reference covers" eyebrow="Overview">
      <div class="grid gap-3 text-sm lg:grid-cols-3">
        <DocNote title="Query DSL" variant="info">
          Fetch metric series, raw or aggregated events, and current states. The explorer and dashboard widgets use the same language.
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

    <DocSection title="Use it as shared context" eyebrow="For people and tools">
      <DocRows
        items={[
          {
            title: "Start from the task",
            icon: "ti-route",
            text: "Decide whether the question needs a metric trend, event rows, current states, or a dashboard view before choosing syntax.",
          },
          {
            title: "Copy names from Inventory",
            icon: "ti-database-search",
            text: "Metrics, events, states, sources, resources, and dimensions are observed data. Do not guess them from examples.",
          },
          {
            title: "Keep resource and entity aligned",
            icon: "ti-cube",
            text: "The UI says resource. Query DSL says entity. They refer to the same identifier, such as container:app-core or customer:acme.",
          },
          {
            title: "Prefer reviewable text",
            icon: "ti-file-code",
            text: "Queries and dashboards are text contracts. Generated changes should keep names explicit, scopes narrow, and descriptions close to charts.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Common starting points" eyebrow="Copy and adapt">
      <div class="grid gap-3 lg:grid-cols-2">
        <PulseQuerySnippet title="Counter throughput" code="metric http_requests_total rate every 1m since 1h where route=/api" />
        <PulseQuerySnippet title="Orders per hour" code="metric orders.created increase every 1h since 7d where channel=web" />
        <PulseQuerySnippet title="Recent errors" code="events app.error since 24h where severity=critical limit 100" />
        <PulseQuerySnippet title="Daily unique visitors" code="events page.viewed unique actor every 1d since 30d where channel=web" />
        <PulseQuerySnippet
          title="Fresh integration states"
          code="states integration.online since 10m where integration=webshop limit 200"
        />
      </div>
    </DocSection>
  </PulseDocPage>
);
