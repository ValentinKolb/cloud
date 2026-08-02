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

`Supported` means application code may depend on the documented use. It does
not make every symbol in a mixed barrel an application API. `Platform-owned`
is for Cloud itself. `Advanced` paths are public exports, but application code
should use them only when a feature guide gives the exact import.

## Application entry points

| Entry point | Status | Use |
| --- | --- | --- |
| `@valentinkolb/cloud` | Supported | Application declarations and typed notifications |
| `@valentinkolb/cloud/server` | Supported, server-only | Hono middleware, validation, actors, results, and access |
| `@valentinkolb/cloud/services` | Supported, server-only | Feature services named by a capability guide |
| `@valentinkolb/cloud/contracts` | Supported | Browser-safe schemas and shared data contracts |
| `@valentinkolb/cloud/browser` | Supported, browser | Typed Hono browser clients |
| `@k2b/ui` | Supported, SolidJS | Portable SolidJS components and interactions |
| `@valentinkolb/cloud/ssr` | Supported, server-only | Layouts, runtime context, and URL filters |
| `@valentinkolb/cloud/workflows` | Supported | Workflow definitions and authoring contracts |
| `@valentinkolb/cloud/ai` | Supported, server-only | AI APIs named by the AI guides |
| `@valentinkolb/cloud/cli` | Supported | Cloud CLI modules |
| `@valentinkolb/cloud/config` | Supported, server-only | Selected typed runtime values |

Use the barrels above by default. Use a subpath when the specialized-entry
table below links its feature guide.

## Define the application

Import `defineApp()` from the package root:

```ts
import { defineApp } from "@valentinkolb/cloud";
```

The root also exports the types bound to an application declaration. This
includes typed settings and notification definitions. Registry, heartbeat, and
runtime-composition exports from the same barrel are platform-owned.

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

Code outside an HTTP request uses asynchronous feature services:

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

Raw stores, runtime starters, gateway telemetry, migrations, and platform
composition helpers from the same barrel are maintainer APIs unless a guide
names them.

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

The `clipboard`, `copyToClipboard`, `url`, and `isImageUrl` exports are utility
helpers outside the documented typed-client contract. Do not choose them as
application APIs unless a guide names them.

## Mixed barrels

Some barrels serve more than one audience. Use this boundary instead of
inferring support from autocomplete.

| Entry point | Application surface | Other exports |
| --- | --- | --- |
| `@valentinkolb/cloud` | `defineApp`, declaration types, typed notifications | Registry, heartbeat, and runtime composition are platform-owned |
| `@valentinkolb/cloud/services` | Feature services used by capability guides | Raw stores, lifecycle starters, gateway telemetry, and migrations are maintainer APIs |
| `@valentinkolb/cloud/ai` | Resources, routes, tools, and runtime APIs used by AI guides | Stores, migrations, workers, and maintenance helpers not named by a guide are maintainer APIs |
| `@valentinkolb/cloud/browser` | Typed Hono client factory | Utility helpers are outside the documented typed-client contract |
| `@valentinkolb/cloud/shared` | Cloud-specific helpers named by feature guides | Generic utility re-exports are compatibility-only |
| `@valentinkolb/cloud/cli` | APIs for application CLI modules | Built-in account, application, and admin modules are platform-owned |

`@valentinkolb/cloud/config` exports `env.APP_SECRET`, `env.PORT`,
`env.IS_DEVELOPMENT`, and `env.ADMIN_LOGIN_TOKEN`. The
[runtime configuration guide](/docs/en/operations/runtime-configuration)
documents all process variables; that larger list is not the shape of `env`.

## Specialized entry points

| Entry point | Status | Use | Guide |
| --- | --- | --- | --- |
| `@valentinkolb/cloud/ai/solid` | Supported, browser | AI chat controller | [Chat interface](/docs/en/ai/chat-interface) |
| `@valentinkolb/cloud/ai/ui` | Supported, SolidJS | Shared AI chat components | [Chat interface](/docs/en/ai/chat-interface) |
| `@valentinkolb/cloud/account/ui` | Supported, SolidJS | Cloud account selectors and avatars | [Building blocks](/docs/en/building-blocks) |
| `@valentinkolb/cloud/access/ui` | Supported, SolidJS | Cloud permission and resource-key controls | [Resource API keys](/docs/en/identity/resource-api-keys) |
| `@valentinkolb/cloud/browser/live` | Supported, browser | Live WebSocket transport | [Realtime UI](/docs/en/frontend/realtime-ui) |
| `@valentinkolb/cloud/browser/notifications` | Supported, browser | Browser notification state | [Notifications](/docs/en/platform/notifications) |
| `@valentinkolb/cloud/clients/core` | Platform-owned, browser | Typed client for the Core platform API | — |
| `@valentinkolb/cloud/workflows/language` | Supported | Workflow compiler, parser, and authoring | [Author workflows](/docs/en/automation/author-and-publish-workflows) |
| `@valentinkolb/cloud/workflows/runtime` | Supported, server-only | Workflow execution runtime | [Workflow effects](/docs/en/automation/effects-retry-and-reconciliation) |
| `@valentinkolb/cloud/workflows/store` | Supported, server-only | Durable workflow store and workers | [Start runs](/docs/en/automation/emit-events-and-start-runs) |
| `@valentinkolb/cloud/workflows/testing` | Supported, tests | Workflow process fixtures | [Test workflows](/docs/en/automation/workflow-observability-and-testing) |
| `@valentinkolb/cloud/ssr/islands` | Supported, server-only | Shared SSR island helpers | [In-product help](/docs/en/platform/help) |
| `@valentinkolb/cloud/ssr/*` | Advanced | Named SSR modules; prefer the barrel | — |
| `@valentinkolb/cloud/workflows/editor` | Supported, SolidJS | Workflow authoring controls | [Shared components](/docs/en/frontend#choose-shared-components) |
| `@valentinkolb/cloud/styles/global.css` | Supported asset | Alias for the global stylesheet | [Styling](/docs/en/frontend/styling-and-accessibility) |
| `@valentinkolb/cloud/cli/access` | Supported | Resource access commands | [CLI modules](/docs/en/platform/cli-modules) |
| `@valentinkolb/cloud/cli/account` | Platform-owned | Built-in account commands | — |
| `@valentinkolb/cloud/cli/apps` | Platform-owned | Built-in application commands | — |
| `@valentinkolb/cloud/cli/admin` | Platform-owned | Built-in administration commands | — |
| `@valentinkolb/cloud/contracts/notifications` | Supported | Browser-safe notification contracts | [Notifications](/docs/en/platform/notifications) |
| `@valentinkolb/cloud/contracts/*` | Advanced | Named contract modules; prefer the barrel | — |
| `@valentinkolb/cloud/config/*` | Advanced | Named configuration modules; prefer the barrel | — |

Every app-facing specialized row has a guide. `Platform-owned` and `Advanced`
rows are exported for Cloud itself or for a narrowly documented integration;
their presence is not an application support promise.

## Platform-owned and limited surfaces

| Entry point | Status | Meaning |
| --- | --- | --- |
| `@valentinkolb/cloud/api` | Platform-owned | Builds the Core platform router |
| Registry, heartbeat, and runtime helpers from `@valentinkolb/cloud` | Platform-owned | Gateway, Core, and platform composition |
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
| `@valentinkolb/cloud/shared` utility re-exports | `@k2b/stdlib` |
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
