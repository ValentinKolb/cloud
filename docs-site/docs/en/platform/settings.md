---
title: Settings
navTitle: Settings
section: Platform services
order: 510
description: Define application settings and access them in requests, jobs, and lifecycle hooks.
tags: [settings, configuration, typescript]
updated: 2026-07-26
---

# Settings

Use settings for configuration that operators can change at runtime.

The application defines each key, type, default, and form label. Cloud
validates and stores the value. Cloud also keeps reads consistent across app
instances.

## Declare settings

Prefix every key with the application ID. Cloud derives the TypeScript API from
this declaration.

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

Choose the kind that matches the runtime value. Every definition requires
`kind` and `default`.

[Settings kinds and environment](/docs/en/reference/settings-kinds-and-environment)
lists every kind, field, validation rule, and environment option.

## Access settings

Add `middleware.settings()` to the router. Then read settings from the request
context:

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

The object is read-only. Its values do not change during the request.

Cloud does not add this middleware automatically. See
[Request middleware](/docs/en/server/middleware) for the full middleware list
and the recommended order.

## Access settings outside a request

Use the async app API in lifecycle hooks, workers, and jobs:

```ts
const threshold = await app.settings.get("inventory.low_stock_threshold");

await app.settings.set("inventory.low_stock_threshold", 10);

await app.settings.remove("inventory.low_stock_threshold");
```

`remove()` deletes the stored override. The next read uses the fallback or
default.

The server API validates writes against the declaration. It rejects unknown
keys and values of the wrong type.

## Setting precedence

Cloud resolves each key in this order:

1. persisted value
2. `envFallback`, when defined
3. code default

`envBootstrap` copies an environment value at startup when no persisted value
exists. Use it to migrate existing environment configuration.

Use `envFallback` when the environment should remain a fallback.

All app instances must use the same `APP_SECRET`. Cloud encrypts stored values
with that secret. See
[Runtime configuration](/docs/en/operations/runtime-configuration) for
deployment-wide environment variables.

## Setting ownership

- Prefix keys with the application ID.
- Declare a key once, in the application that owns its behavior.
- Keep secrets in `secret` settings, but do not return them to browser code.
- Use settings for runtime configuration, not domain records or per-user
  preferences.
- Use the request context in handlers.
- Use the async API outside requests.
