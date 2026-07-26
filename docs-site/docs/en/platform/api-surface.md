---
title: API surface
navTitle: API surface
section: Platform APIs
order: 110
description: Distinguish application APIs from browser, UI, workflow, and operations surfaces.
tags: [api, imports, boundaries]
updated: 2026-07-26
---

# API surface

Cloud exposes several package entry points because the same codebase serves
application bootstrapping, HTTP handlers, browser islands, shared UI, and
operations tooling. Import from the boundary where code runs instead of from a
broad internal module.

## Application-facing entry points

| Entry point | Use it for |
| --- | --- |
| `@valentinkolb/cloud` | `defineApp()`, notification definitions, and common application types |
| `@valentinkolb/cloud/server` | Hono middleware, request context, actors, validation, and server helpers |
| `@valentinkolb/cloud/services` | Shared server-side services such as logging, settings, and notifications |
| `@valentinkolb/cloud/browser` | Typed HTTP client code that runs in the browser |
| `@valentinkolb/cloud/ui` | Shared SolidJS components |
| `@valentinkolb/cloud/ssr` | Application shells and server-rendered page composition |
| `@valentinkolb/cloud/workflows` | Durable workflow authoring and runtime integration |

Import a service directly only when its documented page names that entry point.
An exported symbol may support a built-in admin or operations application
without being the preferred application API.

## Definition, request, and async APIs

Many Cloud capabilities have three distinct moments:

1. **Define** what the app owns in `defineApp()`.
2. **Read** a request-stable view through typed Hono context.
3. **Act** outside the request through an asynchronous service API.

Settings illustrate the split:

```ts
const app = defineApp({
  // ...
  settings: {
    "inventory.low_stock_threshold": {
      kind: "number",
      default: 5,
    },
  },
});

const threshold = c.get("settings").inventory.low_stock_threshold;
await app.settings.set("inventory.low_stock_threshold", 10);
```

The declaration establishes ownership and types. The request snapshot is
stable for one handler. The async API observes or changes shared runtime state.

## Operations surfaces are separate

Objects such as `logging.list()`, notification delivery inspection, and
settings migration helpers exist for Cloud's administration and operations
applications. Normal domain code should use the narrow writer or declaration
API documented for each service.

This distinction keeps application code independent from database tables,
retention jobs, delivery workers, and admin pagination contracts.
