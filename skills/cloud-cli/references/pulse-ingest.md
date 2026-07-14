# Pulse ingest

Pulse accepts metrics, events, and current states in one JSON batch. Signed-in agents can ingest through `cld pulse ingest`; long-running collectors should use a labeled token bound to an `http_ingest` source.

## Contents

- [Choose the ingest path](#choose-the-ingest-path)
- [Create an HTTP ingest source](#create-an-http-ingest-source)
- [Send a collector request](#send-a-collector-request)
- [Batch schema](#batch-schema)
- [Classify event data](#classify-event-data)
- [Model resources and variants](#model-resources-and-variants)
- [Retry safely](#retry-safely)
- [Limits and transaction behavior](#limits-and-transaction-behavior)
- [Inspect the result](#inspect-the-result)
- [Operational rules](#operational-rules)

## Choose the ingest path

| Path | Use it for | Source association | Retry idempotency |
| --- | --- | --- | --- |
| `cld pulse ingest` | A signed-in agent importing or testing a batch | None | No idempotency-key option |
| `POST /api/pulse/ingest` | Servers, jobs, importers, and collectors | Source bound to the token | Optional `Idempotency-Key` header |
| `metrics` source | Pulling a Prometheus-compatible `/metrics` endpoint | Configured metrics source | Scrape lifecycle handles collection |

Do not use a personal Cloud session in a long-running collector. Create an `http_ingest` source and one labeled token per deployment, server, importer, or job.

## Create an HTTP ingest source

```bash
cld pulse sources create --name "Warehouse importer" --kind http_ingest --json
cld pulse source-tokens create "Warehouse importer" \
  --name production-job \
  --expires-at 2027-01-01T00:00:00Z \
  --json
```

Token creation returns credential metadata and the raw token. The raw token is shown once. Store it in the collector's secret store before leaving the workflow.

Listing, creating, and revoking source tokens requires `admin` permission on the base. Creating or editing the source itself requires `write` permission.

Use separate tokens when credentials need separate expiration, usage visibility, or revocation. Tokens from one source all publish under that source.

```bash
cld pulse source-tokens list "Warehouse importer" --json
cld pulse source-tokens revoke "Warehouse importer" production-job --yes
```

## Send a collector request

```bash
curl -fsS -X POST "$CLOUD_URL/api/pulse/ingest" \
  -H "Authorization: Bearer $PULSE_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $BATCH_ID" \
  --data-binary @batch.json
```

Successful response:

```json
{
  "metrics": 2,
  "events": 1,
  "states": 1
}
```

The token determines the base and source. Any `sourceId` fields in the payload are ignored and cannot be used to impersonate another source.

For a one-off signed-in import:

```bash
cld pulse ingest --file batch.json --json
cat batch.json | cld pulse ingest --stdin --json
```

`cld pulse ingest` requires write access to the selected base. It uses the authenticated internal endpoint and records signals without an associated source. Prefer source-token ingest when source attribution matters.

## Batch schema

All three collections are optional, but the batch must contain at least one item.

```json
{
  "metrics": [],
  "events": [],
  "states": []
}
```

### Metrics

```json
{
  "name": "sales.orders.total",
  "value": 142,
  "ts": "2026-07-12T12:00:00.000Z",
  "type": "counter",
  "unit": "count",
  "entityId": "store:berlin",
  "entityType": "store",
  "dimensions": {
    "channel": "web"
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | Yes | Non-empty metric name. |
| `value` | Yes | Finite number. `NaN` and infinities are rejected. |
| `ts` | No | ISO datetime. Server time is used when omitted. |
| `type` | No | `gauge`, `counter`, `histogram`, or `summary`; defaults to `gauge`. |
| `unit` | No | Non-empty unit string or null. Common units are formatted automatically by dashboards. |
| `entityId` | No | Stable observed-object identifier. |
| `entityType` | No | Resource class such as `host`, `container`, `store`, or `customer`. |
| `dimensions` | No | Exact-match labels distinguishing variants. |
| `sourceId` | No | Accepted for schema compatibility but overridden by the authenticated ingest path. |

A metric variant is identified by metric name, authenticated source, resource identity, and normalized dimensions. Sending the same variant and timestamp again updates that sample rather than creating a second sample. Keep type and unit stable for one metric name: the first observed type remains the metric definition, while a later non-null unit can update its unit.

One metric may have at most 10,000 series in one base. Values such as visitor IDs, request IDs, session IDs, full URLs, timestamps, or IP addresses create unbounded series and belong in events instead. Pulse rejects a batch that would exceed the metric's series budget.

### Events

```json
{
  "kind": "order.created",
  "ts": "2026-07-12T12:00:00.000Z",
  "value": 149.9,
  "entityId": "order:1234",
  "entityType": "order",
  "actorId": "customer:42",
  "sessionId": "checkout-session-8",
  "correlationId": "checkout-1234",
  "resource": {
    "type": "store",
    "id": "berlin",
    "label": "Berlin store"
  },
  "dimensions": {
    "channel": "web",
    "currency": "EUR"
  },
  "attributes": {
    "orderId": "order:1234",
    "targetUrl": "https://shop.example/orders/1234"
  },
  "sensitive": {
    "ipHash": "sha256:7d8f...",
    "geo": { "country": "DE", "city": "Berlin" }
  },
  "payload": {
    "lineItems": [{ "sku": "sku-42", "quantity": 3 }]
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `kind` | Yes | Non-empty event kind. |
| `ts` | No | Event ISO datetime; server time is used when omitted. |
| `value` | No | Optional finite numeric value or null. |
| `entityId`, `entityType` | No | Resource the event concerns. |
| `actorId` | No | Actor responsible for the event. |
| `sessionId` | No | Session grouping related events. |
| `correlationId` | No | Identifier joining one process across events. |
| `resource` | No | Explicit stable resource `{ type, id, label? }` for inventory and resource scoping. |
| `dimensions` | No | Bounded exact-match labels used by `where` and `group by`. |
| `attributes` | No | Discoverable, returned JSON for irregular or high-cardinality event fields. |
| `sensitive` | No | Classified JSON with independent short retention; never returned by normal event queries. |
| `payload` | No | Opaque event-specific JSON returned with raw event rows but not cataloged by field. |
| `sourceId` | No | Overridden by the authenticated ingest path. |

`actorId`, `sessionId`, and `correlationId` are stored as first-class identities. Query DSL can count unique actors and sessions without normalizing them as dimensions. Raw event rows intentionally omit all three identities, while `correlationId` is retained for internal correlation and future query capabilities.

## Classify event data

Classify fields by how Pulse must use and retain them. Do not duplicate one value across roles unless two distinct user questions require it.

| Role | Put here | Do not put here |
| --- | --- | --- |
| `dimensions` | Stable fields users repeatedly filter or group by: campaign, channel, country, outcome | Request IDs, visitor IDs, full URLs, timestamps, raw IPs |
| `attributes` | High-cardinality or irregular fields that should remain visible on raw events: full URL, referrer, user agent, order ID | Secrets or fields requiring shorter retention |
| `sensitive` | Raw IP, precise geolocation, or other classified event data | Data required after sensitive retention expires |
| `payload` | Nested domain payload that should be returned as one opaque object | Fields that must appear in the field catalog or be grouped in SQL |

Example for a QR redirect:

```json
{
  "kind": "qr.opened",
  "actorId": "visitor:hashed-123",
  "sessionId": "session:456",
  "correlationId": "request:789",
  "resource": { "type": "qr_code", "id": "summer-poster-a", "label": "Summer poster A" },
  "dimensions": { "campaign": "summer", "channel": "poster", "country": "DE" },
  "attributes": {
    "targetUrl": "https://example.com/products/123?utm_source=poster",
    "referrer": "https://example.org/"
  },
  "sensitive": {
    "ipHash": "sha256:7d8f...",
    "geo": { "city": "Berlin", "latitude": 52.52, "longitude": 13.4 }
  },
  "payload": { "redirectStatus": 302 }
}
```

This shape keeps campaign reporting fast while retaining individual URLs and classified location data without creating a metric series or resource per visit.

Field limits are part of the public ingest contract:

- `dimensions`: at most 32 keys; keys at most 80 characters; stringified values at most 500 characters.
- `attributes`: at most 64 top-level keys, 32 KiB encoded JSON, and 4 nested levels.
- `sensitive`: at most 32 top-level keys, 32 KiB encoded JSON, and 4 nested levels.
- `payload`: at most 64 KiB encoded JSON and 8 nested levels.

Pulse catalogs event field names, roles, observed value types, and counts. It does not copy every high-cardinality field value into catalog tables or create automatic JSON indexes.

### States

```json
{
  "key": "store.online",
  "value": true,
  "ts": "2026-07-12T12:00:00.000Z",
  "entityId": "store:berlin",
  "entityType": "store",
  "dimensions": {
    "region": "eu-central"
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `key` | Yes | Non-empty state key. |
| `value` | Yes | String, number, boolean, or null. |
| `ts` | No | State-change ISO datetime; server time is used when omitted. |
| `entityId`, `entityType` | No | Resource whose current state is being set. |
| `dimensions` | No | Labels distinguishing independently current state variants. |
| `sourceId` | No | Overridden by the authenticated ingest path. |

States represent current truth. Sending the same key, resource identity, and dimensions replaces the current value. Pulse records state history only for the initial value and real value changes; repeated equal snapshots update the current row without adding another transition. Source is not part of current-state identity, so a matching update from another source also becomes the current value. Query DSL `states` returns current rows, not the state-change history.

### Dimension values

Input dimension values may be strings, numbers, booleans, or null. Pulse trims keys, drops null and undefined values, converts remaining values to strings, and sorts keys before storing them.

Prefer stable, bounded dimensions that answer real filtering or grouping questions. Event dimensions may have more distinct values than metric dimensions, but arbitrary high-cardinality detail still belongs in event attributes. Never encode timestamps, request IDs, sessions, full URLs, or IP addresses as metric dimensions.

## Model resources and variants

Resource modeling determines whether the Pulse UI remains understandable.

Use this split:

- `entityId`: stable identity of the observed object.
- `entityType`: reusable class of that object.
- `dimensions`: labels that distinguish or filter variants without replacing identity.
- metric/event/state name: the fact being observed, not the object name.

Good container example:

```json
{
  "name": "docker.container.cpu.usage",
  "value": 12.4,
  "unit": "percent",
  "type": "gauge",
  "entityId": "host-01/f06a6893f7bd",
  "entityType": "container",
  "dimensions": {
    "host": "host-01",
    "container": "app-core",
    "container_id": "f06a6893f7bd",
    "compose_project": "cloud",
    "compose_service": "app-core"
  }
}
```

Do not put the container name into the metric name. One stable metric name with one resource per container lets users browse a host, open a container, and see all its signals.

Pulse first derives known resource shapes from signal prefixes and dimensions. For Docker container signals, `host` plus `container_id` is the stable identity and `container` is the display label. It also recognizes Compose service/project, filesystem, network, host (`host`, `instance`, or `node`), and service shapes. When no known shape matches, Pulse uses explicit `entityId` and `entityType`, then falls back to a host, service, or source resource.

This inference is a compatibility aid, not a substitute for deliberate modeling. New collectors should send stable entity fields and the expected identity dimensions consistently. For recognized Docker signals, ensure those dimensions describe the same object as the entity fields.

Keep identity consistent across metrics, events, and states so Pulse groups all signals under the same resource.

Only stable observed objects should become resources. A website, campaign, QR code, host, container, service, customer, or order can be a resource when users browse it as an object. Do not create resources for individual page views, visits, sessions, requests, IP addresses, or timestamps.

## Retry safely

External source-token ingest supports `Idempotency-Key`:

```bash
-H "Idempotency-Key: collector-01-2026-07-12T12:00:00Z"
```

Rules:

- A key is scoped to one source.
- The key may contain at most 200 characters.
- Pulse marks the request record to expire after 24 hours and retains it until the expiration cleanup removes it.
- Repeating the same key with the same batch returns the original counts without writing again.
- Reusing the key with different content returns HTTP `409 Conflict`.
- Do not deliberately reuse old keys; an expired key remains reserved until cleanup runs.

Generate one deterministic key per logical batch and keep it unchanged across retries. Do not generate a new key for each retry attempt.

`cld pulse ingest` does not currently expose an idempotency-key flag. Use it only when the caller can tolerate a deliberate retry strategy or when the batch's own metric timestamps make repeated metric samples harmless; repeated events are separate rows.

## Limits and transaction behavior

- At most 500 metrics, 500 events, and 500 states per request.
- At most 1,500 total items per request.
- The batch must not be empty.
- Metric values and event numeric values must be finite.
- Timestamps must parse as datetimes.
- Idempotency keys may not exceed 200 characters.
- One metric may have at most 10,000 series per base.
- Event field objects must satisfy the key, byte, and nesting limits in [Classify event data](#classify-event-data).

The externally reachable API schema applies these limits to both source-token requests and `cld pulse ingest`.

Each accepted batch is written in one database transaction. Validation or persistence failure rolls back the complete batch; Pulse does not report partial success.

Split larger collector output into bounded batches. Give each batch its own idempotency key.

## Inspect the result

Check source health before changing queries:

```bash
cld pulse sources list --json
cld pulse source-tokens list "Warehouse importer" --json
cld pulse resources list --source "Warehouse importer" --limit 100 --json
cld pulse metrics --source "Warehouse importer" --limit 100 --json
cld pulse events --source "Warehouse importer" --limit 100 --json
cld pulse states --source "Warehouse importer" --limit 100 --json
cld pulse fields list --source "Warehouse importer" --scope event --json
```

HTTP ingest updates the source's `lastSeenAt` and the credential's `lastUsedAt`. Prometheus scrape attempts additionally appear in `sources scrapes`; push-ingest requests do not create scrape-attempt rows.

`fields list` shows observed field names, roles, value types, and counts without retaining catalog copies of their values. Confirm that resources, dimensions, field roles, units, and signal names match the intended model before building queries or dashboards.

Verify one modeled resource end to end:

```bash
cld pulse resources get "container:host-01/f06a6893f7bd" --json
cld pulse resources metrics "container:host-01/f06a6893f7bd" --json
cld pulse resources states "container:host-01/f06a6893f7bd" --json
cld pulse resources events "container:host-01/f06a6893f7bd" --json
```

## Operational rules

- Use one source for one logical integration boundary; use multiple labeled tokens for independently revocable deployments of that integration.
- Use separate sources when ownership, health, provenance, or access to credentials must be distinguishable.
- Keep source tokens out of logs, shell history, documentation, Dashboard DSL, and saved queries.
- Revoke a token before deleting a collector deployment.
- Check `lastSeenAt` and token `lastUsedAt` when data stops arriving.
- Use `clear-data` to remove telemetry while preserving sources, credentials, dashboards, saved queries, settings, and access.
- Configure raw telemetry, hourly metric rollups, and sensitive event fields independently. When sensitive retention expires, Pulse clears only the event's `sensitive` object; the remaining event follows raw retention.
- Deleting a source makes its source-bound credentials unusable and removes source metadata, but retained historical telemetry loses its source association rather than being deleted.

Return to the [Pulse CLI reference](pulse.md) for base discovery, queries, dashboards, access, and lifecycle operations.
