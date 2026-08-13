---
title: Chat runtime and streaming
navTitle: Chat and streaming
section: AI
order: 1030
description: Run bounded chat sessions and stream model output to an application.
tags: [ai, chat, streaming]
updated: 2026-08-12
---

# Chat runtime and streaming

`createAiChatRoutes()` provides the shared conversation and turn API.

Use it for a standalone chat. Use
[`defineAiResource()`](/en/docs/ai/resources-and-access) when the chat belongs
to a domain resource.

The shared runtime is useful when conversation history, streaming, approvals,
files, interruption, and crash recovery are product requirements. It does not
own application context or authorization: the app resolves both for every
turn and tool call.

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
conversation-file tools (including configured image inspection), arithmetic and deterministic date calculation, and web search or
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

Search applies ownership, application, resource, archive, status, and pagination
filters before returning visible conversation text. Tool results and model
thinking are not user-visible message search results. Structured Cloud resource
discovery indexes only schema-valid refs observed in trusted structured values;
it does not infer resource identity from prose.

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
also exposes the active conversation's history, send, steer, abort, retry,
fork, compaction, approval, and frontend-tool actions.

Keep this SSE protocol scoped to the active turn. Conversation and Project
lists, metadata, Sources, files, scheduled tasks, Project context, and access
changes are durable server projections, not turn deltas. Server-render those
projections and refresh them through [Realtime UI](/en/docs/frontend/realtime-ui).

AI applications can mount the server-only live route from
`@valentinkolb/cloud/ai/live`. `migrateCloudAi()` installs the transactional
invalidation outbox and persistence triggers; `startAiRuntime()` dispatches the
outbox. A committed AI write and its invalidation therefore cannot diverge.
The browser still reloads each affected projection through its authorized HTTP
query before it advances the event cursor.

```ts
import { createAiLiveRoutes } from "@valentinkolb/cloud/ai/live";

const appId = "assistant";

router.route(
  "/api/assistant/live",
  createAiLiveRoutes({
    appId,
    resolveScopeVersion: (userId) => aiProjects.scopeVersion({ type: "user", userId }, appId),
  }),
);
```

The live stream is isolated by application and user. Every Project belongs to
one AI application. Its context can be shared with users of that application,
but each Project chat remains owned by its creator and only appears in that
user's stream and queries. On reconnect, the route establishes a new head
cursor and the client refreshes every registered AI projection. This is the
authoritative recovery path when retained replay is insufficient.

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
