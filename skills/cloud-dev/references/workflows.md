# Workflows

An app that wants user-authored automation does not write a run engine. The kernel owns storage, scheduling, leasing, retry, crash recovery, the effect journal, effect budgets and observability. **An app supplies action implementations and an event vocabulary. Nothing else.**

Two apps each grew their own engine before this existed — around 3,500 lines that agreed on almost everything and differed exactly where it hurts. If you find yourself writing a run table, a lease, a step journal or a retry loop, you are re-creating something that already exists and will drift from it.

Grids is the worked example. Read `packages/grids/src/workflows.ts` for six real declarations and `packages/grids/src/service/workflow-runtime.ts` for the wiring.

## The three rules

1. **A plan is immutable; a run pins its version.** Editing a workflow cannot change a run already in flight.
2. **A step is a function of its inputs and the prior outcomes.** A step that reads mutable state is not pure — a replay sees something else.
3. **Outcomes are journaled; a recorded outcome is never recomputed.**

Execution is "find the first step with no recorded outcome, run it, record it". Crash recovery is that same loop, not a second code path — which is why there is no recovery API to call.

## Declaring actions and events

Put them in `src/workflows.ts`, the way notification definitions live in `src/notifications.ts`.

```typescript
import { workflowAction, workflowEvent } from "@valentinkolb/cloud/workflows";

export const APP_EVENTS = {
  recordChanged: workflowEvent({
    label: "Record changed",
    description: "A row changed in a base.",
    data: { kind: "object", properties: { rowId: { kind: "string" } } },
  }),
};

export const APP_ACTIONS = {
  sendMail: workflowAction.ambiguous({
    label: "Send mail",
    description: "Hands a message to the provider.",
    config: {
      kind: "object",
      properties: { to: { kind: "string" }, subject: { kind: "string", optional: true } },
    },
    // `input.to` is a string here without a cast. The config schema drives both
    // the workflow language and this parameter type, so they cannot disagree.
    run: async (ctx, input) => ({ state: "succeeded", output: { id: await send(input.to, ctx.effectKey) } }),
    plan: async (_ctx, input) => ({ summary: `send to ${input.to}`, consumes: { emails: 1 } }),
    reconcile: async (_ctx, effectKey) => askProvider(effectKey),
  }),
};
```

The schema is the kernel's `WorkflowFieldSchema`, **not Zod** — it has to be serialisable so the editor can render a form and the compiler can validate what a user wrote. `FromFieldSchema` derives the TypeScript type from it, which is what closes the old gap where a descriptor, a binder and an implementation were three disconnected places.

Write the schema as a plain object literal. `workflowAction.*` infers it with `const`, and a helper function returning `WorkflowFieldSchema` erases exactly the literal types the inference needs.

### The effect class picks the factory

| Factory | Meaning | Required hooks |
|---|---|---|
| `workflowAction.pure` | Deterministic given inputs and prior outcomes | `run` |
| `workflowAction.transactional` | Commits inside the journal's transaction, so a crash means it did not happen | `run`, `plan` |
| `workflowAction.idempotent` | External, safe to repeat under `ctx.effectKey` | `run`, `plan` |
| `workflowAction.ambiguous` | External and not verifiable in advance | `run`, `plan`, `reconcile` |

Naming the class at the call site makes each requirement a plain missing-property error. A pure action cannot declare `reconcile` because there is nothing to reconcile; an ambiguous one must, or an interrupted run has no way back.

**Choose honestly.** `pure` is about determinism, not about being cheap: a step that reads a mutable row is not pure, and marking it so means a replay silently produces a different answer. This is the classic mistake.

### What a hook receives

`ctx` is the same for every hook:

| Field | Use |
|---|---|
| `ctx.runId`, `ctx.stepKey` | Correlation, and keying anything that hangs off the step |
| `ctx.invocation` | Who the run acts as, its inputs, and the `context.*` the emitter attached |
| `ctx.effectKey` | Stable across replays — the key an idempotent effect deduplicates on |
| `ctx.tx` | Present **only** for `transactional`. Do the work on this handle or the class's promise is void |
| `ctx.binding(...path)` | The identity the compiler pinned for a config path, relative to this step |
| `ctx.resolveReference(ref, ...path)` | Resolves a value reference the config names |
| `ctx.heartbeat()` | Keeps a long-running action's lease alive |

`binding` is what a source naming a table or a template resolves to. Publishing froze that; reading the name again at run time would follow a rename onto a different object.

### What a hook returns

```typescript
{ state: "succeeded", output }
{ state: "failed", message, code?, retryable? }
{ state: "ambiguous", message, code?, evidence? }   // ambiguous class only
```

`code` reaches the run view — without it "the template was deleted" and "you may not do this" read identically. `retryable` says the attempt failed, not the work: the runtime retries the step instead of ending the run, so a provider being briefly unreachable stops costing a run.

`plan` returns `{ summary, consumes?, output?, issues? }`. `output` is what later steps plan against — **mark synthetic values as such**, or a downstream step acts on a fiction. `issues` is how a plan reports what it could not determine; the run ends `indeterminate` rather than claiming success.

`authorize?: (ctx, config) => Promise<boolean>` re-checks permission at the moment of the effect. Use it only for the question that has one answer — access can be revoked between queueing and running. Anything that can fail for another reason belongs in `run`, where the refusal keeps its own code.

## Wiring declarations into a worker

```typescript
import { createWorkflowActionPort, createWorkflowDryRunPort, tickWorkflows, dryRunOneWorkflow } from "@valentinkolb/cloud/workflows/store";

const actions = createWorkflowActionPort(APP_ACTIONS);
const dryRun = createWorkflowDryRunPort(APP_ACTIONS);

setInterval(() => tickWorkflows({ worker: hostname(), appId: "grids", actions, values, trace }), 1_000);
```

One tick dispatches what happened, wakes what was waiting, then runs what is ready — in that order, so an event that arrived a moment ago is carried out in the same pass instead of lagging a poll interval behind. **Pass `appId`** or a worker drains every app's runs.

Dry runs are a separate claim: `dryRunOneWorkflow({ worker, appId, actions: dryRun })`, drained until it reports `idle`. The mode filter on the claim is the whole guard against a dry run performing what it was meant only to describe.

`values` is `(claim) => WorkflowValueResolverPort` — a function, not a port, because a resolver answers under one run's scope and actor while a worker serves every run in the app.

The language manifest derives from the same declarations: `workflowActionDescriptors(APP_ACTIONS, namespace?)`. Never restate a descriptor by hand.

## Starting runs

Everything that starts work is an event — a schedule tick, a button press, an inbound message. There is no separate registration path for any of them.

```typescript
import { emitWorkflowEvent } from "@valentinkolb/cloud/workflows/store";

// A user pressed a button: dispatch inline so the caller gets run ids back
// without a round trip through a queue.
const { runIds } = await emitWorkflowEvent(
  { appId: "grids", scopeId: baseId, type: "grids.recordChanged", data: { rowId }, authorization, dedupeKey },
  { dispatch: "now", db: tx },
);

// Something merely happened: record it and let the worker pick it up. A failing
// dispatch would otherwise roll back the event and lose the occurrence itself.
await emitWorkflowEvent({ appId: "grids", scopeId: baseId, type: "grids.recordChanged", data: { rowId } });
```

A run only exists if an **activation** binds that event type to a version. An app that can always be invoked directly has to say so: Grids writes unconditional `invoked` and `launcherPressed` activations on every publish, because being runnable is not a trigger anyone wrote.

Pass `dedupeKey` for any source that can repeat itself — a schedule slot, a provider redelivery, a double-clicked button. The same key records one event and therefore starts one run, and the second call is answered with the first one's run ids.

**A dry run is not an event.** Nothing happened; somebody is asking what would. Create it directly with `createWorkflowRun({ mode: "dryRun", workflowVersionId, ... })` against the version being asked about.

If your app keeps its own row alongside the run — which base, which button, who — **write it in the same transaction**. A committed run is immediately claimable, and a row written afterwards leaves a window in which a worker picks the run up and finds no scope.

### The authorization snapshot

`authorization` is frozen when the run is accepted, so an edit to a group membership cannot widen what a queued run may do. The kernel reads one key from it:

```typescript
{ actor: { userId, groupIds, serviceAccountId }, /* whatever else your app needs */ }
```

Everything else in the object is yours. An unrecognised snapshot yields an **empty** actor and every permission check refuses — inventing a system identity is how a run acts with more authority than whoever asked for it.

## Effects that leave the process

**You do not journal effects yourself.** `createWorkflowActionPort` does it around your `run` hook, in the one order that cannot overspend or lose evidence: plan, charge, mark, act, settle. An ambiguous effect is marked before it acts and settled after; a transactional one records its outcome inside its own transaction.

The budget is charged from your `plan` hook — the same hook a dry run reads — so preflight and execution cannot disagree about what an action costs. Return `consumes` and the port charges it against the root of a fan-out, because a fan-out over ten thousand records would otherwise authorise ten thousand times the cap.

An effect left `executing` or `ambiguous` is one that may already have happened. A replay refuses to repeat it — repeating is how the same message goes out twice — so `reconcile` is asked, and if it still cannot say, the run surfaces on the admin page and in `cld admin workflows effects` for a human.

## Fan-out

Fan-out is child runs, not a targets table.

```typescript
await createChildWorkflowRuns({ runId: ctx.runId, stepKey: ctx.stepKey }, items.map(...));
```

A child is an ordinary run: same lease protocol, same journal, same observability. The parent reads its progress as one aggregate (`countChildWorkflowRuns`), and the admin page hides children until you open the parent.

## Watching a run

`trace?: WorkflowTracePort` receives `run.started`, `step.started`, `step.finished`, `step.waiting`, `step.restored`, `run.canceled`, `run.finished`. The run-level events bracket the step-level ones: without them a queued run appears to sit still until its first step reports, and one that fails before any step never announces that it stopped.

Events are deliberately thin — which run, what happened. Re-read the row; an event carrying a copy of it is one more thing to keep in step. Emission is best-effort: an observer that throws must not be able to cost a run its outcome.

## Vocabulary

A **run** succeeds. A **step** completes. Run states are `queued | running | waiting | succeeded | failed | canceled | needs_attention`; step states are `running | completed | waiting | failed | needs_attention | terminal | planned | unsupported | indeterminate | canceled`. Reusing the run's words for steps is how a finished step ends up rendered as still running.

## What stays in your app

Action implementations, the event vocabulary, what fires them, and your own API, CLI and UI. If you are writing anything else — a run table, a lease, a retry loop, a dry-run mode, a health endpoint, an effect journal — check whether the kernel already owns it. It probably does.

Nothing in the kernel references an app's tables, deliberately, so `app_id` and `scope_id` are opaque strings. That cuts both ways: **deleting your scope's rows does not cascade into the kernel.** Call `deleteWorkflowScope({ appId, scopeId })` when a scope really goes away, and do the same in test teardown or the shared dev database fills up with orphans.

## Observability comes free

Runs, causes, steps, effects and budgets are already on `/admin/observability/workflows` and in `cld admin workflows` (`runs`, `show`, `effects`, `events`, `health`). Do not build an app-specific run list; a per-app health port is exactly the thing that moving storage into the kernel removed.
