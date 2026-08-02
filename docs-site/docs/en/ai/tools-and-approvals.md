---
title: Tools and approvals
navTitle: Tools and approvals
section: AI
order: 1040
description: Let models request application actions while keeping authorization and approval explicit.
tags: [ai, tools, approvals]
updated: 2026-08-02
---

# Tools and approvals

A tool gives the model a named action with validated input and output.

The model may request the action. Cloud still controls where it runs, whether
approval is required, and which actor reaches the implementation.

## Define a server tool

```ts
import { defineAiTool } from "@valentinkolb/cloud/ai";
import { z } from "zod";

export const archiveItem = defineAiTool({
  name: "archive_item",
  description: "Archive one inventory item.",
  inputSchema: z.object({
    itemId: z.string().uuid(),
  }),
  outputSchema: z.object({
    archived: z.boolean(),
  }),
  approval: "once",
  timeoutMs: 10_000,
  promptHint: "Use this when the user asks to archive an item.",
  toHistoricalResult: ({ output }) => output,
}).server(async ({ itemId }, { actor, signal }) => {
  await authorizeArchive(actor, itemId);
  await archive(itemId, { signal });
  return { archived: true };
});
```

The implementation receives the current request actor, abort signal, and
conversation ID.

Always authorize inside the tool. Approval confirms user intent. It does not
grant domain permission.

## Choose where it runs

| Builder | Execution |
| --- | --- |
| `.server(run)` | Cloud runs the implementation |
| `.client()` | Browser handles the call |
| `.clientView()` | Browser handles a view-only interaction |
| `.clientInteraction()` | Browser handles an interactive action |

Register browser handlers with `createAiChatController({ frontendTools })`.
Submit the result through the controller. The runtime validates it against the
tool output schema before continuing.

Use a server tool for domain reads and writes. Use a frontend tool only when
the action requires browser state or direct user interaction.

## Set the approval policy

| Policy | Behavior |
| --- | --- |
| `never` | Executes without an approval prompt |
| `once` | Requires approval for each call |
| `always` | Allows the user to remember approval |
| `{ kind: "user-configurable", default, scope }` | Uses a configurable default and optional shared scope |

The default is `once`.

Remembered approval is scoped to the actor, application, resource, tool, and
approval scope. A resource chat does not share approval with another resource.

Use `never` only for safe reads or deterministic presentation. Writes and
external side effects should require approval.

## Tool contracts

Use Zod schemas that contain only data required for the action.

Set `timeoutMs` for bounded work. Pass the abort signal to downstream calls.

Use `toHistoricalResult` when a full tool result is useful now but too large to
send to the model in later loops. Cloud still persists the full result for the
user.

`promptHint` adds a short usage hint to the system prompt. It does not replace
the tool description.

## Discover Cloud app capabilities

A direct chat may opt into the live capability catalog through its default tool
source:

```ts
toolSource: { kind: "default", capabilities: true }
```

Capability-enabled chats always expose three small discovery tools:

- `search_capabilities` finds operations by task, name, application, and
  `query` or `action` kind;
- `list_capabilities` lists a bounded page, optionally filtered by application
  and kind;
- `load_capabilities` retains exact names returned by discovery.

A loaded capability becomes an ordinary named tool on the next model turn.
Cloud sends the model a reduced input schema that keeps structure, required
fields, descriptions, enums, and useful formats. Output schemas, schema hashes,
icons, authorization metadata, and validation-only limits stay out of model
context. The owning application still performs authoritative input validation.

Discovery is not authorization. Every invocation resolves the conversation's
current user, creates a short-lived request delegation, and lets the owning app
authenticate and authorize the operation again. Cloud never persists or
replays the user's browser cookie, bearer token, resource API key, or service
account credential for this path. An unavailable app or denied resource fails
that tool call without granting fallback access.

The chat stores only ordered loaded capability names. Removed or temporarily
unavailable operations are omitted from later snapshots. Capability calls save
a small app presentation snapshot so live calls and history can show the owning
app without exposing icon metadata to the model.

## Handle approval in the UI

The stream exposes pending actions. The shared controller provides:

- `respondToApproval({ turnId, callId }, { approved, remember })`;
- `submitFrontendToolResult({ turnId, callId }, result)`.

Show the tool name, requested inputs, and consequence before approval.

See [Resource authorization](/docs/en/identity/authorization) for the domain
permission check.
