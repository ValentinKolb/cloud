---
title: Workflow overview
navTitle: Workflow overview
section: Automation
order: 660
description: Understand when durable workflows are the correct automation model.
tags: [workflows, durability, automation]
updated: 2026-08-12
---

# Workflow overview

Use the workflow kernel when people define multi-step automation that must
survive restarts and remain explainable.

The kernel is justified when a run needs an immutable explanation of what was
planned, which steps completed, which external effects may have happened, and
what an operator can safely do next. Use a job instead when one typed operation
only needs durable at-least-once execution; use application code when the
sequence is fixed and no durable run history is a product requirement.

The application supplies actions, events, authoring rules, and value
resolution. Cloud owns versioned plans, runs, leases, waiting, retries, effect
journals, budgets, and operations views.

## Workflow execution model

```text
source → compiled and bound plan → immutable version
event  → activation → run pinned to that version
run    → step outcomes and effect journal
```

A run never switches to a newer version after it starts. A recorded step
outcome is never recomputed.

Recovery follows the normal execution loop: find the first step without an
outcome, execute it, and record the result.

## Application and kernel ownership

The application owns:

- action implementations and their effect classes;
- event names and payload schemas;
- compiling and binding user-authored source;
- sources that emit events;
- domain authorization and value resolution;
- app-specific editor and API behavior.

The kernel owns:

- workflow identities, versions, and activations;
- events, runs, leases, and crash recovery;
- step outcomes, waits, and child runs;
- effect journals and execution budgets;
- dry-run execution and operations data.

`appId` and `scopeId` are opaque to the kernel. Deleting application rows does
not delete workflow data. Call `deleteWorkflowScope()` when the owning scope is
removed.

## Workflow rules

1. Publish immutable plans. A run pins one version.
2. Make a step depend only on its inputs and recorded prior outcomes.
3. Never repeat an outcome that the journal already contains.

A step that reads mutable state is not pure. A replay can observe a different
value.

The following pages form one lifecycle rather than five alternative APIs:

1. [Author and publish](/en/docs/automation/author-and-publish-workflows) an
   immutable plan.
2. [Emit an event](/en/docs/automation/emit-events-and-start-runs) to create a
   run pinned to that plan.
3. Apply the [effect and recovery contract](/en/docs/automation/effects-retry-and-reconciliation)
   while workers execute it.
4. Use [operations and tests](/en/docs/automation/workflow-observability-and-testing)
   to inspect, resolve, and verify the result.

Read the effect contract before implementing any external side effect.
