---
id: pulse-start
title: Overview
icon: ti ti-activity-heartbeat
description: Core concepts and the first path through a Pulse base.
order: 100
---
Pulse turns incoming telemetry into browsable data, query results, and dashboards. Start from the question you have, then let the UI reveal the source, resource, signal, and filters you need.

## Start from the task

- **Check whether data arrives:** Open Sources first. It shows scrape or ingest attempts, errors, counts, and token usage before you spend time debugging queries.
- **Understand one observed thing:** Open Resources when you care about one host, container, device, customer, order, store, or app. This keeps metrics, states, and events in the same context.
- **Inspect one named fact:** Open Metrics, Events, or States when you already know the name, such as `system.memory.usage` or `order.created`.
- **Build a query:** Use Query explorer to test one metric, event, or state query. Copy filters from Inventory instead of memorizing labels.
- **Build a dashboard:** Use Dashboard DSL when the query is stable. Dashboards are text documents with controls, sections, rows, cards, widgets, and notes.

## First useful path

1. **Create a base:** Use one base for one product, environment, business area, or reporting context.
2. **Connect a source:** Add a metrics endpoint or HTTP ingest source and wait for the first successful scrape or batch.
3. **Browse what exists:** Use Resources when you know the object; use Metrics, Events, or States when you know the signal name.
4. **Open a query:** Start with a copied query snippet, then narrow it with source, entity, entity_type, or where filters.
5. **Write the dashboard:** Move useful, stable queries into Dashboard DSL. Add descriptions when the chart needs interpretation.

:::note One naming rule
Signal names describe the fact, such as `orders.created` or `system.cpu.usage`. Source, resource, and dimensions describe where that fact came from. This is why the same model works for servers, sales, websites, energy systems, and app workflows.
:::
