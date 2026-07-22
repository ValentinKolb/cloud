---
id: pulse-dashboard-dsl
title: Dashboard DSL
icon: ti ti-layout-dashboard
description: Controls, sections, rows, cards, widgets, markdown, and conditions.
order: 130
---
Dashboard DSL is the dashboard source of truth. Write the operating view as text, preview it, and keep layout, queries, notes, and visual warning states reviewable in one place.

## Build in layers {icon="square-plus"}

:::steps
1. **Start with one section:** Give the dashboard a name and add the smallest section that answers one real question.
2. **Add one widget:** Use stat, gauge, line, bar, histogram, heatmap, or table depending on the query output.
3. **Add controls when repetition appears:** Use controls for range, source, entity, entity_type, label, or text values that multiple widgets share.
4. **Group related widgets:** Use rows for side-by-side charts, cards for a related cluster, and sections for larger topics.
5. **Explain decisions in place:** Use descriptions and markdown for operating notes, assumptions, and links.
:::

## Smallest useful dashboard {icon="layout-dashboard"}

**Minimal dashboard**

```text
dashboard "Ops" {
  section "Overview" {
    stat "Requests" {
      query metric http_requests_total rate every 1m since 1h
    }
  }
}
```

This is enough to render a dashboard: a root document, one section, one widget, and one query. Add structure when the dashboard starts repeating itself.

## Add controls when values repeat {icon="point"}

**Controls and variables**

```text
dashboard "Ops" {
  controls {
    range "Range" variable range default 24h options 1h, 6h, 24h, 7d
    entity "Container" variable entity_id type container default container:app-core
  }

  section "Container" {
    line "Memory" {
      query metric docker.container.memory.usage avg every 5m since $range entity $entity_id
    }
  }
}
```

Controls create variables such as `$range` or `$entity_id`. Public displays use the default values, so choose defaults that make sense without interaction.

## Full shape {icon="point"}

**Shape**

```text
dashboard "Name" {
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
}
```

**Example**

```text
dashboard "Solar overview" {
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
}
```

## Statement reference {icon="book-2"}

| Statement | Scope | Meaning | Example |
| --- | --- | --- | --- |
| `dashboard "Name" { ... }` | root | Defines one dashboard document. This is the canonical editable source. | `dashboard "Ops" { section "Main" {} }` |
| `description "Text"` | dashboard, section, card, widget, markdown | Adds reader-facing context without changing data queries. | `description "Live operational view."` |
| `controls { ... }` | dashboard | Declares reusable variables rendered above the dashboard. | `controls { range "Range" variable range default 24h options 1h, 24h }` |
| `range/source/entity/entity_type/label/text "Label"` | controls | Creates a control. Use variable, default, options, and type where useful. If default is omitted, the first option is used. | `entity "Container" variable entity_id type container default container:app-core` |
| `section "Name" { ... }` | dashboard, section | Groups related rows and nested sections. | `section "Today" { line "Orders" { query metric orders.created increase since 24h } }` |
| `row height sm\|md\|lg { ... }` | section, card | Places multiple widgets in one row. If height is omitted, md is used. | `row height lg { line "CPU" { query metric system.cpu.usage avg since 6h } }` |
| `card "Name" [span n] { ... }` | section, row, card | Frames related child widgets and optional markdown. Span is an optional integer from 1 to 12. | `card "Battery" span 6 { gauge "Charge" { query metric battery.charge latest since 10m } }` |
| `markdown ["Name"] [span n] { """ ... """ }` | section, row, card | Adds Markdown notes, explanations, runbooks, or links. Markdown content must be triple-quoted. | `markdown "Notes" { """## Notes\n- Check importer health.""" }` |
| `line/bar/stat/gauge/barGauge/histogram/heatmap/table "Name"` | section, row, card | Adds a query-backed widget. barGauge is case-sensitive. Events render only as table widgets; states render as table or stat widgets. | `gauge "Charge" { query metric battery.charge latest since 10m }` |
| `query <Query DSL>` | widget | Embeds metric, events, or states Query DSL. Dashboard controls may be referenced as $variables. Event widgets render raw rows; event aggregation points are Query Explorer and CLI results. | `query metric orders.created increase every 1h since $range where region=$region` |
| `warn\|critical when value <op> <value>` | metric widget | Applies visual state to metric values only. Operators are >, >=, <, <=, =, and !=. Optional message text can explain the condition. | `critical when value > 95 message "Capacity almost full"` |
| `# comment or // comment` | anywhere whitespace is allowed | Adds a line comment in the dashboard DSL source. Comments are ignored by the parser. | `# explain why this section exists` |

## Design rules {icon="book-2"}

:::info Dashboards compose query output
Widget `query` lines use the same Query DSL. Metric widgets render values and charts; table widgets render raw event rows and current states. Event aggregation points are available in the Query Explorer and CLI, not dashboard widgets.
:::

:::info Controls define variables
Declare controls once, then use variables inside widget queries. This keeps dashboards editable without duplicating filters.
:::

:::info Public displays use defaults
Public links render with each control's default value. Keep public dashboards deterministic by choosing useful defaults.
:::

:::info Refresh is a dashboard setting
Auto-refresh is configured outside Dashboard DSL. Choose 1, 5, 10, or 60 seconds, or disable automatic refresh. New dashboards default to five seconds, and editing DSL keeps the existing refresh setting.
:::

:::warning Conditions are visual
Use `warn when value > 80` or `critical when value = false` to mark metric widgets visually. Alert delivery and webhooks are a separate future layer.
:::
