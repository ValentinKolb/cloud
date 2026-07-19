---
id: pulse-query-language
title: Query DSL
icon: ti ti-terminal-2
description: Metric, event, and state query syntax with aggregations and examples.
order: 120
---
Query DSL answers one data question at a time. Pick whether you need a metric series, raw or aggregated events, or current states, then narrow the query with source, resource, and dimension filters.

## Pick the statement by question {icon="point"}

- **How did a number change?** Use `metric`. Add an aggregation such as `avg`, `latest`, `rate`, or `increase`.
- **What happened recently?** Use `events`. Return raw rows for inspection, or count, sum, and count unique actors or sessions in SQL.
- **What is true now?** Use `states`. States return the latest known value for facts such as online status, version, configuration, inventory, or current health.

## Build a query in four steps {icon="search"}

:::steps
1. **Name the signal:** Choose the metric, event kind, or state key from the UI or Inventory.
2. **Choose the shape:** Metrics need an aggregation. Events can return rows or use count, sum, or unique aggregation.
3. **Set the time range:** Use since for the range, and every for metric or aggregated-event buckets.
4. **Narrow the scope:** Add source, entity, entity_type, or where filters when the result includes too many variants or rows.
:::

## Statement types {icon="book-2"}

**Metric**

```text
metric <metric> <aggregation>
  [every <duration>]
  [since <duration>]
  [source <uuid>]
  [entity <id>]
  [entity_type <type>]
  [where <key>=<value>, ...]
```

**Events**

```text
events [<kind>|*]
  [count|sum|unique actor|unique session]
  [every <duration>]
  [group by <dimension>, ...]
  [since <duration>]
  [source <uuid>]
  [entity <id>]
  [entity_type <type>]
  [where <key>=<value>, ...]
  [limit <rows>]
```

**States**

```text
states [<key>|*]
  [since <duration>]
  [source <uuid>]
  [entity <id>]
  [entity_type <type>]
  [where <key>=<value>, ...]
  [limit <rows>]
```

## Examples {icon="point"}

**Current value for one device**

```text
metric battery.charge_percent latest every 5m since 24h where device="garage-battery"
```

Use latest when the newest gauge value matters more than the average trend.

**Trend over time**

```text
metric solar.output_watts avg every 15m since 7d where inverter=main
```

Use avg to smooth noisy gauge samples without changing the unit.

**Throughput from a counter**

```text
metric http_requests_total rate every 1m since 1h where route=/api
```

Use rate when a counter keeps growing and you want per-second throughput.

**Business volume per bucket**

```text
metric orders.created increase every 1h since 7d where channel=web
```

Use increase when the question is how many new things happened inside each bucket.

**Recent events**

```text
events deploy.finished since 7d where env=prod limit 100
```

Use raw events for rows you want to inspect or audit.

**Daily unique visitors**

```text
events page.viewed unique actor every 1d since 30d where channel=web
```

Use first-class actor identities for unique counts instead of creating one dimension value per visitor.

**Current states**

```text
states integration.enabled entity "webshop" limit 50
```

Use states for current truth. Add since only when stale values should disappear.

## Clause reference {icon="search"}

| Clause | Applies to | Meaning | Example |
| --- | --- | --- | --- |
| `metric <metric> <aggregation>` | metric | Select one numeric signal and define how samples are reduced. Metrics default to every 5m since 24h. | `metric orders.created increase` |
| `events [<kind>\|*]` | events | Return event rows by kind. Omit the kind or use * for all events. Events default to since 24h limit 500. | `events deploy.finished` |
| `count \| sum \| unique actor \| unique session` | events | Aggregate matched events in SQL and return time-series points instead of raw rows. | `events page.viewed unique actor every 1d since 30d` |
| `group by <dimension>, ...` | aggregated events | Split an event aggregation by one to four dimension keys. Other event field roles cannot be grouped. | `group by campaign, country` |
| `states [<key>\|*]` | states | Return current state rows by key. Omit the key or use * for all states. States default to limit 500 with no stale-time filter. | `states host.online` |
| `every <duration>` | metric, aggregated events | Bucket metric samples or aggregated events into fixed time windows. Use compact durations such as 5m, 1h, or 7d. | `every 15m` |
| `since <duration>` | metric, events, states | Limit by time. Durations use m, h, or d and may not exceed 90 days. For states, since hides stale current values. | `since 7d` |
| `source <uuid>` | all | Restrict results to one source. The value must be a valid source UUID copied from Pulse. | `source 00000000-0000-4000-8000-000000000000` |
| `entity <id>` | all | Restrict results to one resource identifier. The UI calls this a resource; Query DSL calls it an entity. | `entity container:app-core` |
| `entity_type <type>` | all | Restrict results to one resource class such as host, container, service, device, order, or customer. | `entity_type container` |
| `where <key>=<value>` | all | Filter dimensions by exact equality. Separate multiple filters with commas. | `where env=prod, region=eu` |
| `limit <rows>` | events, states | Limit returned rows. Use a positive integer no larger than 1000. | `limit 100` |

## Aggregations {icon="point"}

Choose aggregation from the shape of the data, not from the chart you want. Gauges describe a value at a time, counters only grow, and latency distributions need percentiles.

| Aggregation | Meaning | Best for | Example |
| --- | --- | --- | --- |
| `avg` | Average samples in each bucket. | Gauges such as utilization, temperature, output, or quality scores. | `metric solar.output_watts avg every 15m since 7d` |
| `latest` | Latest value per series in each bucket. | Current gauges and status numbers. | `metric battery.charge_percent latest every 5m since 24h` |
| `min / max` | Smallest or largest sample in each bucket. | Dips, peaks, and capacity checks. | `metric inventory.stock_level max every 1h since 30d` |
| `sum` | Add samples in each bucket. | Combined totals across series. | `metric solar.output_watts sum every 5m since 24h` |
| `count` | Count samples, not their values. | Sample presence and collection checks. | `metric website.visitors count every 1h since 7d` |
| `rate` | Counter change per second, with resets clamped. | Requests/sec, bytes/sec, and throughput. | `metric http_requests_total rate every 1m since 1h` |
| `increase` | Counter increase inside each bucket. | Orders, visitors, requests, or bytes per bucket. | `metric sales.orders increase every 1h since 7d` |
| `p50 / p90 / p95 / p99` | Percentiles over samples in each bucket. | Latency and distribution metrics. | `metric http_request_duration_seconds p95 every 5m since 24h` |
| `events count / sum` | Count events or sum their numeric value in each bucket. | Visits, orders, errors, revenue, and other point-in-time facts. | `events order.created sum every 1h since 7d group by currency` |
| `events unique actor / session` | Count distinct first-class actorId or sessionId values in each bucket. | Visitors, active users, sessions, and engagement without high-cardinality dimensions. | `events page.viewed unique actor every 1d since 30d` |

## Rules that matter {icon="book-2"}

:::info Metrics aggregate samples
`metric` requires a metric and aggregation. Use `every` to choose buckets and `since` to define the time range.
:::

:::success Events return rows or points
`events` starts as table output. Add `count`, `sum`, `unique actor`, or `unique session` for SQL time-series aggregation. `states` returns current rows. Use `source`, `entity`, `entity_type`, `where`, and `limit` to narrow them.
:::

:::info Names and values
Use quotes when a metric, event, state, entity, or dimension value contains spaces, commas, or equals signs. Use `*` or omit the name for all events or all states.
:::

:::warning Performance limits
Metric queries fail when more than 250 series match. Add `source`, `entity`, or `where` filters. Raw event and state limits are capped at 1000 rows; event aggregations accept at most four group keys and return at most 1000 points.
:::
