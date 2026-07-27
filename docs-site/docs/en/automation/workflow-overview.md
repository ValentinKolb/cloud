---
title: Workflow overview
navTitle: Workflow overview
section: Automation
order: 660
description: Understand when durable workflows are the correct automation model.
tags: [workflows, durability, automation]
updated: 2026-07-27
---

# Workflow overview

Use the workflow kernel when people define multi-step automation that must
survive restarts and remain explainable.

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

Start with [Author and publish workflows](/docs/en/automation/author-and-publish-workflows).
Read [Effects, retry, and reconciliation](/docs/en/automation/effects-retry-and-reconciliation)
before implementing external side effects.
