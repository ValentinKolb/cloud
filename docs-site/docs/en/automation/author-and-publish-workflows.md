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

The manifest is the complete authoring language accepted by one application:

```ts
import {
  type WorkflowLanguageManifest,
  workflowBuiltinActionDescriptors,
} from "@valentinkolb/cloud/workflows";
import {
  workflowActionDescriptors,
} from "@valentinkolb/cloud/workflows/store";

export const inventoryWorkflowManifest = {
  id: "inventory",
  version: 1,
  inputs: [
    {
      kind: "text",
      label: "Text",
      description: "A text value supplied to the workflow.",
      valueType: "core.string",
      config: {
        kind: "object",
        properties: {
          required: { kind: "boolean", optional: true },
        },
      },
    },
  ],
  triggers: [
    {
      kind: "itemChanged",
      label: "Item changed",
      description: "Starts when an inventory item changes.",
      eventValues: { itemId: "core.string" },
      config: { kind: "object", properties: {} },
    },
  ],
  actions: [
    ...workflowActionDescriptors(INVENTORY_ACTIONS),
    ...workflowBuiltinActionDescriptors,
  ],
  limits: {
    maxInputs: 20,
    maxSteps: 200,
    maxDepth: 20,
    maxConditions: 200,
    maxConditionDepth: 20,
    maxLoopItems: 500,
  },
} satisfies WorkflowLanguageManifest;
```

`workflowActionDescriptors()` keeps descriptors and implementations together.
Built-in actions provide variable assignment and explicit success or failure.

Set limits before accepting source. Changing the language requires a new
manifest version.

## Compile and bind

The source uses strict YAML. It may only use inputs, triggers, actions, and
limits declared by the manifest:

```yaml
inputs:
  itemId:
    type: text
    required: true
triggers:
  itemChanged:
    with:
      itemId: "${{ trigger.itemId }}"
steps:
  - loadItem:
      itemId: "${{ inputs.itemId }}"
```

Compile before binding:

```ts
import {
  bindWorkflow,
  compileWorkflow,
} from "@valentinkolb/cloud/workflows/language";

export const compileAndBindInventoryWorkflow = async (
  source: string,
) => {
  const compiled = await compileWorkflow(
    source,
    inventoryWorkflowManifest,
  );
  if (!compiled.ok) return compiled;

  const plan = await bindWorkflow(
    compiled.ir,
    inventoryWorkflowManifest,
    async (ir) => {
      const catalog = await loadInventoryWorkflowCatalog();
      return {
        catalog,
        bindings: await bindInventoryReferences(ir, catalog),
      };
    },
  );
  return { ok: true as const, plan };
};
```

Compilation validates YAML, fields, references, and limits. It returns
source-located diagnostics instead of throwing for invalid user input.

The binder converts mutable names into stable application IDs. Its `catalog`
is hashed into the plan. Its `bindings` are available to actions through
`ctx.binding()`.

Return compiler diagnostics to the editor. Convert application catalog or
binding failures into equally clear editor errors. Do not publish an invalid
plan.

## Publish one version

Create the workflow identity once. Then publish immutable versions:

```ts
import type {
  WorkflowBoundPlan,
} from "@valentinkolb/cloud/workflows";
import {
  createWorkflow,
  publishWorkflowVersion,
  type WorkflowActivationInput,
} from "@valentinkolb/cloud/workflows/store";

const activationsFor = (
  plan: WorkflowBoundPlan,
): WorkflowActivationInput[] =>
  plan.triggers.map((trigger, index) => ({
    key: `${trigger.kind}:${index}`,
    eventType: `inventory.${trigger.kind}`,
    config: { ...trigger.config, with: trigger.with },
  }));

const validation = await compileAndBindInventoryWorkflow(source);
if (!validation.ok) throw new Error("workflow source is invalid");
const boundPlan = validation.plan;

const workflow = await createWorkflow(
  {
    appId: "inventory",
    scopeId: warehouseId,
    key: "restock",
    name: "Restock inventory",
    author: { kind: "user", id: actor.id },
  },
  { db: transaction },
);

await publishWorkflowVersion(
  {
    workflowId: workflow.id,
    source,
    sourceHash: boundPlan.sourceHash,
    plan: boundPlan,
    languageId: boundPlan.languageId,
    languageVersion: boundPlan.languageVersion,
    manifestHash: boundPlan.manifestHash,
    author: { kind: "user", id: actor.id },
    activations: activationsFor(boundPlan),
    authorization: authorizationSnapshot,
  },
  { db: transaction },
);
```

Publication writes the version and replaces its activations in one transaction.
An event cannot fall into a gap between old and new activations.

Activation keys must remain stable for the same logical trigger. Event types
are application contracts; the workflow kernel does not derive them.

Each run pins the active version when its event is recorded. Publishing later
does not change that run.

Set `activate: false` for a stored draft that must not become live.

The application owns workflow names and app-specific profile data. Store that
data in the same transaction as kernel publication.

Use [Start workflow runs](/docs/en/automation/emit-events-and-start-runs) after
publication.
