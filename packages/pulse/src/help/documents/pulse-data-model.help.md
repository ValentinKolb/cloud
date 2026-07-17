---
id: pulse-data-model
title: Data model
icon: ti ti-stack-2
description: How sources, resources, signals, variants, and dimensions fit together.
order: 105
---
Pulse uses a small data model so different domains can share one query and dashboard language. Learn the nouns in the order you meet them while browsing data.

## The path from ingest to chart

- **Base:** A workspace with its own access, retention, sources, dashboards, and saved queries.
- **Source:** One input connection, such as a metrics endpoint, token-backed ingest source, or internal app integration.
- **Resource:** The observed object: host, container, device, customer, order, store, service, battery, or any domain object.
- **Signal:** A named metric, event, or state. The name says what happened or what was measured.
- **Variant:** One concrete signal shape for one source/resource/dimension set. Variants explain why one signal can have many rows or lines.
- **Dimension:** A label on a variant, such as region, route, device, compose_service, channel, or customer_tier.

## How to read repeated rows

- **Same signal, different resources:** `docker.container.cpu.usage` can appear once per container. Open the signal to see variants, or open the resource to see only one container.
- **Same resource, different dimensions:** A filesystem metric may appear once per mount. The dimensions show which mount, interface, route, region, or channel the row represents.
- **Same source, different domains:** A source can publish infrastructure data today and business events tomorrow. Pulse does not assume a fixed domain vocabulary.

## Choose the right signal type

- **Metric: a bounded numeric time series:** Use metrics for repeated measurements such as CPU usage, power, latency, or revenue. Keep dimensions bounded: one metric may have at most 10,000 series in a base.
- **Event: something happened:** Use events for visits, QR opens, orders, requests, deployments, and other point-in-time facts. Events can carry high-cardinality detail without creating metric series.
- **State: what is true now:** Use states for online status, current version, operating mode, or another latest value. Pulse adds history only when the value actually changes.

## Classify event fields

- **Dimensions filter and group:** Use bounded labels such as campaign, channel, country, outcome, or environment. Query DSL where and group by operate on dimensions.
- **Attributes retain high-cardinality detail:** Use attributes for full URLs, request IDs, referrers, user agents, and irregular event detail that should remain visible on raw events.
- **Sensitive fields expire independently:** Use sensitive for raw IPs, precise geodata, and classified event data. Normal event results never expose it, and Pulse clears it before the remaining event expires.
- **Payload stays opaque:** Use payload for nested domain data that should be returned as one object but does not need field discovery, filtering, or grouping.
- **The field catalog stores shape, not values:** Inventory records observed dimension, attribute, and sensitive field names, roles, value types, counts, and timestamps. It does not copy their values into the catalog.
- **Identities support analytics:** Use actorId, sessionId, and correlationId for high-cardinality identities. Pulse can count unique actors and sessions without turning them into dimensions.
- **Resources stay stable:** Create resources for browsable objects such as a campaign, QR code, host, or service. A visit, session, request, timestamp, or IP address is not a resource.

:::note Resource in the UI, entity in the DSL
The UI says resource because it is easier to read. Query DSL uses `entity` for the same identifier and `entity_type` for the resource class. For example, `entity container:app-core` means one resource; `entity_type container` means all container resources.
:::
