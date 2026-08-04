---
title: AI resources and access
navTitle: Resources and access
section: AI
order: 1010
description: Apply Cloud identity and resource permissions to AI features.
tags: [ai, authorization, resources]
updated: 2026-07-27
---

# AI resources and access

Use `defineAiResource()` when a chat belongs to a domain resource.

The resource definition binds a URL, resource identity, access check, model
policy, context, and tools. Cloud runs the access check before every resource
route and again before a server tool runs.

## Define a resource

```ts
import { defineAiResource, defineAiTool } from "@valentinkolb/cloud/ai";
import { z } from "zod";

export const itemAi = defineAiResource({
  appId: "inventory",
  id: "item",
  path: "/items/:itemId",
  params: z.object({
    itemId: z.string().uuid(),
  }),
  access: async ({ params, actor }) => {
    const item = await loadItemForActor(params.itemId, actor);
    return item
      ? { allowed: true, data: item }
      : { allowed: false, reason: "Item not found" };
  },
  resourceId: "itemId",
  resourceTitle: ({ access }) => access.name,
  modelPolicy: {
    kind: "selectable",
    requiredCapabilities: ["streaming", "tools"],
  },
  systemPrompt: "Help the user understand and update this item.",
  context: ({ access }) => JSON.stringify({
    id: access.id,
    name: access.name,
    stock: access.stock,
  }),
  tools: ({ params }) => [
    defineAiTool({
      name: "update_item",
      description: "Update this inventory item.",
      inputSchema: z.object({
        name: z.string().min(1),
      }),
      outputSchema: z.object({
        updated: z.boolean(),
      }),
      approval: "once",
    }).server(async ({ name }, { actor, signal }) => {
      await updateItemForActor({
        itemId: params.itemId,
        name,
        actor,
        signal,
      });
      return { updated: true };
    }),
  ],
});
```

The path parameters and Zod schema are connected by TypeScript. Every named
path parameter must exist in `params`.

The tool closes over the validated resource ID. It authorizes the requested
write for the current actor. Model input cannot select another item.

## Set each field

| Field | Purpose |
| --- | --- |
| `appId` | Owns conversations and audit scope |
| `id` | Stable resource type inside the application |
| `path` | Mount path for the generated chat routes |
| `params` | Validates path parameters |
| `access` | Authorizes the current actor and returns safe data |
| `resourceId` | Selects or computes the stable resource ID |
| `resourceTitle` | Adds a user-facing title |
| `modelPolicy` | Limits models and capabilities |
| `systemPrompt` | States application behavior |
| `context` | Supplies current resource data |
| `tools` | Supplies actions available for the turn |

`access` receives validated parameters, the request actor, and the request
abort signal. Later hooks also receive the value returned by `access`.

## Mount the routes

```ts
import {
  auth,
  middleware,
  type AuthContext,
} from "@valentinkolb/cloud/server";
import { Hono } from "hono";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .use("*", auth.requireRole("authenticated"))
  .use("*", auth.requireUser())
  .route("/api/inventory/ai", itemAi.routes());
```

The resource path remains part of the URL. For the example above, conversations
start below `/api/inventory/ai/items/:itemId`.

## Authorize every resource operation

Return `{ allowed: false }` before reading protected context.

Cloud re-runs `access` for chat requests. It also checks resource access again
before a server tool runs.

The tool still authorizes its specific operation. Approval confirms intent. It
does not grant write permission.

The access result is application data. Return only what later hooks need.

> Do not put secrets or inaccessible fields in `context`. Prompt text is sent
> to the selected model.

For the underlying actor model, see [Resource authorization](/en/docs/identity/authorization).
For tool approval, see [Tools and approvals](/en/docs/ai/tools-and-approvals).
