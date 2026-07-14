# Pulse Dashboard DSL

Dashboard DSL is the only Pulse dashboard authoring format. It keeps layout, queries, controls, descriptions, Markdown notes, and visual conditions in one reviewable text document.

## Contents

- [Authoring workflow](#authoring-workflow)
- [Smallest dashboard](#smallest-dashboard)
- [Document structure](#document-structure)
- [Controls and variables](#controls-and-variables)
- [Layout](#layout)
- [Widgets](#widgets)
- [Conditions](#conditions)
- [Markdown](#markdown)
- [Compile, save, and inspect](#compile-save-and-inspect)
- [Public displays](#public-displays)
- [Limits and current boundaries](#limits-and-current-boundaries)
- [Complete example](#complete-example)

## Authoring workflow

1. Discover actual sources, resources, signals, and dimensions with `cld pulse overview`, inventory commands, and `series`.
2. Prove each widget query with `cld pulse query compile` and `query run`.
3. Start with one section and the smallest useful widget.
4. Add rows only when content should be side by side.
5. Add controls when several widgets repeat the same filter or range.
6. Compile the complete document before saving.
7. Inspect a private snapshot before publishing.

Dashboard DSL embeds [Pulse Query DSL](pulse-query-dsl.md) after each widget's `query` statement.

## Smallest dashboard

```text
dashboard "Operations" {
  section "Overview" {
    stat "Request rate" {
      query metric http_requests_total rate every 1m since 1h
    }
  }
}
```

Save it from a file:

```bash
cld pulse dashboards compile --file operations.pulse --json
cld pulse dashboards create --name "Operations" --file operations.pulse --json
```

The saved dashboard name comes from `--name`. The root DSL title labels the document's generated root section when widgets exist directly at the root. Keep both names aligned.

## Document structure

```text
dashboard "Name" {
  description "Optional dashboard context."

  controls { ... }

  section "Topic" {
    description "Optional section context."
    row height md { ... }
    section "Nested topic" { ... }
  }
}
```

The root must start with `dashboard "Name" {` and contain at least one section or widget. Supported statements by container are:

| Container | Allowed children |
| --- | --- |
| Dashboard root | `description`, `controls`, `section`, `row`, `card`, `markdown`, visual widgets |
| Section | `description`, nested `section`, `row`, `card`, `markdown`, visual widgets |
| Row | `card`, `markdown`, visual widgets |
| Card | `description`, `row`, `markdown`, visual widgets |
| Markdown | `description`, one triple-quoted Markdown string |
| Visual widget | `description`, `visual`, `query`, `warn`, `critical` |

Sections and cards must not be empty. A row must contain at least one widget. Line comments start with `#` or `//` wherever whitespace is allowed.

## Controls and variables

Controls appear only at the dashboard root:

```text
controls {
  range "Range" variable range default 24h options 1h, 6h, 24h, 7d
  source "Source" variable source_id default 11111111-1111-4111-8111-111111111111
  entity "Container" variable entity_id type container default container:app-core
  entity_type "Resource type" variable entity_type default container
  label "Region" variable region default eu options eu, us
  text "Search" variable search default ""
}
```

Supported control kinds are `range`, `source`, `entity`, `entity_type`, `label`, and `text`.

Each control accepts inline options:

| Option | Meaning |
| --- | --- |
| `variable <name>` | Variable used as `$name` in widget queries. Defaults to a normalized form of the label. |
| `default <value>` | Value used before interaction and on public displays. |
| `options <value>, ...` | Selectable values. Commas are optional. |
| `type <resource-type>` | Resource type associated with an entity control. |

If `default` is omitted, Pulse uses the first option. A range control with neither a default nor options uses `24h`; other controls use an empty string.

Use variables inside query lines:

```text
line "Memory" {
  query metric docker.container.memory.usage avg every 5m since $range entity $entity_id
}
```

Values containing spaces, commas, or equals signs are quoted when control defaults are compiled into Query DSL. An undeclared `$variable` is a compile error.

Public displays use control defaults and do not expose interactive dashboard controls. Choose deterministic defaults that produce a useful view without user input.

## Layout

### Sections

Sections group larger topics and can contain nested sections:

```text
section "Infrastructure" {
  description "Current host and container health."

  section "Storage" {
    stat "Free space" {
      query metric filesystem.available latest since 10m
    }
  }
}
```

### Rows

Rows place widgets side by side:

```text
row height lg {
  line "CPU" span 8 {
    query metric system.cpu.usage avg every 5m since 24h
  }

  stat "Cores" span 4 {
    query metric system.cpu.cores latest since 10m
  }
}
```

`height` accepts `sm`, `md`, or `lg` and defaults to `md`. Widgets next to a taller widget occupy the full row height.

Widgets written next to each other without an explicit `row` are placed into an implicit `md` row. Use an explicit row when height or deliberate grouping matters.

### Spans

Visual widgets, cards, and Markdown blocks accept `span <1-12>`. Span controls width inside the 12-column row grid.

```text
gauge "Charge" span 4 { ... }
line "Power" span 8 { ... }
```

### Cards

Cards frame related child widgets and may contain rows:

```text
card "Battery" span 6 {
  description "Charge and recent power flow."

  gauge "Charge" {
    query metric battery.charge_percent latest since 10m
  }

  line "Power" {
    query metric battery.power_watts avg every 1m since 1h
  }
}
```

Do not use cards only to create another layer of padding. Use them when the children form one meaningful unit.

## Widgets

Visual widget syntax:

```text
<visual> "Title" [span <1-12>] {
  description "Optional reader context."
  [visual <override>]
  query <Query DSL>
  [warn when value <operator> <value> [message "Text"]]
  [critical when value <operator> <value> [message "Text"]]
}
```

Supported visual keywords are:

- `line`
- `bar`
- `stat`
- `gauge`
- `barGauge`
- `histogram`
- `heatmap`
- `table`

`barGauge` is case-sensitive. `visual <override>` changes the visual declared by the outer keyword and accepts the same values. Prefer the direct keyword unless generated code needs to keep the outer shape stable.

### Query compatibility

| Query result | Supported visuals |
| --- | --- |
| Metric points | `line`, `bar`, `stat`, `gauge`, `barGauge`, `histogram`, `heatmap`, `table` |
| Event rows | `table` only |
| State rows | `table` or `stat` |

Metric `line` is the fallback if an unsupported metric visual reaches normalization. Events and states with incompatible visuals fail compilation.
Dashboard event widgets always render raw event rows. Event aggregations such as `count`, `sum`, `unique actor`, and `unique session` are available in Query DSL through the Query Explorer and CLI, but are not dashboard widget result shapes.

Examples:

```text
histogram "Latency distribution" {
  query metric http_request_duration_seconds p95 every 5m since 24h
}

table "Recent deploys" {
  query events deploy.finished since 7d limit 100
}

stat "Checkout enabled" {
  query states checkout.enabled entity service:checkout limit 1
}
```

Metric units are taken from the observed metric definition. The dashboard formats common units such as percentages, bytes, seconds, and milliseconds automatically; Dashboard DSL has no separate format expression.

## Conditions

Metric widgets can apply visual warning and critical states:

```text
gauge "Battery health" {
  query metric system.battery.health latest since 10m
  warn when value < 80 message "Battery health is below 80 percent"
  critical when value < 60 message "Battery health is critical"
}
```

Syntax:

```text
warn|critical when value <operator> <value> [message "Text"]
```

Operators are `>`, `>=`, `<`, `<=`, `=`, and `!=`. Values may be numbers, booleans, or strings. The parser accepts conditions in any visual block, but the current dashboard renderer evaluates warning styling only for metric widget values. Do not rely on event or state conditions. Conditions change presentation only; they do not send alerts or webhooks.

## Markdown

Markdown blocks provide explanations, runbooks, assumptions, and links:

```text
markdown "Operating notes" span 12 {
  description "Context for on-call operators."
  """
  ## Before escalating

  1. Check source health.
  2. Confirm the selected resource and range.
  3. Compare the last deployment event.
  """
}
```

The title is optional. Content must be enclosed in triple double quotes.

## Compile, save, and inspect

Dashboard input accepts `--content`, `--file`/`-f`, or `--stdin`.

```bash
cld pulse dashboards compile --file operations.pulse --json
cld pulse dashboards create --name "Operations" --file operations.pulse --json
cld pulse dashboards update "Operations" --file operations-v2.pulse --json
cld pulse dashboards snapshot "Operations" --json
```

Compile output:

```json
{
  "ok": false,
  "diagnostics": [
    {
      "severity": "error",
      "message": "Unknown dashboard variable \"$host\"",
      "line": 12,
      "column": 7
    }
  ],
  "config": null
}
```

`create` and DSL-bearing `update` compile before saving and fail on the first service-level validation error. `snapshot` returns widget data keyed by generated widget IDs:

```json
{
  "dashboard": { "id": "dashboard-uuid", "name": "Operations", "config": { "layout": {} } },
  "points": { "metric-request-rate": [{ "bucket": "2026-07-12T12:00:00.000Z", "value": 42 }] },
  "events": { "events-recent-deploys": [] },
  "states": { "states-checkout-enabled": [] }
}
```

## Public displays

Publish only after a private snapshot contains the intended data:

```bash
cld pulse dashboards publish "Operations" --theme dark --height full --json
cld pulse dashboards public-url "Operations" --theme light --height scroll --yes
cld pulse dashboards unpublish "Operations"
```

Public URLs are bearer-style sharing credentials. Public snapshots expose the rendered dashboard layout and widget-bound values. They omit Dashboard DSL, query text, source IDs, and dimensions from returned event and state rows.

Public displays use control defaults. URL options select `light|dark` theme and `scroll|full` height mode; they are not Dashboard DSL statements.

## Limits and current boundaries

- Dashboard DSL input is limited to 40,000 characters.
- Titles are normalized to at most 160 characters; descriptions to 500 characters on widgets and 1,000 on the layout.
- Markdown content is normalized to at most 8,000 characters per block.
- A layout retains at most 24 controls and 24 top-level sections.
- A section retains at most 24 rows and 12 nested sections; nesting deeper than three child levels is removed during normalization.
- A row retains at most 12 cells.
- A widget retains at most 8 visual conditions.
- Span must be an integer from 1 to 12.

Auto-refresh is stored as dashboard settings, not Dashboard DSL. The current CLI has no flag to set it. Creating or replacing DSL through the CLI produces a manual-refresh dashboard; configure auto-refresh in the web UI after the CLI update when required.

## Complete example

```text
dashboard "Solar overview" {
  description "Live power, battery state, and grid interaction."

  controls {
    range "Range" variable range default 24h options 1h, 6h, 24h, 7d
    entity "Site" variable site type site default site:warehouse
  }

  section "Today" {
    description "Operational view for the selected site."

    row height md {
      gauge "Battery charge" span 4 {
        description "Latest state of charge reported by the inverter."
        query metric solar.battery.charge_percent latest since 10m entity $site
        warn when value < 20 message "Battery is low"
        critical when value < 10 message "Battery is critical"
      }

      line "Solar output" span 8 {
        description "Average generated power over the selected range."
        query metric solar.output_watts avg every 5m since $range entity $site
      }
    }

    section "Grid" {
      row height md {
        line "Import" span 6 {
          query metric grid.import_watts avg every 5m since $range entity $site
        }

        line "Export" span 6 {
          query metric grid.export_watts avg every 5m since $range entity $site
        }
      }
    }

    markdown "Notes" {
      """
      ## Operating notes

      - Values update when the source publishes new samples.
      - Check inverter state if output drops while irradiance remains high.
      """
    }
  }
}
```

Return to the [Pulse CLI reference](pulse.md) for discovery, source management, access, and lifecycle operations.
