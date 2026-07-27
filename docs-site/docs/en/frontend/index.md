---
title: Frontend
navTitle: Overview
section: Frontend
order: 800
description: Choose the server-rendered and interactive frontend tools for a Cloud application.
tags: [frontend, ssr, solidjs]
updated: 2026-07-27
---

# Frontend

Cloud pages render on the server. Islands add browser behavior where a page
needs it.

The server owns result sets, permissions, and durable view state. The browser
owns user intent, transient interaction state, and API calls caused by that
intent.

## Choose the page shape

Start with:

- [SSR pages and routing](/docs/en/frontend/ssr-pages-and-routing) to render a
  route;
- [Layout and navigation](/docs/en/frontend/layout-and-navigation) to place it
  in Cloud;
- [Application shells](/docs/en/frontend/application-shells) to choose the
  shared content structure;
- [Islands and hydration](/docs/en/frontend/islands-and-hydration) when part of
  the page needs browser state.

Use the URL for filters, sorting, pagination, selection, and the active view.
See [URL state and navigation](/docs/en/frontend/url-state-and-navigation).

## Server-authoritative results

Do not filter, sort, paginate, group, or aggregate a server result set in the
browser.

The browser usually holds one page of rows. A client-side filter would be
incomplete. It would also bypass the SQL permission conditions that produced
the result.

Use this loop:

```text
user intent → URL → SSR or typed route-state API → authorized query → UI
```

Small, fully loaded option lists and transient UI state may stay local.

## Use the shared boundaries

| Import | Runtime |
| --- | --- |
| `@valentinkolb/cloud/ssr` | Server layouts and URL filters |
| `@valentinkolb/cloud/ui` | Shared SolidJS components |
| `@valentinkolb/cloud/browser` | Typed Hono API clients |
| `@valentinkolb/cloud/browser/live` | Browser WebSocket lifecycle |
| `@valentinkolb/stdlib/solid` | Mutation and timing helpers |

Do not import server barrels into an island. They pull Bun and database code
into the browser bundle.

Use the [component catalog](/ui) for visual examples and
[Component catalog guidance](/docs/en/frontend/component-catalog) for choosing
a primitive.
