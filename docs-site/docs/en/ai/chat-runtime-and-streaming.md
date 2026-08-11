---
title: Chat runtime and streaming
navTitle: Chat and streaming
section: AI
order: 1030
description: Run bounded chat sessions and stream model output to an application.
tags: [ai, chat, streaming]
updated: 2026-08-11
---

# Chat runtime and streaming

`createAiChatRoutes()` provides the shared conversation and turn API.

Use it for a standalone chat. Use
[`defineAiResource()`](/en/docs/ai/resources-and-access) when the chat belongs
to a domain resource.

## Create chat routes

```ts
import {
  aiMaintenanceJobs,
  createAiChatRoutes,
  migrateCloudAi,
  startAiRuntime,
} from "@valentinkolb/cloud/ai";
import {
  auth,
  expectUserBackedActor,
  middleware,
  type AuthContext,
} from "@valentinkolb/cloud/server";
import { Hono } from "hono";

const chatRoutes = createAiChatRoutes({
  appId: "assistant",
  allowConversationManagement: true,
  modelListPolicy: {
    kind: "selectable",
    requiredCapabilities: ["streaming"],
  },
  resolveContext: async (c) => {
    const actor = c.get("actor");
    const user = expectUserBackedActor(c);

    return {
      actor,
      ownerUserId: user.id,
      toolSource: { kind: "none" },
      systemPrompt: "Help with writing and planning.",
      modelPolicy: { kind: "selectable", requiredCapabilities: ["streaming"] },
    };
  },
});

const chatApi = new Hono<AuthContext>()
  .use("*", auth.requireRole("authenticated"))
  .use("*", auth.requireUser())
  .route("/", chatRoutes);

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/assistant", chatApi);
```

Protect the entire mount. `/status` and `/models` return sanitized state but do
not call `resolveContext()`.

This minimal chat has no tools. Use a resource tool source for tools declared
by `defineAiResource()`.

The default tool source adds card and survey interactions, bounded
conversation-file tools, arithmetic and deterministic date calculation, and web search or
extraction when Firecrawl is configured. These built-in tools use
`approval: "never"`. They provide no arbitrary code execution, host access, or
network access beyond the explicit web tools. Enable the default set only when
the chat needs those capabilities. See
[Tools and approvals](/en/docs/ai/tools-and-approvals).

An interactive Assistant CLI turn may additionally request the fixed
`local_bash` client tool. It is not part of the default set: Cloud persists and
streams its calls but has no shell executor, and browser clients neither opt in
nor register a handler. See the local CLI boundary in
[Tools and approvals](/en/docs/ai/tools-and-approvals#run-an-optional-tool-in-a-local-cli).

`toolSource: { kind: "default", capabilities: true }` additionally enables the
compact Cloud app capability discovery tools. It is an explicit opt-in: other
chat and resource consumers keep their existing tool surface. Capability tools
require a model profile with `tools` support and a current direct user actor;
service-backed agent identities are not part of this contract.

The shared platform prompt separates platform rules, a short execution loop,
conditional tool guidance, and labeled application context. It tells agents to
use required tools, inspect their results, and continue until the request is
complete or genuinely blocked. Retrieved emails, webpages, user files, Help,
capability results, ordinary tool output, Project context, and memories remain
data rather than instructions. Project instructions and the Project context
manifest are copied into the durable turn configuration. Current Project access
is checked again before execution; edits affect the next turn. The runtime still
treats a provider `stop` as
a completed turn; it does not infer unfinished work from model text or trigger
language-dependent automatic retries.

## Chat route groups

| Group | Purpose |
| --- | --- |
| `/status`, `/models` | Read sanitized runtime and model state |
| `/prefs` | Read or update personalization enablement and learning settings |
| `/memories`, `/memories/:id` | Search and manage structured personal facts and preferences |
| `/conversations` | List and create conversations |
| `/conversations/:id` | Read or manage one conversation |
| `/conversations/:id/messages/search` | Search visible text inside one owned conversation |
| `/conversations/:id/resources` | List or filter structured Cloud refs observed in one conversation |
| `/resources` | List or filter structured Cloud refs across the user's active conversations |
| `/conversations/:id/turns` | Start, steer, or stop work |
| `/conversations/:id/stream` | Receive Server-Sent Events |
| `/conversations/:id/files` | Manage conversation files |

The router also supports message retry, forks, compaction, pending tool
actions, conversation enrichment, and paged history.

Chat search keeps the existing title, description, and keyword substring
matches, then adds weighted native PostgreSQL full-text search over an internal
rolling search summary and visible user and Assistant message text. Raw message
matches remain eligible even when the summary omits a detail. When
`pg_textsearch` and both exact conversation indexes are installed, BM25 ranks
the same result set; known extension-capability failures fall back to native
FTS. Ownership, app, status, resource, archive, count, and pagination filters
apply before results are returned.

The Assistant app publishes five closed-world conversation queries:

- `chats.search` finds owned chats by visible text or exact structured Cloud
  refs;
- `chat.read` pages visible user and Assistant text from one explicit chat;
- `chat.search` searches visible text inside one explicit chat, including
  compacted history;
- `chat.resources` lists refs observed in one explicit chat;
- `chats.resources` lists ref occurrences across the user's active chats.

Each query rechecks the current user at execution time. Message results omit
tool results and model thinking. Resource discovery uses only schema-valid
`CloudResourceRef` and `CloudResourceView` values observed in Project context
or capability arguments and results; it never extracts identities from prose.
The normalized index keeps an app-owned ID plus a display snapshot and source
turn/call where available. The migration deliberately does not scrape or
backfill prose from older messages. Before enabling the feature on an existing
beta data set, run `bun run --cwd packages/cloud backfill:conversation-resources`
to recover schema-valid refs from stored capability arguments/results and
Project references. Upserts make an
interrupted rollout safe to retry; the command is still a one-time rollout
step, not a recurring maintenance job.

Assistant also publishes the closed-world `chat.message` Action. It shows the
exact target chat and text for fresh approval, derives the source chat and turn
from AI Core's trusted capability-call record, then durably queues one
idempotent message for another active chat owned by the same user. The target
history renders this as an attributable Assistant-chat message, not as ordinary
user-authored text. A message-triggered turn cannot forward another inter-chat
message, preventing autonomous loops. Busy targets retain the pending message
and retry delivery after a turn finishes or the Assistant service starts.

Assistant scheduled tasks are owned by a user and attached to one private
chat, never directly to a Project. A task stores an exact future prompt plus
either one local wall-clock time or a five-field cron expression. Both are
interpreted with the current `app.timezone` when the task is created; the
effective IANA timezone is stored with the schedule. One-time input uses
`YYYY-MM-DDTHH:mm` and rejects nonexistent or ambiguous local times instead of
guessing.

The Assistant API adds `/tasks`, `/tasks/status`, plus `/tasks/:taskId` update, delete, pause,
resume, and run routes. The capability surface exposes `tasks.list` and the
canonical `task.read` resource reader, together with reviewed `task.create`,
`task.update`, `task.pause`, `task.resume`, `task.run`, and `task.delete`
Actions. Agent-created changes use normal capability review. Creation and
manual runs additionally require durable idempotency keys; replacement,
state-change, and deletion Actions are explicitly non-retryable after an
ambiguous transport failure.

PostgreSQL is the source of truth for tasks and occurrence history. A Sync
scheduler registers recurring tasks and runs one minutely recovery pass to
reconcile those registrations and recover due one-time work or queued
occurrences. Each schedule slot has an
idempotency key, and a task can have at most one queued or running occurrence.
The recovery pass also finalizes occurrences whose AI turn became terminal
while the Assistant listener was unavailable, and submits at most one queued
occurrence per currently idle chat so busy chats cannot starve unrelated work.
At delivery, the runtime locks the chat, refuses overlap with an active turn,
loads current Project access and context if the chat belongs to a Project, and
queues an ordinary durable chat turn. Transient failures retry; terminal
failures move the task to `needs_attention` and create a user notification.
Recurring tasks can then be resumed; a failed one-time task must be updated
with a new future schedule because its original slot remains immutable history.
Deleting the chat cascades to all of its tasks and occurrences.

`allowConversationManagement` enables metadata editing, pinning, archiving,
and restore for direct chats.

## Start the runtime

Chat routes enqueue work. A running service must also start the worker:

```ts
let stopAiRuntime: (() => void) | undefined;

await app.start({
  fetch: router.fetch,
  lifecycle: {
    setup: migrateCloudAi,
    start: async () => {
      stopAiRuntime = startAiRuntime({ concurrency: 4 });
      await aiMaintenanceJobs.start();
    },
    stop: async () => {
      stopAiRuntime?.();
      await aiMaintenanceJobs.stop();
    },
  },
});
```

`startAiRuntime()` is process-wide and reference-counted. The returned function
releases one caller. The last release stops the workers.

The runtime leases queued turns, recovers interrupted work, and sweeps stale
turns. User approvals and frontend-tool responses are durable continuation
points, not failed execution attempts. If their queue message is lost, the
sweep re-enqueues the exact action still waiting in the persisted turn
snapshot. Actual repeated worker failures remain bounded and finish the turn
as failed instead of leaving it active forever. Set concurrency for the
deployment, not per request.

## Stream state

The stream uses versioned Server-Sent Events. Clients receive a full state
event and then ordered updates for messages, text, tools, approvals, and turn
completion.

Use `parseAiSse()` for a low-level client. Solid applications should use
`createAiChatController()` from `@valentinkolb/cloud/ai/solid`.

The controller reconnects the stream and folds events into one projection. It
also exposes conversation history, send, steer, abort, retry, fork, compaction,
approval, file, and frontend-tool actions.

Action responses are idempotent. Retrying the same response is safe and
re-enqueues its continuation; a conflicting response for an already resolved
call is rejected. On reconnect, the state snapshot reconciles durable action
responses before rendering, so resolved approval controls do not reappear and
plain browser tools are not executed again merely because the page reloaded.

Do not maintain a second client-side chat state machine.

## Treat turns as asynchronous

Starting a turn does not mean it completed. The API returns the persisted turn,
then the stream reports progress.

Use the final turn status for completion. Handle `failed` and `aborted`
explicitly.

For the UI layer, see [Chat interface](/en/docs/ai/chat-interface).
