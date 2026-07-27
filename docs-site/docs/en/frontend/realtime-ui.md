---
title: Realtime UI
navTitle: Realtime UI
section: Frontend
order: 870
description: Update an open page from application events while preserving reload and recovery behavior.
tags: [realtime, websocket, cursors]
updated: 2026-07-27
---

# Realtime UI

Realtime updates enhance a server-rendered page. They do not replace its
reload path.

Start with an authorized snapshot. Subscribe from that snapshot's cursor.
Apply each event, then advance the cursor.

## Connect a live WebSocket

```tsx
import { createLiveWebSocket } from "@valentinkolb/cloud/browser/live";
import { onCleanup, onMount } from "solid-js";

const live = createLiveWebSocket<InventoryEvent>({
  url: "/api/inventory/ws",
  initialCursor: props.cursor,
  subscribe: (cursor) => ({
    type: "subscribe",
    payload: { itemId: props.itemId, fromCursor: cursor },
  }),
  parse: (raw) => InventoryEventSchema.parse(JSON.parse(raw)),
  onMessage: (event, controls) => {
    applyEvent(event);
    controls.markApplied(event.cursor);
  },
  onFatal: (error) => setLiveError(error.message),
});

onMount(() => live.connect());
onCleanup(() => live.dispose());
```

The helper owns one socket, visibility-aware activity, reconnect backoff,
cursor resume, fatal close classification, and disposal.

The application owns authentication, subscription payloads, runtime
validation, permissions, and domain updates.

## Advance only after apply

Call `markApplied()` after the event has changed local state successfully.

If apply fails, do not advance. A reconnect can replay the event from the last
known good cursor.

When the server reports cursor overflow or the local state cannot reconcile,
reload the authorized snapshot.

## Handle access changes

The WebSocket route must authorize the subscription and every resource it
streams.

Close code `1008` is terminal by default and surfaces an access error. Do not
keep reconnecting after permission is lost.

Close codes `1011` and `1013` are also terminal by default. Return `null` from
a custom `classifyClose` handler only when the application can safely
reconnect.

## Preserve reload behavior

The URL must still identify the visible resource and view. A reload asks the
server for a fresh authorized result.

Do not keep the only copy of edits or selected resources in the socket client.

For server event semantics, see
[Topics and live events](/docs/en/automation/topics-and-live-events).
