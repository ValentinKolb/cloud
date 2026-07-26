---
title: Typed notifications
navTitle: Notifications
section: Platform APIs
order: 140
description: Define typed application events and let Cloud route, persist, and deliver them.
tags: [notifications, email, browser]
updated: 2026-07-26
---

# Typed notifications

An application defines **why** a person should be notified and how the event is
presented. Cloud owns recipient resolution, preferences, channel routing,
durable delivery, retries, deduplication, and notification history.

## Define notification kinds

Keep definitions in a small application module and validate every payload with
Zod:

```ts
import { notification } from "@valentinkolb/cloud";
import { z } from "zod";

export const NOTIFICATIONS = {
  stockLow: notification({
    recipient: "user",
    label: "Low stock",
    description: "Warns inventory owners when an item falls below its threshold.",
    delivery: { recommended: ["browser", "email"] },
    data: z.object({
      itemId: z.string(),
      itemName: z.string(),
      remaining: z.number().int().nonnegative(),
    }),
    render: ({ itemId, itemName, remaining }) => ({
      title: `${itemName} is running low`,
      body: `${remaining} units remain.`,
      targetHref: `/app/inventory/items/${encodeURIComponent(itemId)}`,
    }),
    email: ({ itemName, remaining }) => ({
      subject: `${itemName} is running low`,
      content: `${remaining} units remain.`,
    }),
  }),
};
```

Register the map with the app:

```ts
export const app = defineApp({
  // ...
  notifications: NOTIFICATIONS,
});
```

`defineApp()` binds a stable application-qualified ID such as
`inventory.stockLow` and preserves the recipient and payload types on
`app.notifications.stockLow`.

## Choose the recipient model

| Recipient | Address with | Delivery policy |
| --- | --- | --- |
| `user` | `{ userId }` | User preferences select from recommended channels; required channels always apply |
| `email` | `{ email }` | Email must be listed as a required channel |

Use a user recipient for product notifications tied to a Cloud account. Use an
email recipient for an address-first flow such as an invitation or sign-in
link.

`render()` produces the channel-neutral title, optional body, and optional
target. `targetHref` must be a canonical same-origin absolute path beginning
with `/`. Put sensitive details behind that authenticated destination instead
of embedding them in a browser notification.

## Send after the domain change commits

```ts
import { notifications } from "@valentinkolb/cloud/services";
import { app } from "./config";

await notifications.send(app.notifications.stockLow, {
  recipient: { userId: ownerId },
  data: {
    itemId,
    itemName,
    remaining,
  },
  idempotencyKey: `stock-low:${itemId}:${thresholdVersion}`,
});
```

The definition controls the accepted recipient and payload shape. The runtime
parses the payload again before persistence.

Every logical event needs a stable `idempotencyKey`. Repeating the same
definition, recipient, and key returns the existing event instead of creating
another notification. Derive the key from domain identity or a committed
transition, not from the current time.

Send only after the business transaction commits. Notification rows describe
delivery; they must not become the only record that a domain transition
happened. Recovery code can safely retry from domain state when it reuses the
same idempotency key.

## Understand the result

`notifications.send()` returns the event ID, whether the event was newly
created, the summarized status, and the individual channel deliveries.

| Status | Meaning |
| --- | --- |
| `queued` | At least one delivery is waiting or running |
| `delivered` | At least one delivery completed and no required delivery failed |
| `suppressed` | No selected channel could or should deliver the event |
| `error` | A required delivery failed or could not be prepared |

Recommended channels may be disabled by user preferences. Required channels
express protocol behavior that cannot be opted out of, so use them sparingly.

## Avoid the legacy send APIs

Do not use the email-only `notifications.send({ type: "email", ... })`
overload or `notifications.sendToUser()`. Both are deprecated and emit a
warning on every call. They bypass the typed definition catalog and the normal
preference and delivery model.

New application code should always declare a notification kind, register it
with `defineApp()`, and call the typed `notifications.send(definition, input)`
overload.
