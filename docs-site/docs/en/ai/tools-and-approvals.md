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

This policy belongs to tools declared with `defineAiTool()`. Dynamically loaded
app Capability Actions use the fixed AI Core policy described below; capability
apps do not choose or enforce an AI approval policy.

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

`promptHint` adds one short usage nudge to the system prompt. Use it when the
model could finish with plain text but Cloud prefers the tool-backed experience,
as with cards, surveys, or presented files. Keep operation details and arguments
in the tool description and schema; the hint does not replace either.

## Search product Help

A user-backed direct chat on a tool-capable model exposes two small Help tools:

- `search_help` searches the current static Help corpus and returns compact
  article identifiers;
- `read_help` reads one exact article returned by search.

AI Core resolves these tools dynamically from app-owned Help registration.
They do not require `toolSource.capabilities` because static product guidance
is separate from executable app operations. A registry read failure stays
local to Help and is retried on a later provider turn.

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

Capability search matches whole normalized task words, handles simple plural
forms, and ranks operations by how many requested terms they cover. Callers do
not need to reproduce one contiguous title or description phrase. Prefer a few
concrete product terms, scope the exact `appId` when it is already known, and
set `kind: "query"` for reads or `kind: "action"` for mutations. Use the
paginated list only for browsing, not as a fallback dump after a
natural-language search.

A loaded capability becomes an ordinary named tool on the next model turn.
Cloud sends the model a reduced input schema that keeps structure, required
fields, descriptions, enums, and useful formats. Output schemas, schema hashes,
icons, authorization metadata, and validation-only limits stay out of model
context. The owning application still performs authoritative input validation.

When a request names or clearly implies an app, discovery scopes the first
search or list to that exact `appId`. If no relevant operation is found, the
agent may try one broader search, then stops instead of cycling through
synonyms. If a previously loaded operation is absent from the live catalog,
AI Core tells the model that it is temporarily unavailable. The model must not
turn that transient registry state into a permanent claim about product
features or infer an available operation merely because another capability
description mentions it.

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

When a capability returns a semantic Cloud `open` or `edit` link, the model
renders that exact path as a Markdown link when directing the user to the
resource. It does not infer routes from refs or IDs, and it prefers the Cloud
resource link over secondary protocol actions such as `mailto:` or `tel:`.

Never retry `ACTION_OUTCOME_UNKNOWN`. `INVALID_APP_RESPONSE` and `INTERNAL`
indicate a provider defect. Do not retry the same capability with unchanged
arguments; report the failure so the app can be fixed. Input validation and
schema mismatch errors may be corrected or refreshed according to their
structured error code.

### Approve every Capability Action

AI Core treats capability operation kinds as the approval boundary:

| Capability kind | AI Core behavior |
| --- | --- |
| Query | Execute without interactive approval |
| Action | Require fresh approval for that call |

Capability manifests therefore describe objective Action properties such as
`openWorld`, `destructive`, idempotency, and the optional availability of a
review. They do not declare an AI approval policy. AI Core never remembers an
approval for a dynamically loaded Capability Action. `openWorld` and
`destructive` affect the warning shown to the user, not whether approval is
required.

This approval confirms the user's intent for one model-requested call. It is
not application authorization. After approval, the owning app validates the
same arguments and checks current resource access and domain invariants before
performing the Action.

### Show an optional Action review

An Action may publish the fixed optional
[capability review](/en/docs/platform/capabilities#describe-an-action-before-it-runs).
After the model requests such an Action, AI Core resolves the review with the
current user and the same arguments before presenting the approval.

The review is UI-only. Cloud renders its bounded message, details, and
same-origin link paths as escaped plain text above the validated Action
arguments. It is never added to model context or returned as a tool result.
The app name, icon, Action title, and risk treatment continue to come from the
live registry and manifest.

If no review is advertised, the approval shows the validated Action arguments.
If an advertised review fails, Cloud does not silently fall back to the weaker
display and does not execute the Action. The user may retry after the app or
resource becomes reviewable again.

A review does not alter arguments, grant permission, record consent, or replace
an app-owned safety workflow. For example, a domain fingerprint or optimistic
revision required by an Action remains part of the Action input and is enforced
again by the owning app.

## Handle approval in the UI

The stream exposes pending actions. The shared controller provides:

- `respondToApproval({ turnId, callId }, { approved, remember })`;
- `submitFrontendToolResult({ turnId, callId }, result)`.

Show the tool name, requested inputs, and consequence before approval.
For a Capability Action, `allowAlways` is always false. When a review is
available, show it instead of making the user interpret opaque IDs in the raw
arguments.

See [Resource authorization](/en/docs/identity/authorization) for the domain
permission check.
