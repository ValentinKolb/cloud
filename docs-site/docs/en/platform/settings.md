---
title: Settings
navTitle: Settings
section: Platform APIs
order: 120
description: Declare typed runtime configuration and read it consistently inside or outside a request.
tags: [settings, configuration, typescript]
updated: 2026-07-26
---

# Settings

Use a setting when an operator should be able to change application behavior
without rebuilding the service. The application owns the key, type, default,
and UI metadata. Cloud validates values, stores overrides encrypted in
Postgres, and coordinates reads through a shared cache.

## Declare settings with the app

Settings use app-prefixed dotted keys. TypeScript derives both the flat async
API and the nested request snapshot from this declaration.

```ts
import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "inventory",
  name: "Inventory",
  icon: "ti ti-packages",
  description: "Track stock and warehouse movements.",
  baseUrl: "http://app-inventory:3000",
  routes: ["/api/inventory", "/app/inventory"],
  settings: {
    "inventory.low_stock_threshold": {
      kind: "number",
      label: "Low-stock threshold",
      description: "Warn when available stock falls below this number.",
      default: 5,
      min: 0,
      max: 10_000,
    },
    "inventory.digest_enabled": {
      kind: "boolean",
      label: "Daily digest",
      description: "Send one daily stock summary.",
      default: true,
    },
  },
});
```

Available kinds are `string`, `text`, `email`, `url`, `secret`, `image`,
`cron`, `timezone`, `template`, `boolean`, `number`, `enum`, `string_list`,
and `number_list`. Kind-specific fields such as `min`, `max`, `options`, and
`templateVars` are checked at the declaration boundary.

## Read one snapshot per request

Add the settings middleware to routes that need configuration and use
`AppContext<typeof app>` for the inferred shape:

```ts
import { type AppContext, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { app } from "./config";

const api = new Hono<AppContext<typeof app>>()
  .use("*", middleware.settings())
  .get("/api/inventory/config", (c) => {
    const settings = c.get("settings");
    return c.json({
      threshold: settings.inventory.low_stock_threshold,
      digestEnabled: settings.inventory.digest_enabled,
    });
  });
```

The nested object is read-only and stays unchanged for the lifetime of the
request. This prevents one handler from observing two configurations if an
operator changes a value while the request is running.

Cloud does not add the middleware implicitly. Scope it to the router or path
that reads settings; static asset paths do not need a snapshot.

## Read or write outside a request

Use the typed async API returned by `defineApp()` in lifecycle hooks, workers,
or other long-running code:

```ts
const threshold = await app.settings.get("inventory.low_stock_threshold");

await app.settings.set("inventory.low_stock_threshold", 10);

await app.settings.remove("inventory.low_stock_threshold");
```

`remove()` deletes the stored override. The next read resolves the environment
fallback or code default.

## Resolution and persistence

Cloud resolves each key in this order:

1. persisted value
2. `envFallback`, when defined
3. code default

`envBootstrap` is different: on the first boot without a persisted value, a
valid non-empty environment value is written into the settings store. Use it
only when an existing deployment must migrate environment configuration into
operator-managed settings. Use `envFallback` when the environment should
remain a fallback rather than become persisted state.

All containers in one deployment must use the same `APP_SECRET`; settings are
encrypted at rest. A write validates the value, updates Postgres, and
invalidates the shared cache. New requests then build a fresh snapshot.

## Ownership rules

- Prefix keys with the application ID.
- Declare a key once, in the application that owns its behavior.
- Keep secrets in `secret` settings, but do not return them to browser code.
- Use settings for runtime configuration, not domain records or per-user
  preferences.
- Use the request snapshot for normal handlers and the async API when fresh
  state is required during long-running work.
