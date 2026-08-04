---
title: Create the first application
navTitle: First application
section: Build an app
order: 110
description: Add an API-only application to a Cloud source checkout and run it through the gateway.
tags: [applications, getting-started, development]
updated: 2026-07-27
---

# Create the first application

This guide adds an `inventory` service to a Cloud source checkout.

The finished application registers one route and serves one endpoint:

```text
GET /api/inventory/health
```

Use this path for a built-in application. A standalone project uses the same
application code but different deployment wiring. See
[Choose the project shape](/en/docs/build#choose-the-project-shape).

## Prepare the checkout

The guide requires Bun, Docker with Compose, and a local Cloud checkout.

Install the workspace and start the shared infrastructure:

```bash
bun install
bun run infra
```

## Create the package

Create the package directory and copy the small application TypeScript config:

```bash
mkdir -p packages/inventory/src
cp packages/quotes/tsconfig.json packages/inventory/tsconfig.json
```

Create `packages/inventory/package.json`:

```json
{
  "name": "@valentinkolb/cloud-app-inventory",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "module": "src/index.ts",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit --pretty false"
  },
  "dependencies": {
    "@valentinkolb/cloud": "workspace:*",
    "hono": "^4.11.1"
  },
  "devDependencies": {
    "@types/bun": "1.3.9",
    "typescript": "^5.9.3"
  },
  "license": "AGPL-3.0-or-later"
}
```

Add `"packages/inventory"` to the root `workspaces` array. Run `bun install`
again so the new workspace is linked.

## Define one public route

Create `packages/inventory/src/config.ts`:

```ts
import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "inventory",
  name: "Inventory",
  icon: "ti ti-packages",
  description: "Track stock and warehouse movements.",
  baseUrl: "http://app-inventory:3000",
  routes: ["/api/inventory"],
});
```

The definition declares only the API prefix because this application does not
serve pages or assets yet.

The application ID is stable. `baseUrl` must resolve from the gateway
container. The `routes` array controls which public paths reach the service.

See [Define an application](/en/docs/build/define-app) for the complete
definition.

## Serve the route

Create `packages/inventory/src/index.ts`:

```ts
import { Hono } from "hono";
import { app } from "./config";

const router = new Hono().get("/api/inventory/health", (c) =>
  c.json({
    app: app.meta.id,
    status: "ok",
  }),
);

export default await app.start({
  fetch: router.fetch,
});
```

`app.start()` does not create Hono routes or add middleware. This endpoint does
not need request context, so the router stays empty apart from the route.

Add [request middleware](/en/docs/server/middleware) when the application needs
identity, settings, logging, or rate limits.

## Add the development service

Add the package manifest to the install layer in `Dockerfile.dev`:

```dockerfile
COPY packages/inventory/package.json packages/inventory/
```

Add the service to `compose.dev.yml`:

```yaml
app-inventory:
  <<: *app
  container_name: app-inventory
  environment: { <<: *env, APP_ID: inventory }
  profiles: [extra]
  volumes:
    - ./packages/cloud/src:/app/packages/cloud/src
    - ./packages/cloud/scripts:/app/packages/cloud/scripts
    - ./packages/inventory/src:/app/packages/inventory/src
    - ./styles.css:/app/styles.css
  command: bun run --preload=/app/packages/cloud/scripts/preload.ts --watch packages/inventory/src/index.ts
```

The service name matches the hostname in `baseUrl`.

## Run the application

Start the main development stack in one terminal:

```bash
bun run dev
```

Start the new optional service in another terminal:

```bash
bun run dev:rebuild inventory
```

Call the route through the gateway:

```bash
curl http://localhost:3000/api/inventory/health
```

The response is:

```json
{
  "app": "inventory",
  "status": "ok"
}
```

If the gateway returns `502` because no application is registered for the
path, follow
[Diagnose an unreachable route](/en/docs/build/routing#diagnose-an-unreachable-route).

A `404` means the gateway reached the application, but its Hono router did not
match the requested path.

## Organize the package as it grows

The first version needs only two source files:

```text
src/
├── config.ts
└── index.ts
```

Split code when a responsibility appears:

```text
src/
├── config.ts
├── index.ts
├── contracts.ts
├── migrate.ts
├── api/
├── data/
├── service/
└── frontend/
```

| Path | Responsibility |
| --- | --- |
| `config.ts` | `defineApp()` and declarative platform integrations |
| `index.ts` | Middleware order, route mounting, and `app.start()` |
| `contracts.ts` | Input and output schemas shared across boundaries |
| `migrate.ts` | Idempotent application-schema changes |
| `api/` | HTTP transport |
| `data/` | Queries and repositories |
| `service/` | Domain rules |
| `frontend/` | SSR pages and interactive islands |

Do not make route handlers own business rules or persistence. Pass explicit
inputs into domain services instead of passing a Hono context.

## Next capabilities

- [Protect routes and resources](/en/docs/identity).
- [Define typed HTTP APIs](/en/docs/server/http).
- [Store domain data](/en/docs/data/postgres-queries).
- [Add SSR pages](/en/docs/frontend/ssr-pages-and-routing).
- [Declare settings](/en/docs/platform/settings).
- [Run setup and background work](/en/docs/build/lifecycle).
