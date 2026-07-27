---
title: Author and publish workflows
navTitle: Author workflows
section: Automation
order: 680
description: Build a workflow definition and publish a version that can be executed.
tags: [workflows, authoring, publication]
updated: 2026-07-27
---

# Author and publish workflows

An application defines the language its users can author. It compiles and binds
source before publishing an immutable version.

## Define events and actions

```ts
import {
  workflowAction,
  workflowEvent,
} from "@valentinkolb/cloud/workflows";

export const INVENTORY_EVENTS = {
  itemChanged: workflowEvent({
    label: "Item changed",
    description: "An inventory item changed.",
    data: {
      kind: "object",
      properties: {
        itemId: { kind: "string" },
      },
    },
  }),
};

export const INVENTORY_ACTIONS = {
  loadItem: workflowAction.pure({
    label: "Load item",
    description: "Loads the item captured by the workflow.",
    config: {
      kind: "object",
      properties: {
        item: { kind: "string" },
      },
    },
    run: async (_ctx, input) => ({
      state: "succeeded",
      output: { itemId: input.item },
    }),
  }),
};
```

Workflow schemas are serializable `WorkflowFieldSchema` objects. They are not
Zod schemas. The editor and compiler need the schema at runtime.

Action config supports string, number, boolean, value, array, record, union,
and object fields. Keep the schema as a literal so TypeScript can infer the
handler input.

Names are local keys. Namespace emitted event types with the app ID, such as
`inventory.itemChanged`.

## Choose an effect class

| Factory | Promise | Required hooks |
| --- | --- | --- |
| `pure` | Output is deterministic from inputs and prior outcomes | `run` |
| `transactional` | Work commits in the journal transaction | `run`, `plan` |
| `idempotent` | External work is safe to repeat under `effectKey` | `run`, `plan` |
| `ambiguous` | External work may need later verification | `run`, `plan`, `reconcile` |

A database read of mutable state is not pure. A replay can return a different
value.

`authorize` may re-check permission immediately before an effect. Other
validation belongs in `run` so its failure keeps a useful code.

## Build the language manifest

Use `workflowActionDescriptors(INVENTORY_ACTIONS)` to derive action
descriptors. Add input and trigger descriptors that belong to the application.
Include `workflowBuiltinActionDescriptors` when authors may use the built-in
control actions.

The manifest declares limits for inputs, steps, nesting, conditions, and loop
items. Set limits before accepting source.

Do not write action descriptors separately from implementations.

## Compile and bind

Call `compileWorkflow(source, manifest)` first. Compilation validates syntax,
fields, references, and limits.

Then bind names from the source to stable application IDs. A bound plan must
keep referring to the same table, template, or resource after a rename.

Return compiler and binder diagnostics to the editor. Do not publish a plan
with errors.

## Publish one version

```ts
await publishWorkflowVersion(
  {
    workflowId,
    source,
    sourceHash,
    plan: boundPlan,
    languageId: manifest.id,
    languageVersion: manifest.version,
    manifestHash: boundPlan.manifestHash,
    author: { kind: "user", id: actor.id },
    activations,
    authorization: authorizationSnapshot,
    effectBudget: { emails: 20 },
  },
  { db: transaction },
);
```

Publication writes the version and replaces its activations in one transaction.
An event cannot fall into a gap between old and new activations.

Each run pins the active version when its event is recorded. Publishing later
does not change that run.

Set `activate: false` for a stored draft that must not become live.

The application owns workflow names and app-specific profile data. Store that
data in the same transaction as kernel publication.

Use [Start workflow runs](/docs/en/automation/emit-events-and-start-runs) after
publication.
