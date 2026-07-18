---
id: grids-views-reports
title: Views & reports
icon: ti ti-filter
description: Search, filters, sorting, grouping, aggregations, display modes, and reports.
order: 120
---
Views define how people inspect records. They can filter, sort, group, aggregate, and choose a display mode without duplicating data. Use them for operational lists, card boards, calendars, grouped reports, chart sources, exports, and dashboard embeds.

### Query building blocks

- **Filter:** Use filters for exact reusable rules. Search is broad; filters are explicit.
- **Sort:** Sort decides the order after search and filters apply. Add tie-breakers when results need stable order.
- **Group:** Group turns many records into one row per category. Grouped rows are summaries, not editable source records.
- **Aggregate:** Aggregations calculate count, unique count, sum, min, max, latest, earliest, median, or average per group.

### Display modes

- **Table:** Best for dense editing, scanning many columns, and operational work.
- **Cards:** Best when a few fields, a title, and optional image should be read at a glance.
- **Calendar:** Best when one date or date-time field places each record on a calendar.

### Search and exact filters

- **Search:** Search displayed values while exploring a table or view. It respects the current view, so filtered-out records stay hidden.
- **Search scope:** Search includes text, long text, numbers, dates, booleans, select labels, and readable relation labels.
- **Exact filters:** Use filters for exact numeric, date, select, empty, permission-sensitive, formula, lookup, and file-related rules.

:::note When to use GQL
Use GQL when a report, document source, dashboard widget, or preview needs more precision than the click UI. The GQL section documents the text syntax.
:::
