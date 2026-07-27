---
title: Routes and service discovery
navTitle: Routes and discovery
section: Build an app
order: 140
description: Publish route prefixes and make an application reachable through the gateway.
tags: [applications, routing, gateway, registry]
updated: 2026-07-27
---

# Routes and service discovery

An application declares its upstream address and public path prefixes. The
gateway builds its route table from those declarations.

## Declare only served prefixes

```ts
export const app = defineApp({
  // required metadata
  baseUrl: "http://app-inventory:3000",
  routes: [
    "/api/inventory",
    "/app/inventory",
    "/admin/inventory",
    "/public/inventory",
  ],
});
```

The common prefixes are:

| Prefix | Content |
| --- | --- |
| `/api/<id>` | HTTP APIs and WebSocket upgrades |
| `/app/<id>` | Application pages |
| `/admin/<id>` | Administration pages |
| `/public/<id>` | Built CSS and other application assets |

An API-only application needs only its API prefix. Applications with special
public paths declare those exact paths.

See [Route conventions](/docs/en/reference/route-conventions).

> **Do not serve HTML below `/public`.** Cloud handles `/public/*` before the
> application router and returns a terminal asset response. Use a separate
> prefix such as `/share/<id>` for anonymous pages.

## Mount the same paths in Hono

The gateway preserves the original path:

```ts
const router = new Hono()
  .route("/api/inventory", apiRoutes)
  .route("/app/inventory", pageRoutes);
```

Declaring a prefix does not create a Hono route. Mounting a Hono route does not
publish it to the gateway.

## Internal service address

`baseUrl` is the address used by the gateway:

```ts
baseUrl: "http://app-inventory:3000",
```

The hostname normally matches the Compose or Kubernetes service name.

Do not use `localhost` when the gateway runs in another container.
`localhost` would refer to the gateway container itself.

## Path matching

The gateway selects the longest registered prefix.

Given:

```text
/api
/api/inventory
```

`/api/inventory/items` uses `/api/inventory`.

`/api/inventory-old` does not match `/api/inventory` because matching stops at
path-segment boundaries.

Route prefixes must begin with `/`. A trailing slash is removed. If two
applications declare the same prefix, the gateway keeps one route and reports
the duplicate.

## Service registration

`app.start()` writes one registry entry containing:

- application identity and `baseUrl`;
- route prefixes;
- navigation and administration links;
- optional search, widget, setting, legal-link, and OpenAPI metadata.

The application refreshes the entry while it runs. A clean shutdown removes
it. The gateway watches the registry and rebuilds its route table when entries
change.

No static gateway rule is required for each application.

## Diagnose an unreachable route

Check the path in this order:

1. Confirm the application process is running.
2. Confirm `app.start()` completed.
3. Resolve `baseUrl` from the gateway container.
4. Confirm the prefix is listed in `routes`.
5. Confirm the same path is mounted in Hono.
6. Check for a duplicate-prefix warning in gateway logs.

For a local source checkout:

```bash
bun run dev:status
bun run dev:logs inventory
```

See [Operations troubleshooting](/docs/en/operations/troubleshooting) for
registry and container failures.

## Protect the destination

The gateway selects an upstream. It does not authenticate or authorize the
request.

Use:

- [Route policies](/docs/en/identity/route-policies) for caller classes;
- [Resource authorization](/docs/en/identity/authorization) for domain access;
- [Public access](/docs/en/identity/public-and-anonymous-access) for anonymous
  routes.
