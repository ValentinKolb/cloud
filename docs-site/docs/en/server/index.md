---
title: Server requests
navTitle: Overview
section: Server
order: 200
description: Follow one request from the gateway to a typed response.
tags: [server, hono, requests]
updated: 2026-07-27
---

# Server requests

Every Cloud application owns a Hono router.

The gateway selects the application. The application decides how the request is
handled.

## Request path

A normal JSON request passes through these layers:

| Layer | Responsibility |
| --- | --- |
| Gateway | Forward the original path to the registered service |
| App middleware | Load request context and apply transport policies |
| Route policy | Require an accepted caller or role |
| Validator | Convert untrusted input into typed values |
| Domain service | Check resource access and run business rules |
| Response helper | Convert `Result<T>` into JSON and a status code |

The route keeps those decisions visible:

```ts
.get(
  "/items/:id",
  auth.requireRole("authenticated"),
  v("param", ItemParamSchema),
  async (c) =>
    respond(
      c,
      inventory.read({
        id: c.req.valid("param").id,
        accessSubject: c.get("accessSubject"),
      }),
    ),
)
```

Authentication protects the route. The service still decides whether the caller
may read that item.

See [Identity and access](/docs/en/identity) before adding resource checks.

## Own the Hono router

`app.start()` receives a fetch handler:

```ts
const router = new Hono<InventoryAppContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/inventory", apiRoutes);

export default await app.start({
  fetch: router.fetch,
});
```

Cloud does not insert application middleware into this router.

The framework handles its own SSR assets, public assets, search provider route,
and optional OpenAPI document before forwarding other requests to the app
router.

See [Routes and service discovery](/docs/en/build/routing) for that boundary.

## Choose the context type

Use `AuthContext` for routes that need caller identity:

```ts
import type { AuthContext } from "@valentinkolb/cloud/server";

const routes = new Hono<AuthContext>();
```

Use `AppContext<typeof app>` when routes also read settings declared by the
application:

```ts
import type { AppContext } from "@valentinkolb/cloud/server";
import { app } from "../config";

export type InventoryAppContext = AppContext<typeof app>;
```

This context includes:

- `actor`, which records which credential acted;
- `accessSubject`, which identifies whose grants apply;
- `sessionToken`, when a session exists;
- the typed settings snapshot.

Do not build new features around `c.get("user")`. Use the actor helpers when a
feature specifically requires a user-backed caller.

See [Request identity](/docs/en/identity/authentication).

## Build the server in small steps

- [Compose request middleware](/docs/en/server/middleware).
- [Build, validate, and publish a typed HTTP endpoint](/docs/en/server/http).
- [Write a domain service](/docs/en/server/services-and-results).
- [Paginate and filter lists](/docs/en/server/pagination-and-filtering).
