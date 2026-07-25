# Workflows

An app that wants user-authored automation does not write a run engine. The kernel owns storage, scheduling, leasing, retry, crash recovery, effect budgets and observability. **An app supplies action implementations and an event vocabulary. Nothing else.**

Two apps each grew their own engine before this existed — around 3,500 lines that agreed on almost everything and differed exactly where it hurts. If you find yourself writing a run table, a lease, or a step journal, you are re-creating something that already exists and will drift from it.

## The three rules

1. **A plan is immutable; a run pins its version.** Editing a workflow cannot change a run already in flight.
2. **A step is a function of its inputs and the prior outcomes.** A step that reads mutable state is not pure — a replay sees something else.
3. **Outcomes are journaled; a recorded outcome is never recomputed.**

Execution is "find the first step with no recorded outcome, run it, record it". Crash recovery is that same loop, not a second code path — which is why there is no recovery API to call.

## Declaring actions and events

Put them in `src/workflows.ts`, the way notification definitions live in `src/notifications.ts`.

```typescript
import { workflowAction, workflowEvent } from "@valentinkolb/cloud/workflows";

export const events = {
  recordChanged: workflowEvent({
    label: "Record changed",
    description: "A row changed in a base.",
    data: { kind: "object", properties: { rowId: { kind: "string" } } },
  }),
};

export const actions = {
  sendMail: workflowAction.ambiguous({
    label: "Send mail",
    description: "Hands a message to the provider.",
    config: {
      kind: "object",
      properties: { to: { kind: "string" }, subject: { kind: "string", optional: true } },
    },
    // `input.to` is a string here without a cast. The config schema drives both
    // the workflow language and this parameter type, so they cannot disagree.
    run: async (ctx, input) => ({ state: "succeeded", output: { id: await send(input.to) } }),
    plan: async (_ctx, input) => ({ summary: `send to ${input.to}`, consumes: { emails: 1 } }),
    reconcile: async (_ctx, effectKey) => askProvider(effectKey),
  }),
};
```

The schema is the kernel's `WorkflowFieldSchema`, **not Zod** — it has to be serialisable so the editor can render a form and the compiler can validate what a user wrote. `FromFieldSchema` derives the TypeScript type from it, which is what closes the old gap where a descriptor, a binder and an implementation were three disconnected places.

### The effect class picks the factory

| Factory | Meaning | Required hooks |
|---|---|---|
| `workflowAction.pure` | Deterministic given inputs and prior outcomes | `run` |
| `workflowAction.transactional` | Commits inside the journal's transaction, so a crash means it did not happen | `run`, `plan` |
| `workflowAction.idempotent` | External, safe to repeat under `ctx.effectKey` | `run`, `plan` |
| `workflowAction.ambiguous` | External and not verifiable in advance | `run`, `plan`, `reconcile` |

Naming the class at the call site makes each requirement a plain missing-property error. A pure action cannot declare `reconcile` because there is nothing to reconcile; an ambiguous one must, or an interrupted run has no way back.

**Choose honestly.** `pure` is about determinism, not about being cheap: a step that reads a mutable row is not pure, and marking it so means a replay silently produces a different answer. This is the classic mistake.

## Starting runs

Everything that starts work is an event — a schedule tick, a button press, an inbound message. There is no separate registration path for any of them.

```typescript
import { emitWorkflowEvent } from "@valentinkolb/cloud/workflows/store";

// A user pressed a button: dispatch inline so the caller gets run ids back
// without a round trip through a queue.
const { runIds } = await emitWorkflowEvent(
  { appId: "grids", scopeId: baseId, type: "grids.recordChanged", data: { rowId } },
  { dispatch: "now" },
);

// Something merely happened: record it and let the worker pick it up. A failing
// dispatch would otherwise roll back the event and lose the occurrence itself.
await emitWorkflowEvent({ appId: "grids", scopeId: baseId, type: "grids.recordChanged", data: { rowId } });
```

Pass `dedupeKey` for any source that can repeat itself — a schedule slot, a provider redelivery, a double-clicked button. The same key records one event and therefore starts one run, and the second call is answered with the first one's run ids.

## Running them

```typescript
import { tickWorkflows } from "@valentinkolb/cloud/workflows/store";

lifecycle: {
  start: async () => {
    schedule("*/10 * * * * *", () => tickWorkflows({ worker: hostname(), appId: "grids", actions }));
  },
}
```

One tick dispatches what happened, wakes what was waiting, then runs what is ready — in that order, so an event that arrived a moment ago is carried out in the same pass instead of always lagging a poll interval behind. Pass `appId` or a worker will drain every app's runs.

## Effects that leave the process

```typescript
await beginWorkflowEffect(step, ctx.effectKey);   // before you act
const outcome = await provider.send(...);          // the effect
await settleWorkflowEffect(step, "succeeded");     // or "ambiguous" | "failed"
```

An effect left `executing` or `ambiguous` is one that may already have happened. A replay refuses to repeat it — repeating is how the same message goes out twice — so it surfaces on the admin page and in `cld admin workflows effects` for a human to settle.

Charge the budget **before** the effect, against the root run:

```typescript
const root = await budgetRootRunId(ctx.run.runId);
const charge = await chargeWorkflowEffectBudget(root, { emails: 1 });
if (charge.state === "exceeded") return { state: "failed", error: budgetError(charge) };
```

Against the root, because a fan-out over ten thousand records would otherwise authorise ten thousand times the cap.

## Fan-out

Fan-out is child runs, not a targets table.

```typescript
await createChildWorkflowRuns({ runId: ctx.run.runId, stepKey: ctx.step.key }, items.map(...));
```

A child is an ordinary run: same lease protocol, same journal, same observability. The parent reads its progress as one aggregate (`countChildWorkflowRuns`), and the admin page hides children until you open the parent.

## What stays in your app

Action implementations, the action catalogue and binder, domain-specific triggers, and your own API, CLI and UI. If you are writing anything else — a run table, a lease, a retry loop, a dry-run mode, a health endpoint — check whether the kernel already owns it. It probably does.

## Observability comes free

Runs, causes, steps, effects and budgets are already on `/admin/observability/workflows` and in `cld admin workflows`. Do not build an app-specific run list; a per-app health port is exactly the thing that moving storage into the kernel removed.
