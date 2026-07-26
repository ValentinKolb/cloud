---
title: Structured logging
navTitle: Logging
section: Platform APIs
order: 130
description: Write structured operational events without coupling application code to log storage.
tags: [logging, observability, operations]
updated: 2026-07-26
---

# Structured logging

Application logs should explain what happened in the domain and provide the
identifiers needed to investigate it. Cloud mirrors each event to the process
console and stores a structured copy for the operations interface.

## Create a source-bound logger

```ts
import { logger } from "@valentinkolb/cloud/services";

const log = logger("inventory:stock");

log.info("Stock adjusted", {
  itemId,
  warehouseId,
  delta,
});
```

A logger is stateless and exposes `debug`, `info`, `warn`, and `error`. The
first argument is a concise human-readable message. The optional second
argument is structured metadata.

Name sources as `app` or `app:area`. A stable source lets operators filter
events without parsing messages:

```ts
const importLog = logger("inventory:import");
const stockLog = logger("inventory:stock");
```

## Choose the level by operational meaning

| Level | Use it when |
| --- | --- |
| `debug` | The detail is useful during diagnosis but noisy during normal operation |
| `info` | A meaningful operation completed or changed state |
| `warn` | Work continued, but an expected dependency or invariant degraded |
| `error` | The operation failed and needs investigation or recovery |

Do not log the same failure at every layer. Add context where the error becomes
operationally meaningful, then either recover or propagate it.

## Metadata and sensitive values

Prefer IDs, counts, durations, state names, and bounded error messages:

```ts
try {
  await reserveStock(itemId, quantity);
} catch (error) {
  log.error("Stock reservation failed", {
    itemId,
    quantity,
    error: error instanceof Error ? error.message : "Unknown failure",
  });
  throw error;
}
```

Cloud recursively redacts metadata keys containing terms such as `password`,
`secret`, `token`, `cookie`, `authorization`, `apiKey`, `privateKey`, or
`session`. Redaction is a safety net, not permission to attach request bodies,
credentials, or personal records to logs.

## Delivery behavior

Logging is fire-and-forget:

- the console receives the event immediately;
- the database insert runs asynchronously;
- a persistence failure is reported to the process console;
- the application operation is not failed because log storage is unavailable.

Use domain persistence, an outbox, or a durable workflow when an event must be
recorded transactionally. Logs are operational evidence, not a business
source of truth.

The broader `logging` service exported from `/services` supports Cloud's admin
and operations surfaces. Application code should normally depend only on
`logger()`.
