---
title: Start and stop an application
navTitle: Application lifecycle
section: Build an app
order: 130
description: Start the service, prepare required state, run process work, and stop cleanly.
tags: [applications, lifecycle, shutdown]
updated: 2026-08-12
---

# Start and stop an application

`app.start()` is the boundary between an application's declarations and its
running process. It registers the live service, prepares shared runtime state,
runs application lifecycle hooks, and returns the Bun-compatible server
definition.

Pass the Hono fetch handler:

```ts
export default await app.start({
  fetch: router.fetch,
});
```

## Set the start options

The complete shape is:

```ts
export default await app.start({
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: {
    setup,
    start,
    stop,
  },
  capabilities: inventoryCapabilities,
  help: inventoryHelp,
  port: 3000,
  skipSetup: false,
});
```

| Option | Required | Default | Meaning |
| --- | --- | --- | --- |
| `fetch` | Yes | — | Application request handler |
| `openapi` | No | — | Bare router used to generate OpenAPI |
| `lifecycle` | No | — | `setup`, `start`, and `stop` hooks |
| `capabilities` | No | — | Versioned Types, Queries, and Actions |
| `help` | No | — | App-owned product Help registered with the live service |
| `port` | No | `3000` | Internal Bun server port |
| `skipSetup` | No | `false` | Skip the `setup` hook |

See [App capabilities](/en/docs/platform/capabilities) for the executable
contract and [In-product Help](/en/docs/platform/help) for the Help definition.

OpenAPI also needs the document path declared in `defineApp()`. See
[Typed HTTP APIs](/en/docs/server/http#publish-openapi).

## Lifecycle hooks

| Hook | Use |
| --- | --- |
| `setup` | Prepare required state before the server definition is returned |
| `start` | Start workers, schedulers, and subscriptions |
| `stop` | Release process resources |

```ts
export default await app.start({
  fetch: router.fetch,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
    start: async () => {
      await stockWorker.start();
    },
    stop: async () => {
      await stockWorker.stop();
    },
  },
});
```

Keep HTTP middleware and route mounting outside the lifecycle.

## Prepare state in setup

`setup` runs on every normal start. Database migrations belong here:

```ts
setup: async () => {
  await migrate();
},
```

Make setup work safe to run more than once. See
[Migrations and transactions](/en/docs/data/migrations-and-transactions).

`skipSetup: true` prevents the hook from running. Use it only when another
controlled process already prepared the required state. It must not hide a
failing migration.

## Clean up a failed start

Cloud does not roll back work started by the application.

If `start` has several steps, stop completed steps when a later step fails:

```ts
start: async () => {
  await importWorker.start();
  try {
    await reconciliationWorker.start();
  } catch (error) {
    await importWorker.stop();
    throw error;
  }
},
```

See [Lifecycle background work](/en/docs/automation/lifecycle-background-work).

## Stop in reverse order

Cloud calls `stop` for `SIGTERM` and `SIGINT`.

Stop resources in the reverse order from startup:

```ts
stop: async () => {
  await reconciliationWorker.stop();
  await importWorker.stop();
},
```

After the hook, Cloud removes notification registration. It then stops the
runtime watcher and removes the application registry entry.

See [Scaling and shutdown](/en/docs/operations/scaling-and-shutdown) for
deployment behavior and shutdown deadlines.

## Lifecycle context

Each hook receives:

```ts
setup: async (cloud) => {
  const log = cloud.logger("inventory");
  log.info("Preparing inventory");

  const timezone = await cloud.settings.get<string>("app.timezone");
  const applications = cloud.runtime.apps;
},
```

The context contains:

- `logger(source)` for structured application logs;
- asynchronous `settings.get()` and `settings.set()`;
- a snapshot of registered applications.

Request handlers should use request middleware instead. See
[Settings](/en/docs/platform/settings) and
[Request middleware](/en/docs/server/middleware).

## Startup order

Cloud starts the application in this order:

1. require the shared `APP_SECRET`;
2. write the application registry entry;
3. start the runtime watcher;
4. run `setup`, unless skipped;
5. register notification definitions;
6. load the settings cache;
7. run `start`;
8. return the server definition.

Every application container needs the same non-empty `APP_SECRET`. Startup
fails before registration when it is missing.

The returned object contains `port`, `development`, and `fetch`. Applications
that expose Bun WebSockets add their handlers to that result:

```ts
const result = await app.start({ fetch: router.fetch });

export default {
  ...result,
  websocket,
};
```
