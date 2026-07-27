---
title: Lifecycle background work
navTitle: Lifecycle work
section: Automation
order: 610
description: Start and stop simple background work with the application process.
tags: [lifecycle, background, shutdown]
updated: 2026-07-27
---

# Lifecycle background work

Use `lifecycle.start` and `lifecycle.stop` for work that belongs to one
application process.

Examples include a local polling loop, a topic reader, or a scheduler instance.
Use a durable job or queue when the work itself must survive a process restart.

## Start and stop the runtime

```ts
let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<void> | null = null;

await app.start({
  fetch: router.fetch,
  lifecycle: {
    setup: migrate,
    start: async () => {
      timer = setInterval(() => {
        if (running) return;
        running = refreshInventory()
          .catch((error) => log.error("Refresh failed", { error }))
          .finally(() => {
            running = null;
          });
      }, 30_000);
    },
    stop: async () => {
      if (timer) clearInterval(timer);
      timer = null;
      await running;
    },
  },
});
```

`setup` runs after registry registration and before `start`. Use it for
idempotent migrations and required initialization.

`start` runs after setup. The service is starting, but the callback must return
so HTTP handling can continue.

`stop` runs during graceful shutdown. Stop accepting new background work and
await in-flight work.

## Prevent overlapping work

An interval can fire before its previous callback finishes. Keep an in-process
guard when overlap would be wrong.

This guard protects only one process. Use a
[mutex](/docs/en/automation/coordination-primitives#use-a-distributed-mutex) or
[scheduler](/docs/en/automation/schedulers) when several app instances must
coordinate.

## Handle shutdown

Keep handles for timers, readers, workers, and abort controllers. Close all of
them in `stop`.

The platform waits for the stop callback, but deployment shutdown still has a
deadline. Bound external requests and do not start unbounded cleanup.

See [Scaling and shutdown](/docs/en/operations/scaling-and-shutdown) for the
container contract.
