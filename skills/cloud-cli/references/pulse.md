# Pulse CLI

## What Pulse is

Pulse collects metrics, events, and current states from infrastructure, applications, devices, and business processes. It turns that telemetry into a browsable resource inventory, query results, saved queries, and declarative dashboards.

Use `cld pulse` to inspect what a Pulse base contains, narrow data to a source or resource, test Query DSL, and build dashboards with Dashboard DSL. Pulse does not assume that the data is about servers: the same model works for containers, sales, websites, energy systems, customers, orders, and other observed objects.

## Contents

- [Mental model](#mental-model)
- [Safe agent workflow](#safe-agent-workflow)
- [Select a base](#select-a-base)
- [Explore available data](#explore-available-data)
- [Run and save queries](#run-and-save-queries)
- [Build dashboards](#build-dashboards)
- [Manage sources and ingest](#manage-sources-and-ingest)
- [Manage access](#manage-access)
- [Use JSON safely](#use-json-safely)
- [Destructive operations](#destructive-operations)
- [Complete command catalogue](#complete-command-catalogue)

## Mental model

Read Pulse data from broad context to specific values:

1. A **base** is a workspace with its own access, retention, sources, queries, and dashboards.
2. A **source** is one input connection, such as a Prometheus-compatible metrics endpoint or token-backed HTTP ingest source.
3. A **resource** is an observed object such as a host, container, device, customer, order, or service.
4. A **signal** is a named metric, event, or state.
5. A **variant** is one signal for one source, resource, and dimension set.
6. A **dimension** is an exact-match label such as `region`, `route`, `channel`, `mount`, or `compose_service`.

The UI calls an observed object a resource. Query DSL calls its identifier `entity` and its class `entity_type`.

- **Metric:** a numeric value sampled over time, such as memory usage or sales volume.
- **Event:** something that happened at a point in time, such as a deployment or completed order.
- **State:** the latest known value of a fact, such as online status or current version.

Repeated signal names are usually variants, not duplicates. For example, `docker.container.cpu.usage` can have one variant per container.

## Safe agent workflow

Do not start by guessing signal names or writing a large dashboard. Discover the live base first, clarify the user's question, then build in verified layers.

### 1. Discover the workspace

```bash
cld pulse list --json
cld pulse use "Operations"
cld pulse current
cld pulse overview --json
```

`overview` is the compact planning command. It returns the base, summary counts, sources, dashboards, top resources, and top metrics. Add `--include-inventory` only when the full inventory is needed; the normal JSON output stays intentionally compact.

### 2. Explore what the base actually contains

```bash
cld pulse sources list --json
cld pulse resources list --limit 100 --json
cld pulse metrics --limit 100 --json
cld pulse events --limit 100 --json
cld pulse states --limit 100 --json
```

Start with Sources if data may be missing. Start with Resources if the user names an object. Start with Metrics, Events, or States if the user already knows the signal name.

### 3. Narrow to the user's subject

```bash
cld pulse resources list --type container --source Docker --json
cld pulse resources get "container:app-core" --json
cld pulse resources metrics "container:app-core" --json
cld pulse resources states "container:app-core" --json
cld pulse resources events "container:app-core" --limit 50 --json
```

Use IDs from JSON output when names are ambiguous. Source filters accept `--source <name-or-id>` or `--source-id <uuid>`, but not both.

### 4. Discuss the intended view with the user

Before creating a dashboard, summarize the observed data and ask decisions that affect the result:

- Which resources or business objects matter?
- Which time range should be the default?
- Does the user need current values, trends, event rows, or state tables?
- Which dimensions distinguish variants?
- Which thresholds should be warning or critical?
- Should the dashboard stay private or have a public display URL?

Do not infer warning thresholds from metric names alone. A technically valid dashboard can still communicate the wrong operational meaning.

### 5. Prove each query

```bash
cld pulse query compile --query 'metric system.memory.usage avg every 5m since 24h entity host:macbook' --json
cld pulse query run --query 'metric system.memory.usage avg every 5m since 24h entity host:macbook' --json
```

Use `query run` for every planned widget. If a metric matches too many variants, add `source`, `entity`, `entity_type`, or `where` filters.

### 6. Build and verify the dashboard

Write Dashboard DSL to a file, compile it, create the dashboard, and inspect a private snapshot before publishing:

```bash
cld pulse dashboards compile --file dashboard.pulse --json
cld pulse dashboards create --name "MacBook health" --file dashboard.pulse --json
cld pulse dashboards snapshot "MacBook health" --json
```

Iterate on the DSL with the user. Keep descriptions near charts that need interpretation. Publish only after the snapshot contains the expected metric points, events, and states.

## Select a base

Most commands accept a base ID or exact name as a positional argument, or `--base <id-or-exact-name>`. After `use`, omit the base from later commands.

```bash
cld pulse list --json
cld pulse create "Operations" --description "Production telemetry" --use
cld pulse current
cld pulse get --json
cld pulse update --retention-days 30
```

Use a separate base when access, retention, ownership, or reporting context should differ. A base is not tied to one technical domain.

## Explore available data

### Inventory and resources

```bash
cld pulse inventory --json
cld pulse overview --json
cld pulse resources list --q "checkout" --type service --limit 100 --json
cld pulse resources get "service:checkout" --json
cld pulse resources metrics "service:checkout" --type counter --json
cld pulse resources states "service:checkout" --key service.online --json
cld pulse resources events "service:checkout" --kind deploy.finished --limit 50 --json
```

`inventory` returns inventory counts and the current inventory payload. `overview` is better for initial planning because it also includes sources, dashboards, top resources, and top metrics.

Resource commands resolve an exact resource key, ID, or label. Available filters include:

- `--q <text>` for server-side search.
- `--type <resource-type>` on `resources list`.
- `--source <name-or-id>` or `--source-id <uuid>`.
- `--limit <1-500>` and `--offset <number>`.

### Metrics, events, states, and series

```bash
cld pulse metrics --q memory --type gauge --entity-type host --json
cld pulse series system.memory.usage --entity host:macbook --json
cld pulse events --kind deploy.finished --entity-type service --limit 100 --json
cld pulse states --key service.online --entity service:checkout --json
```

The signal commands support source and resource scoping:

- `metrics`: `--q`, `--type`, `--resource`, `--entity`, `--entity-type`, source filters, pagination.
- `series <metric>`: `--q`, `--resource`, `--entity`, `--entity-type`, source filters, pagination.
- `events`: `--q`, `--kind`, `--resource`, `--entity`, `--entity-type`, source filters, pagination.
- `states`: `--q`, `--key`, `--resource`, `--entity`, `--entity-type`, source filters, pagination.

Use `series` when one metric name has several resources or dimension sets. Use a resource command when the user starts from an observed object rather than a signal name.

## Run and save queries

Query input can be passed with `--query`, `--file`/`-f`, or `--stdin`.

```bash
cld pulse query compile --query 'metric http_requests_total rate every 1m since 1h'
cld pulse query run --file request-rate.pulse --json
cat request-rate.pulse | cld pulse query save --name "Request rate" --stdin --json
cld pulse query list --json
```

### Query DSL

Metrics return numeric time-series points:

```text
metric <metric> <aggregation>
  [every <duration>]
  [since <duration>]
  [source <uuid>]
  [entity <id>]
  [entity_type <type>]
  [where <key>=<value>, ...]
```

Events and states return rows:

```text
events [<kind>|*]
  [since <duration>]
  [source <uuid>]
  [entity <id>]
  [entity_type <type>]
  [where <key>=<value>, ...]
  [limit <rows>]

states [<key>|*]
  [since <duration>]
  [source <uuid>]
  [entity <id>]
  [entity_type <type>]
  [where <key>=<value>, ...]
  [limit <rows>]
```

Durations use `m`, `h`, or `d` and may not exceed 90 days. Event and state limits are capped at 1,000 rows. Metric queries fail when more than 250 series match; narrow the scope instead of relying on an accidental aggregate.

Metric aggregations:

- `avg`, `latest`, `min`, `max`, and `sum` for gauge values and totals.
- `count` to count samples rather than sum their values.
- `rate` for per-second counter throughput with resets clamped.
- `increase` for counter growth per bucket.
- `p50`, `p90`, `p95`, and `p99` for distributions and latency.

Examples:

```text
metric solar.output_watts avg every 15m since 7d where inverter=main
metric http_requests_total rate every 1m since 1h where route=/api
metric orders.created increase every 1h since 7d where channel=web
events deploy.finished since 7d where env=prod limit 100
states integration.enabled entity webshop limit 50
```

Use quotes when names or values contain spaces, commas, or equals signs.

### Saved queries

```bash
cld pulse query save --name "Checkout errors" --description "Critical checkout events" \
  --query 'events checkout.error since 24h where severity=critical limit 100' --json
cld pulse query list --json
cld pulse query delete "Checkout errors" --yes
```

`query save` compiles the query first and refuses invalid input.

## Build dashboards

Dashboard DSL is the only dashboard authoring format. A dashboard is a reviewable text document containing controls, sections, rows, cards, visual widgets, conditions, and Markdown notes. Widget query lines use the same Query DSL described above.

### Minimal dashboard

```text
dashboard "Operations" {
  description "Current service health and recent request throughput."

  controls {
    range "Range" variable range default 24h options 1h, 6h, 24h, 7d
    entity "Service" variable entity_id type service default service:checkout
  }

  section "Health" {
    row height md {
      stat "Current memory" span 4 {
        query metric system.memory.usage latest since $range entity $entity_id
        warn when value > 80 message "Memory usage is high"
        critical when value > 95 message "Memory usage is critical"
      }

      line "Request rate" span 8 {
        description "Requests per second for the selected service."
        query metric http_requests_total rate every 1m since $range entity $entity_id
      }
    }
  }

  section "Activity" {
    table "Recent deploys" {
      query events deploy.finished since $range entity $entity_id limit 50
    }

    markdown "Notes" {
      """
      ## Reading this dashboard

      Confirm a deploy before treating a short request-rate change as an incident.
      """
    }
  }
}
```

Supported controls are `range`, `source`, `entity`, `entity_type`, `label`, and `text`. A control declares a `variable`; widgets reference it as `$variable`.

Supported visual widgets are `line`, `bar`, `stat`, `gauge`, `barGauge`, `histogram`, `heatmap`, and `table`. `barGauge` is case-sensitive. Events render only as tables; states render as tables or stats.

Use:

- `section` for a topic and nested subsections.
- `row height sm|md|lg` for side-by-side content.
- `card "Name" span <1-12>` for a related cluster.
- `span <1-12>` to control width inside rows.
- `description` for short reader context.
- Triple-quoted `markdown` blocks for longer explanations and operating notes.
- `warn` and `critical` conditions for visual state. Operators are `>`, `>=`, `<`, `<=`, `=`, and `!=`.
- `#` or `//` for line comments.

Conditions change presentation only. They do not send alerts or webhooks.

### Compile, create, update, and inspect

```bash
cld pulse dashboards compile --file operations.pulse --json
cld pulse dashboards create --name "Operations" --file operations.pulse --json
cld pulse dashboards get "Operations" --json
cld pulse dashboards snapshot "Operations" --json
cld pulse dashboards update "Operations" --file operations-v2.pulse --json
```

`dashboards compile` returns diagnostics without saving. `create` and DSL-bearing `update` compile before writing. `snapshot` executes the private dashboard and returns its compiled dashboard plus point, event, and state data without publishing it.

### Public displays

Publishing creates a link-based unauthenticated display. Treat the returned token and URL as sensitive sharing credentials.

```bash
cld pulse dashboards public-url "Operations" --theme dark --height full --yes
cld pulse dashboards publish "Operations" --theme light --height scroll --json
cld pulse dashboards unpublish "Operations"
```

Display options affect the returned URL:

- `--theme light|dark`
- `--height scroll|full`

`dashboards public-url` requires `--yes` because it can enable a public link and reveals that link. `dashboards publish` enables the link directly and returns the public token and URL. `dashboards unpublish` disables the current public link.

Create and publish in one operation only after the DSL has been compiled separately:

```bash
cld pulse dashboards create --name "Status" --file status.pulse \
  --public --theme dark --height full --json
```

## Manage sources and ingest

### Source types

Pulse exposes three real source kinds:

- `metrics`: Pulse scrapes a Prometheus-compatible endpoint. Supply `--endpoint-url`; bearer auth and scrape interval are optional.
- `http_ingest`: external collectors push metrics, events, and states with labeled source tokens.
- `internal`: Cloud-internal integration source metadata.

```bash
cld pulse sources create --name "API metrics" --kind metrics \
  --endpoint-url https://api.example.com/metrics \
  --scrape-interval-seconds 60

cld pulse sources create --name "Warehouse importer" --kind http_ingest
cld pulse sources list --json
```

Bearer tokens for scraped endpoints are stored encrypted and are not returned by list/get output.

```bash
cld pulse sources update "API metrics" --enabled false
cld pulse sources scrape "API metrics" --json
cld pulse sources scrapes "API metrics" --json
```

`sources scrapes` shows recent success, finish time, ingested counts, duration, and errors. Check it before changing queries when scraped data is missing.

### HTTP ingest tokens

Create a separate labeled token for each importer, server, or job. The raw token is shown only at creation time.

```bash
cld pulse source-tokens create "Warehouse importer" --name "production-job" --json
cld pulse source-tokens list "Warehouse importer" --json
cld pulse source-tokens revoke "Warehouse importer" "production-job" --yes
```

Use `--expires-at <ISO timestamp>` to create an expiring token. Store the returned raw token in the collector's secret store; do not place it in dashboard DSL, saved queries, shell history, or documentation.

### Ingest a batch through the signed-in CLI

`cld pulse ingest` sends a JSON batch through the authenticated Cloud API. Use `--file`, `--stdin`, or `--batch`.

```json
{
  "metrics": [
    {
      "name": "sales.orders.total",
      "value": 142,
      "type": "counter",
      "unit": "count",
      "entityId": "store:berlin",
      "entityType": "store",
      "dimensions": { "channel": "web" }
    }
  ],
  "events": [
    {
      "kind": "order.created",
      "entityId": "order:1234",
      "entityType": "order",
      "dimensions": { "channel": "web" },
      "payload": { "currency": "EUR" }
    }
  ],
  "states": [
    {
      "key": "store.online",
      "value": true,
      "entityId": "store:berlin",
      "entityType": "store"
    }
  ]
}
```

```bash
cld pulse ingest --file batch.json --json
```

Timestamps are optional ISO datetimes. Metric values must be finite numbers. Dimension values may be strings, numbers, booleans, or null. Metric types are `gauge`, `counter`, `histogram`, and `summary`.

One request accepts at most 500 metrics, 500 events, and 500 states, with at most 1,500 total signals. Split larger payloads. Tokens for external collectors are bound to one source; payload `sourceId` values do not let a collector write as another source.

## Manage access

Base permissions are `read`, `write`, and `admin`.

```bash
cld pulse access list --json
cld pulse access search-principals "Sysadmins" --kind group --json
cld pulse access grant --group "Sysadmins" --permission write
cld pulse access set --user ada@example.org --permission admin
```

`access grant` creates a new direct grant. Prefer `access set` for agent workflows because it updates an existing direct grant or creates one when absent.

Use exactly one principal selector: `--user`, `--group`, or `--authenticated`. Pulse does not expose public or service-account base grants through these commands. `access list` shows direct grants; inherited access is not expanded.

```bash
cld pulse access revoke --group "Sysadmins" --yes
```

Revocation requires `--yes`. You may use `--access-id` from `access list` instead of resolving a principal.

## Use JSON safely

Use `--json` whenever another tool or agent will inspect the result. Do not parse human tables.

```bash
cld pulse overview --json > pulse-overview.json
cld pulse resources list --type host --json > hosts.json
cld pulse query run --file query.pulse --json > query-result.json
cld pulse dashboards snapshot "Operations" --json > snapshot.json
```

Agent rules:

- Resolve exact names or IDs from JSON before mutation.
- Prefer IDs when names are ambiguous.
- Keep normal output for human inspection only.
- Use `--file` or `--stdin` for Query DSL, Dashboard DSL, and ingest JSON.
- Do not echo source tokens or public display tokens back to the user unless the requested workflow requires the value.
- Do not use `--include-inventory` by default; it intentionally expands `overview` JSON.
- Use `--limit` and `--offset` for bounded exploration instead of loading every signal row.

## Destructive operations

Read the target first and act only after explicit user approval.

These commands require `--yes`:

- `delete`: deletes a base and its contents.
- `clear-data`: deletes telemetry while preserving the base, settings, sources, dashboards, saved queries, and access.
- `sources delete`: deletes a source.
- `source-tokens revoke`: revokes an ingest credential.
- `query delete`: deletes a saved query.
- `dashboards delete`: deletes a dashboard.
- `dashboards public-url`: enables or reveals a public link.
- `access revoke`: removes a direct grant.

`dashboards publish` enables a public link without a `--yes` flag. Run it only when the user explicitly asks to publish. `dashboards unpublish` disables public access and does not require `--yes`.

## Complete command catalogue

Run `cld pulse <command> --help` before using unfamiliar flags or argument order.

| Area | Commands |
| --- | --- |
| Deployment | `capabilities` |
| Bases | `list`, `use`, `current`, `get`, `create`, `update`, `delete`, `clear-data` |
| Planning | `overview`, `inventory` |
| Resources | `resources list`, `resources get`, `resources metrics`, `resources states`, `resources events` |
| Signals | `metrics`, `series`, `events`, `states` |
| Sources | `sources list`, `sources create`, `sources update`, `sources delete`, `sources scrape`, `sources scrapes` |
| Ingest credentials | `source-tokens list`, `source-tokens create`, `source-tokens revoke` |
| Ingest | `ingest` |
| Queries | `query compile`, `query run`, `query list`, `query save`, `query delete` |
| Dashboards | `dashboards list`, `dashboards get`, `dashboards snapshot`, `dashboards compile`, `dashboards create`, `dashboards update`, `dashboards delete`, `dashboards publish`, `dashboards public-url`, `dashboards unpublish` |
| Access | `access list`, `access grant`, `access set`, `access revoke`, `access search-principals` |

`capabilities` reports whether TimescaleDB, `time_bucket`, and continuous aggregates are available. Pulse still supports PostgreSQL-only development behavior; capability output describes the selected Cloud instance rather than changing it.
