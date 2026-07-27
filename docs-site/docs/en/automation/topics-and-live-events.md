---
title: Topics and live events
navTitle: Topics and live events
section: Automation
order: 640
description: Publish transient events to application processes and connected browsers.
tags: [topics, events, realtime]
updated: 2026-07-27
---

# Topics and live events

Use a topic when several consumers need an ordered event stream.

A consumer group provides at-least-once work distribution. A live reader
provides best-effort fan-out for connected clients.

## Publish an event

```ts
import { topic } from "@k2b/sync";

const inventoryEvents = topic<{
  type: "item.updated";
  itemId: string;
}>({
  id: "inventory.events",
  retentionMs: 7 * 24 * 60 * 60 * 1_000,
});

const published = await inventoryEvents.pub({
  data: { type: "item.updated", itemId },
  idempotencyKey: `item:${itemId}:${version}`,
});
```

The result contains an event ID and cursor. An idempotency key deduplicates a
repeated publish within its TTL.

## Consume durable events

```ts
const reader = inventoryEvents.reader("search-index");

for await (const delivery of reader.stream({ signal })) {
  await updateSearchIndex(delivery.data.itemId);
  await delivery.commit();
}
```

One consumer in the group receives each event. Another group gets its own
copy.

A crash can leave a delivery pending. Call `reclaim()` before the long-running
loop and process idle pending entries. Continue with the returned cursor until
it returns `0-0`.

Malformed payloads are acknowledged by default. Use `invalidPayload: "throw"`
only when the application has a deliberate poison-message policy.

## Stream live updates

```ts
const after =
  (await inventoryEvents.latestCursor()) ?? "0-0";

for await (const event of inventoryEvents.live({ after, signal })) {
  sendToBrowser(event.data);
}
```

Every live listener receives the event. Delivery has no acknowledgement and
may be lost while a listener is disconnected or slow.

Use a cursor to replay retained events after reconnect. `live()` does not
report that an older cursor was trimmed. Load a fresh authorized snapshot on
reconnect when a complete view matters.

Use [Realtime UI](/docs/en/frontend/realtime-ui) for the browser integration.
Use a queue or consumer group when processing cannot be lost.

The generic supplies TypeScript types but no runtime payload validation.
