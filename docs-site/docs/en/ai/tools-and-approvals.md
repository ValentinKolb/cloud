---
title: Tools and approvals
navTitle: Tools and approvals
section: AI
order: 1040
description: Let models request application actions while keeping authorization and approval explicit.
tags: [ai, tools, approvals]
updated: 2026-08-12
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

### Run an optional tool in a local CLI

The interactive Assistant CLI may opt one turn into the predefined
`local_bash` client tool with `cld assistant --allow-bash`. AI Core persists
the tool call and its result, but it never executes the command. The CLI shows
the exact command and asks for confirmation before starting `/bin/bash` as the
current OS user in the CLI's startup directory.

The Assistant web app does not advertise or execute this tool. It still shows
persisted local Bash calls and results in conversation history. A pending call
is read-only there and can be continued only by an opted-in local CLI.

Local command output is stored with the conversation and sent to the selected
model. Treat retrieved mail, webpages, files, and tool output as untrusted:
`--allow-bash` exposes the tool for the session, but never approves an
individual command. There is no remembered or non-interactive Bash approval.

## Set the approval policy

This policy belongs to tools declared with `defineAiTool()`. Dynamically loaded
app Capability Actions use the fixed AI Core policy described below.

| Policy | Behavior |
| --- | --- |
| `never` | Executes without an approval prompt |
| `once` | Requires approval for each call |
| `always` | Allows the user to remember approval |
| `{ kind: "user-configurable", default, scope }` | Uses a configurable default and optional shared scope |

The default is `once`.

Remembered approval is scoped to the actor, tool, and declared approval scope.
Only use a shared scope when every call covered by it has the same consequence.

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

`view_image` is a safe read over one authorized conversation or read-only
Project file. Its input is an absolute file path and optional bounded guidance;
Project files are mounted below `/project`. Cloud validates the image type and
size, invokes the selected model when it supports Vision or the
administrator-selected Vision tool model otherwise, and returns a bounded
description. Image contents remain untrusted data. Without either usable Vision
path, the tool reports that image inspection is unavailable.

## Search product Help

A user-backed personal chat on a tool-capable model resolves `search_help` and
`read_help` dynamically from app-owned Help registration. They do not require
Capability discovery because static product guidance is separate from
executable operations. A registry failure stays local to Help and may be tried
again on a later model turn. See
[In-product Help](/en/docs/platform/help) for the owning declaration and
exposure rules.

## Discover Cloud app capabilities

A personal chat uses the live capability catalog through its default tool
source:

```ts
toolSource: { kind: "default", capabilities: true }
```

Capability-enabled chats expose four bounded discovery tools from the current
live registry snapshot:

- `search_capabilities` includes a bounded directory of live app IDs and names,
  then finds operations by task, app name, app description, operation metadata,
  and `query` or `action` kind;
- `list_capability_apps` returns the live apps with their exact IDs, names, and
  descriptions when the compact directory is not enough;
- `list_capabilities` lists a bounded page, optionally filtered by application
  and kind;
- `load_capabilities` retains exact names returned by discovery.

A loaded capability becomes an ordinary named tool on the next model turn.
Cloud gives the model the operation's structure, required fields,
descriptions, enums, and useful formats. The provider remains responsible for
authoritative input validation and the complete result contract. If an
operation disappears from the live catalog, AI Core treats it as temporarily
unavailable rather than inferring a replacement.

Discovery is not authorization. Every invocation resolves the conversation's
current user, creates a short-lived request delegation, and lets the owning app
authenticate and authorize the operation again. Cloud never persists or
replays the user's browser cookie, bearer token, resource API key, or service
account credential for this path. An unavailable app or denied resource fails
that tool call without granting fallback access.

The chat stores loaded operation names, not provider credentials or private
contracts. When a result contains a semantic `open` or `edit` link, clients use
that exact path instead of inferring a route from a resource ref.

Never retry `ACTION_OUTCOME_UNKNOWN`. `INVALID_APP_RESPONSE` and `INTERNAL`
indicate a provider defect. Do not retry the same capability with unchanged
arguments; report the failure so the app can be fixed. Input validation and
schema mismatch errors may be corrected or refreshed according to their
structured error code.

The full provider declaration, schema, result, compatibility, and transport
contract lives in [App capabilities](/en/docs/platform/capabilities).

### Approve Capability Actions

AI Core treats capability operation kinds as the approval boundary:

| Capability kind | AI Core behavior |
| --- | --- |
| Query | Execute without interactive approval |
| Action without `approval` | Require fresh approval for that call |
| Action with `approval: "rememberable"` | Require fresh approval for that call |

Capability manifests describe objective Action properties such as `openWorld`,
`destructive`, idempotency, and the optional availability of a review. AI Core
currently does not remember Capability Action approvals, including Actions
that declare `approval: "rememberable"`: a safe reusable scope can depend on
the owning app's concrete arguments and resources. Add remembered Capability
approval only with a canonical app-owned scope contract; do not infer it from a
conversation attachment or resource ID.

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
live registry and manifest. Once presented, the resolved review is stored with
the pending action and active-turn snapshot; reconnecting or reopening the chat
must render that same snapshot rather than recomputing or degrading it.

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

Show the tool name, requested inputs, and consequence before approval. The
primary action uses a split button; its **Details** item toggles the complete
validated arguments for technical verification. Do not require ordinary users
to read that raw representation: every value needed for an informed decision
belongs directly in the review card. Capability Actions currently expose only
one-time approval. For tools that do allow a remembered choice, approving once
stays the primary action and **Always approve** remains an explicit secondary
choice.
When a Capability review is available, show it instead of making the user
interpret opaque IDs in the raw arguments. Review details default to the
compact `inline` presentation; `display: "block"` gives long plain-text values
their own bounded section. The hint never enables HTML or Markdown rendering,
and semantic review links remain clickable same-origin links.

Users can list and revoke their remembered choices in Assistant under
**Personalization → Approvals**. Revocation is ownership-scoped and takes
effect on the next matching call.

See [Resource authorization](/en/docs/identity/authorization) for the domain
permission check.
