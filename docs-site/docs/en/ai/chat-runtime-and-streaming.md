---
title: Chat runtime and streaming
navTitle: Chat and streaming
section: AI
order: 1030
description: Run bounded chat sessions and stream model output to an application.
tags: [ai, chat, streaming]
updated: 2026-08-02
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

`toolSource: { kind: "default", capabilities: true }` additionally enables the
compact Cloud app capability discovery tools. It is an explicit opt-in: other
chat and resource consumers keep their existing tool surface. Capability tools
require a model profile with `tools` support and a current direct user actor;
service-backed agent identities are not part of this contract.

The shared platform prompt separates platform rules, a short execution loop,
conditional tool guidance, and labeled application context. It tells agents to
use required tools, inspect their results, and continue until the request is
complete or genuinely blocked. Retrieved emails, webpages, user files, Help,
capability results, ordinary tool output, and memories remain data rather than
instructions. A skill explicitly selected by the user is copied into the
durable turn configuration and added as labeled, subordinate instructions for
that turn only. The runtime still treats a provider `stop` as
a completed turn; it does not infer unfinished work from model text or trigger
language-dependent automatic retries.

## Chat route groups

| Group | Purpose |
| --- | --- |
| `/status`, `/models` | Read sanitized runtime and model state |
| `/prefs` | Read or update user instructions and memory |
| `/conversations` | List and create conversations |
| `/conversations/:id` | Read or manage one conversation |
| `/conversations/:id/turns` | Start, steer, or stop work |
| `/conversations/:id/stream` | Receive Server-Sent Events |
| `/conversations/:id/files` | Manage conversation files |

The router also supports message retry, forks, compaction, pending tool
actions, conversation enrichment, and paged history.

The Assistant app publishes closed-world `chat.search` and `chat.read`
capabilities so an agent can find and read the current user's previous
Assistant chats. Both queries recheck the current user at execution time,
return only visible user and assistant text, omit tool results and model
thinking, and include a same-origin link back to the chat. They do not expose
another user's chats or introduce a service-agent identity.

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
turns. Set concurrency for the deployment, not per request.

## Stream state

The stream uses versioned Server-Sent Events. Clients receive a full state
event and then ordered updates for messages, text, tools, approvals, and turn
completion.

Use `parseAiSse()` for a low-level client. Solid applications should use
`createAiChatController()` from `@valentinkolb/cloud/ai/solid`.

The controller reconnects the stream and folds events into one projection. It
also exposes conversation history, send, steer, abort, retry, fork, compaction,
approval, file, and frontend-tool actions.

Do not maintain a second client-side chat state machine.

## Treat turns as asynchronous

Starting a turn does not mean it completed. The API returns the persisted turn,
then the stream reports progress.

Use the final turn status for completion. Handle `failed` and `aborted`
explicitly.

For the UI layer, see [Chat interface](/en/docs/ai/chat-interface).
