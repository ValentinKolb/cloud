---
title: Schedulers
navTitle: Schedulers
section: Automation
order: 630
description: Run recurring work without coupling it to HTTP requests.
tags: [scheduler, cron, sync]
updated: 2026-07-27
---

# Schedulers

Use a scheduler for recurring work shared by every instance of an application.

`@k2b/sync` stores schedule state in Valkey and elects one dispatcher.
All app instances should register the same schedules.

This is separate from a schedule trigger in a user-authored workflow. The
application maps those triggers to the same scheduler through the workflow
schedule runtime described below.

## Register a schedule

```ts
import { scheduler } from "@k2b/sync";

const inventoryScheduler = scheduler({ id: "inventory" });

await inventoryScheduler.create({
  id: "cleanup",
  cron: "0 * * * *",
  tz: "UTC",
  process: async ({ ctx }) => {
    return {
      deleted: await deleteExpiredImports(ctx.slotTs),
    };
  },
  after: async ({ ctx }) => {
    if (ctx.error && ctx.failureCount < 5) {
      ctx.reschedule({
        delayMs: ctx.expBackoff({ baseMs: 60_000 }),
      });
    }
  },
});

inventoryScheduler.start();
```

Call `start()` after every schedule is registered. Call `stop()` during
graceful shutdown.

`cron` uses five fields. `tz` is an IANA time zone and defaults to UTC.
Invalid values fail during `create()`.

`create()` is idempotent by schedule ID. It updates an existing definition.

## Use the run context

The process context includes:

| Field | Meaning |
| --- | --- |
| `scheduleId` | Registered schedule |
| `slotTs` | Time of the cron slot |
| `runNumber` | Persistent, increasing run number |
| `failureCount` | Consecutive failures before this run |
| `trigger` | `cron` or `manual` |
| `signal` | Shutdown signal |

Use `slotTs` as the identity of a scheduled occurrence. Current time can change
the meaning of a delayed run.

Schedules skip missed slots after downtime. They do not replay every missed
cron occurrence.

## Retry or fan out

Call `ctx.reschedule()` from `after` to retry. Without it, the run is terminal.

When each item needs independent retry, let the schedule submit one
[job](/docs/en/automation/jobs-and-queues#run-a-job) per item. Do not retry an
entire large batch because one item failed.

## Register workflow schedule triggers

Published workflow activations are durable records. The process-local scheduler
handlers must be restored from them after every start:

```ts
import {
  createWorkflowScheduleRegistration,
  reconcileWorkflowSchedules,
} from "@valentinkolb/cloud/workflows/runtime";

const desired = activations.map((activation) =>
  createWorkflowScheduleRegistration({
    namespace: "inventory",
    workflowId: activation.workflowId,
    triggerId: activation.triggerKey,
    revision: String(activation.revision),
    cron: activation.cron,
    timezone: activation.timezone,
  }),
);

await reconcileWorkflowSchedules({
  desired,
  current: await loadRegisteredWorkflowSchedules(),
  port: {
    create: registerWithScheduler,
    update: (_current, next) => registerWithScheduler(next),
    register: registerWithScheduler,
    remove: removeFromScheduler,
  },
});
```

The registration ID stays stable across workflow revisions. A changed revision,
cron expression, or timezone becomes an update. Missing desired registrations
are removed.

`register` also runs for unchanged entries. Use it to restore the callback held
by the current application process.

When a slot fires, emit the workflow event with a deterministic key:

```ts
import {
  workflowScheduleSlotKey,
} from "@valentinkolb/cloud/workflows/runtime";
import {
  emitWorkflowEvent,
} from "@valentinkolb/cloud/workflows/store";

const slot = new Date(ctx.slotTs).toISOString();

await emitWorkflowEvent({
  appId: "inventory",
  scopeId: warehouseId,
  type: "inventory.schedule",
  targetWorkflowId: registration.workflowId,
  occurredAt: new Date(slot),
  dedupeKey: workflowScheduleSlotKey(registration.id, slot),
});
```

The slot key prevents a leader handover from starting the same workflow twice.
See [Start workflow runs](/docs/en/automation/emit-events-and-start-runs) for
event fields and dispatch behavior.

## Trigger a run

`runNow({ id })` starts a manual run without moving the next cron slot.

An external admin process can use `schedulerControl().runNow()`. It returns
when a live scheduler accepts the request, not when the work finishes.

Use tracing or application audit data for completion status. See
[Tracing](/docs/en/platform/tracing).

Multiple instances coordinate dispatch, but a brief leader handover can still
deliver a slot more than once. Keep schedule work idempotent.
