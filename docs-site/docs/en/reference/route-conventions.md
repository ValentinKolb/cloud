---
title: Route conventions
navTitle: Route conventions
section: Reference
order: 1220
description: Look up the route prefixes reserved by Cloud and those owned by applications.
tags: [routes, gateway, prefixes]
updated: 2026-07-27
---

# Route conventions

Every application declares the URL prefixes it owns.

The gateway matches the longest registered prefix and proxies the unchanged
request to the application's `baseUrl`.

## Use standard application prefixes

| Prefix | Owner |
| --- | --- |
| `/app/<app-id>` | Authenticated application pages |
| `/api/<app-id>` | Application JSON API |
| `/admin/<app-id>` | Application administration |
| `/public/<app-id>/*` | Application static assets |

Declare only the prefixes the application serves.

An application with an anonymous page should declare a separate page prefix.
Do not place a page below `/public/<app-id>`; that path is for static files.

## Framework-owned paths

`app.start()` handles these before the application router:

| Path | Purpose |
| --- | --- |
| `<basePath>/_ssr/*` | Solid island chunks |
| `/public/*` | Static assets |
| `/api/_internal/search` | Search provider endpoint when enabled |
| the declared OpenAPI path | Generated OpenAPI document |

When an application has no `basePath`, its island chunks use `/_ssr/*`.

The gateway, Core, OAuth, and other platform applications also own special
top-level routes such as `/auth`, `/oauth`, and `/.well-known/...`.

Do not reuse a platform prefix.

## Match and normalize prefixes

A prefix must start with `/`.

A trailing slash is removed except for `/`. Query strings do not affect route
selection.

The gateway uses the longest matching segment path. For example,
`/app/inventory/admin` wins over `/app/inventory` when both are registered.

Exact duplicate prefixes are skipped and reported as route warnings. The first
application in the deterministic registry ordering keeps the prefix.

## Align route declarations

For an API, these values must describe the same public path:

1. `defineApp({ routes })`;
2. the Hono `.route()` mount;
3. the browser client's `baseUrl`;
4. the OpenAPI mount when present.

For a page, align the declared route, Hono page mount, and navigation `href`.

See [Routing](/en/docs/build/routing) for an application example.
