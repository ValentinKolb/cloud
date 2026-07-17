---
id: pulse-operate
title: Operate
icon: ti ti-lifebuoy
description: Source health, retention, access, public displays, and common symptoms.
order: 140
---
Operation work in Pulse is about keeping data trustworthy: sources must be healthy, storage must stay bounded, access must be clear, and public displays must expose only the intended dashboard data.

## Routine checks

- **Source health:** Use Sources to verify the latest scrape or ingest, duration, errors, ingested counts, and token usage.
- **Retention and clear data:** Raw telemetry, hourly metric rollups, and classified sensitive event fields have independent retention. Sensitive expiry clears only the event's sensitive object; raw expiry removes the event. Clear telemetry to keep the base, sources, access, and settings while discarding collected data.
- **Access:** Base permissions control who can view, edit, or administer a base. Public dashboards are separate link-based read views.
- **Public displays:** A public display reads only the dashboard DSL output behind its UUID link. Use useful defaults because public viewers do not edit controls.

## HTTP ingest guarantees

- **Bounded batches:** One request accepts up to 500 metrics, 500 events, and 500 states, with at most 1,500 signals in total. Split larger payloads into separate requests.
- **Source-bound tokens:** Every ingest token belongs to one source. Pulse ignores source identifiers in the payload and records all signals under the authenticated source.
- **Retry-safe requests:** Send the same Idempotency-Key when retrying one batch. Pulse returns the original result for 24 hours and rejects reuse with different content.
- **Bounded metric cardinality:** One metric may have at most 10,000 series in a base. Move request IDs, sessions, full URLs, IPs, and other unbounded values to events instead of metric dimensions.

## Common symptoms

- **No data appears:** Check the source first. A source must scrape or ingest successfully before resources, signals, or dashboards can show data.
- **A query matches too much:** Open Inventory or the signal page, then add source, entity, entity_type, or where filters.
- **A chart is empty:** Check the time range and aggregation. Counters usually need rate or increase; gauges usually need avg or latest.
- **Rows look duplicated:** Open the resource or signal page. Repeated rows are usually variants with different resources or dimensions.
- **A metric hits the series limit:** Inspect its dimensions. Keep stable grouping labels, then move unbounded identities or event detail into an event's first-class identities, attributes, sensitive fields, or payload.
