---
title: Jobs and queues
navTitle: Jobs and queues
section: Automation
order: 620
description: Run asynchronous work and control how tasks wait for workers.
tags: [jobs, queues, sync]
updated: 2026-07-27
---

# Jobs and queues

Use a job for one typed background operation. Use a queue when the application
needs direct control over receive, lease, acknowledge, and dead-letter
behavior.

Both use `@k2b/sync` and provide at-least-once execution.

## Retry an operation

Use `retry()` when one process-local operation can be repeated safely.

```ts
import {
  isRetryableTransportError,
  retry,
} from "@k2b/sync";

const response = await retry({
  run: () => fetchInventory(),
  after: ({ ctx }) => {
    if (
      ctx.error &&
      ctx.attempt < 5 &&
      isRetryableTransportError(ctx.error)
    ) {
      ctx.reschedule({ delayMs: ctx.expBackoff() });
    }
  },
  signal,
});
```

`run` receives the current attempt number. `after` receives either `data` or
`error`. Call `reschedule()` to run another attempt.

Without `reschedule()`, `retry()` returns the data or throws the original error.
An aborted signal ends the loop with `AbortError`. Errors thrown by `after` are
ignored.

Use the exported `expBackoff(attempt, options)` helper when the caller owns the
retry loop.

`retry()` keeps no durable state. A process exit ends the operation. Use a job
when the work must survive a restart.

## Run a job

```ts
import { job } from "@k2b/sync";

const reindexItem = job<{ itemId: string }>({
  id: "inventory.reindex-item",
  process: async ({ ctx }) => {
    await rebuildIndex(ctx.input.itemId);
  },
  after: async ({ ctx }) => {
    if (ctx.error && ctx.failureCount < 5) {
      ctx.reschedule({
        delayMs: ctx.expBackoff({
          baseMs: 1_000,
          maxMs: 5 * 60_000,
        }),
      });
    }
  },
});

await reindexItem.submit({
  key: `item:${itemId}:${version}`,
  input: { itemId },
});
```

`key` is required. Repeated submission returns the existing job ID while the
idempotency key exists.

`process` receives typed input, an abort signal, attempt state, and
`heartbeat()`. Heartbeat long tasks so their lease does not expire.

`after` receives either `data` or `error`. The attempt is terminal unless it
calls `reschedule()`.

The worker starts when the first job is submitted. Call `stop()` during
application shutdown.

### Jobs run at least once

A worker crash leaves the message leased until another worker receives it.
The process callback can therefore run more than once.

Make external effects idempotent under `ctx.key`. Do not treat a successful
callback as a durable business record.

The default key TTL is 24 hours. A terminal job releases its key.

Set `keyTtlMs` to at least the maximum delay plus retry duration. A delayed or
repeatedly rescheduled job can outlive its key. Once the key expires, the same
logical submission can create another job.

```ts
await reindexItem.submit({
  key: `item:${itemId}:${version}`,
  keyTtlMs: 7 * 24 * 60 * 60 * 1_000,
  input: { itemId },
});
```

## Use a queue

```ts
import { queue } from "@k2b/sync";

const imports = queue<{ fileId: string }>({
  id: "inventory.imports",
  delivery: {
    defaultLeaseMs: 30_000,
    maxDeliveries: 10,
  },
});

await imports.send({
  data: { fileId },
  idempotencyKey: `import:${fileId}`,
});

for await (const message of imports.stream({ signal })) {
  try {
    await importFile(message.data.fileId);
    await message.ack();
  } catch (error) {
    await message.nack({
      delayMs: 5_000,
      error: error instanceof Error ? error.message : "Import failed",
    });
  }
}
```

`recv()` and `stream()` return a leased delivery. Settle it with `ack()` or
`nack()`. Call `touch()` when processing may outlive the lease.

`ack()`, `nack()`, and `touch()` return `false` after lease ownership is lost.
The work is then ambiguous because another worker may have received it.

After `maxDeliveries`, the queue moves the message to its dead-letter queue.
The default dead-letter retention is seven days.

Messages can use `delayMs`, an `orderingKey`, and an idempotency key.
Partitioned ordering preserves order per key but reduces parallelism.

## Validate inputs

The generic supplies TypeScript types. Sync does not validate payloads at
runtime. Validate data before sending or at the worker boundary when a producer
is not trusted.

Use [workflow effects](/en/docs/automation/effects-retry-and-reconciliation)
when a user-authored, multi-step process needs a durable effect journal.
