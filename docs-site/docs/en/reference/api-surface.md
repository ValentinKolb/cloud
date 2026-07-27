---
title: API surface
navTitle: API surface
section: Reference
order: 1205
description: Choose a supported Cloud import and check its runtime and stability.
tags: [api, imports, boundaries, compatibility]
updated: 2026-07-27
---

# API surface

Cloud separates APIs by runtime. Use the entry point for the code you are
writing.

## Application entry points

| Entry point | Status | Use |
| --- | --- | --- |
| `@valentinkolb/cloud` | Supported | Application declarations and typed notifications |
| `@valentinkolb/cloud/server` | Supported, server-only | Hono middleware, validation, actors, results, and access |
| `@valentinkolb/cloud/services` | Supported, server-only | Platform services and lifecycle helpers |
| `@valentinkolb/cloud/contracts` | Supported | Browser-safe schemas and shared data contracts |
| `@valentinkolb/cloud/browser` | Supported, browser | Typed Hono browser clients |
| `@valentinkolb/cloud/ui` | Supported, SolidJS | Shared SolidJS components |
| `@valentinkolb/cloud/ssr` | Supported, server-only | Layouts, runtime context, and URL filters |
| `@valentinkolb/cloud/workflows` | Supported | Workflow definitions and authoring contracts |
| `@valentinkolb/cloud/ai` | Supported, server-only | AI resources, routes, tools, and runtime |
| `@valentinkolb/cloud/cli` | Supported | Cloud CLI modules |
| `@valentinkolb/cloud/config` | Supported, server-only | Parsed process environment |

Use subpath imports only when a guide names them. This keeps code on the
supported application surface.

## Define the application

Import `defineApp()` from the package root:

```ts
import { defineApp } from "@valentinkolb/cloud";
```

The root also exports the types bound to an application declaration. This
includes typed settings and notification definitions.

See [Define an application](/docs/en/build/define-app).

## Handle server requests

Import request APIs from `@valentinkolb/cloud/server`:

```ts
import {
  type AppContext,
  auth,
  middleware,
  respond,
  v,
} from "@valentinkolb/cloud/server";
```

This entry point contains Hono context types, middleware, actor helpers,
validation, resource access, and response helpers.

See [Server APIs](/docs/en/server) for the request path.

## Use platform services

Code outside an HTTP request uses asynchronous service APIs:

```ts
import { logger } from "@valentinkolb/cloud/services";

const log = logger("inventory");
log.info("Import completed", { itemCount: 42 });
```

Use the capability guide to choose the narrow API:

- [Settings](/docs/en/platform/settings)
- [Notifications](/docs/en/platform/notifications)
- [Logging](/docs/en/platform/logging)
- [Search](/docs/en/platform/search)

## Share types with the browser

Export the Hono router type from the server. Use it with the browser client.

```ts
import { api } from "@valentinkolb/cloud/browser";
import type { InventoryApi } from "../server";

export const inventoryApi = api.create<InventoryApi>({
  baseUrl: "/api/inventory",
});
```

See [Browser clients and mutations](/docs/en/frontend/browser-clients-and-mutations).

## Specialized entry points

| Entry point | Status | Use |
| --- | --- | --- |
| `@valentinkolb/cloud/ai/solid` | Supported, browser | AI chat controller |
| `@valentinkolb/cloud/ai/ui` | Supported, SolidJS | Shared AI chat components |
| `@valentinkolb/cloud/browser/live` | Supported, browser | Live WebSocket transport |
| `@valentinkolb/cloud/browser/notifications` | Supported, browser | Browser notification state |
| `@valentinkolb/cloud/clients/core` | Supported | Typed client for the Core platform API |
| `@valentinkolb/cloud/workflows/language` | Supported | Workflow language parser and authoring |
| `@valentinkolb/cloud/workflows/runtime` | Supported, server-only | Workflow runtime |
| `@valentinkolb/cloud/workflows/store` | Supported, server-only | Durable workflow store and workers |
| `@valentinkolb/cloud/workflows/testing` | Supported, tests | Workflow test helpers |
| `@valentinkolb/cloud/ssr/islands` | Specialized | Shared SSR island helpers |
| `@valentinkolb/cloud/ssr/*` | Advanced | Named SSR modules; prefer the barrel |
| `@valentinkolb/cloud/ui/workflow-authoring` | Specialized | Workflow authoring controls |
| `@valentinkolb/cloud/ui/styles.css` | Supported asset | Shared global stylesheet |
| `@valentinkolb/cloud/styles/global.css` | Supported asset | Alias for the global stylesheet |
| `@valentinkolb/cloud/cli/access` | Supported | Resource access commands |
| `@valentinkolb/cloud/cli/account` | Supported | Account commands |
| `@valentinkolb/cloud/cli/apps` | Supported | Application commands |
| `@valentinkolb/cloud/cli/admin` | Supported | Platform administration commands |
| `@valentinkolb/cloud/contracts/notifications` | Supported | Browser-safe notification contracts |
| `@valentinkolb/cloud/contracts/*` | Advanced | Named contract modules; prefer the barrel |
| `@valentinkolb/cloud/config/*` | Advanced | Named configuration modules; prefer the barrel |

Use a specialized entry point only when its feature guide names it.

## Platform-owned and limited surfaces

| Entry point | Status | Meaning |
| --- | --- | --- |
| `@valentinkolb/cloud/api` | Platform-owned | Builds the Core platform router |
| Registry helpers from `@valentinkolb/cloud` | Platform-owned | Gateway, Core, and platform composition |
| `@valentinkolb/cloud/services/*` | Advanced | Deep service exports; prefer the barrel |
| `@valentinkolb/cloud/server/*` | Advanced | Deep server exports; prefer the barrel |
| `@valentinkolb/cloud/desktop` | Limited | Exported desktop runtime; outside this application guide |
| `@valentinkolb/cloud/desktop/solid` | Limited | Desktop SolidJS integration |
| `@valentinkolb/cloud/services/ipa/service-account` | Blocked | Explicitly excluded from package exports |

“Limited” means the path is exported but not part of the documented web
application contract. It is not a promise of instability.

## Compatibility-only surfaces

| Surface | Use instead |
| --- | --- |
| `@valentinkolb/cloud/shared` utility re-exports | `@valentinkolb/stdlib` |
| `validator` | `v` |
| Untyped `apiClient` | `api.create<TApi>()` |
| Legacy notification send overloads | Typed notification definitions |
| Legacy access inputs | `AccessSubject` |

See [Deprecations](/docs/en/reference/deprecations-and-migrations) for migration
steps.

## Avoid internal imports

Do not import from package source paths such as:

```ts
import { something } from "@valentinkolb/cloud/src/...";
```

Those paths are implementation details.

`requiresAuth` and the other `requires*` values describe OpenAPI security. They
do not protect a route. Use `auth` middleware.
