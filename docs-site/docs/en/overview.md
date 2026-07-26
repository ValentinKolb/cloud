---
title: Platform overview
navTitle: Overview
section: Start
order: 20
description: Understand the Cloud application model, platform boundary, and runtime request flow.
tags: [architecture, apps, runtime]
updated: 2026-07-26
---

# Platform overview

Cloud is an open-source, on-premises application platform. It provides the
cross-cutting capabilities that applications otherwise implement separately:
authentication, authorization, settings, notifications, logging, search,
shared UI, administration, and service discovery.

An application remains an independent Bun service with its own domain logic,
HTTP routes, frontend pages, lifecycle, and optional Postgres schema. Cloud
connects that service to the rest of the platform.

## The application boundary

Cloud separates platform semantics from application behavior.

| Cloud owns | An app owns |
| --- | --- |
| Accounts, sessions, actors, roles, and credentials | Domain resources and business rules |
| Resource permission primitives | Permission checks for its resources |
| Settings, notifications, logging, and search contracts | Definitions and implementations contributed to those contracts |
| Shared SSR shells, UI components, and navigation | Pages, islands, and interaction flows |
| Service registry and gateway routing | The URL prefixes it declares |
| Runtime lifecycle and graceful shutdown | Migrations, scheduled work, and cleanup hooks |

Auth flows, session semantics, roles, principals, and credentials belong to the
platform. An app can grant a principal access to one of its resources, but it
does not create a competing identity model.

## Runtime shape

The gateway holds one in-memory prefix trie, rebuilt from the registry. Nothing
below it is compiled in:

| Prefix | Upstream | Instances |
| --- | --- | --- |
| `/app/mail` | `app-mail:3000` | 1 |
| `/app/notebooks` | `app-notebooks:3000` | 3 |
| `/app/grids` | `app-grids:3000` | 1 |
| `/admin/gateway` | `app-gateway-ops:3000` | 1 |
| `/app/inventory` | `app-inventory:3000` | 2 |

Every upstream is a separate container. At startup it publishes a registry entry
containing its identity, internal base URL, declared routes, navigation
metadata, and optional capabilities, and it refreshes that entry every 60
seconds. An entry that stops being refreshed expires after 180 seconds and the
gateway drops it from the trie.

Upstreams reach Valkey for shared runtime state and, if they own durable data,
Postgres. Adding an app therefore changes the app and the deployment
configuration — never the gateway router.

## The app contract

`defineApp()` is the declaration boundary. It describes what the platform must
know about the service:

```ts
import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "inventory",
  name: "Inventory",
  icon: "ti ti-packages",
  description: "Track stock and warehouse movements.",
  basePath: "/app/inventory",
  baseUrl: "http://app-inventory:3000",
  nav: {
    href: "/app/inventory",
    section: "primary",
    requiresAuth: true,
  },
  routes: [
    "/api/inventory",
    "/app/inventory",
    "/admin/inventory",
    "/public/inventory",
  ],
});

export const { ssr, plugin } = app;
```

The app then composes its own Hono router. Cloud does not inject request
middleware implicitly:

```ts
import { type AuthContext, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { app } from "./config";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/inventory", apiRoutes)
  .route("/app/inventory", pageRoutes);

export default await app.start({
  fetch: router.fetch,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
});
```

`app.start()` registers the service, mounts framework-owned SSR and static asset
routes, starts declared capabilities, runs lifecycle hooks, and coordinates
graceful shutdown.

## Request identity

Authenticated requests resolve two related values:

- `actor` describes which credential performed the request.
- `accessSubject` describes whose resource grants apply.

Authorization uses `accessSubject`. This gives a browser session and a
user-bound API key the same effective access, while resource-bound service
accounts remain distinct principals. Application services should therefore
accept an access subject instead of a bare user ID.

## Data and process ownership

Most persistent apps own one Postgres schema and migrate it idempotently during
their setup lifecycle. Platform schemas such as `auth`, `settings`,
`notifications`, `logging`, and `audit` remain core-owned.

Valkey carries shared runtime state such as the app registry, sessions, caches,
rate limits, and distributed coordination. Durable application data belongs in
Postgres or another explicit application store, not in process memory.

Apps should remain stateless at the HTTP process boundary. This allows several
instances of one app to register concurrently and receive traffic through the
same route prefixes.

## Shared packages

Cloud builds on three focused packages:

| Package | Responsibility |
| --- | --- |
| `@valentinkolb/stdlib` | Results, mutations, formatting, browser helpers, and general utilities |
| `@valentinkolb/sync` | Topics, jobs, queues, schedulers, rate limits, and distributed coordination |
| `@valentinkolb/ssr` | SolidJS server rendering, islands, assets, and navigation |

Applications use these packages directly rather than reimplementing their
primitives inside the app.

The [Cloud repository](https://github.com/ValentinKolb/cloud) contains the
platform package, built-in applications, gateway, operations surfaces, and the
development stack.
