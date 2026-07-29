---
title: Chat interface
navTitle: Chat interface
section: AI
order: 1070
description: Present conversation state, tools, approvals, and failures with the shared chat controller and components.
tags: [ai, ui, solidjs]
updated: 2026-07-27
---

# Chat interface

Compose Cloud chat from two layers:

- `@k2b/ui` owns the generic timeline, message shell, composer, attachments,
  model selection, commands, context usage, loading, and accessibility.
- `@valentinkolb/cloud/ai` owns the controller, session protocol, persistence,
  tools, approvals, files, retry, fork, and steering policy.

Cloud adapters project protocol state and payloads across that boundary. There
is no second Cloud-specific chat component set.

## Compose a Cloud chat

```tsx
import type { AiPublicModelProfile } from "@valentinkolb/cloud/ai";
import { createAiChatController } from "@valentinkolb/cloud/ai/solid";
import {
  AiChatActionsProvider,
  AiChatProjection,
  aiChatModelOptions,
  aiComposerSendInput,
} from "@valentinkolb/cloud/ai/ui";
import {
  ChatComposer,
  ChatContextUsage,
  ChatTimeline,
} from "@k2b/ui";
import { createSignal } from "solid-js";

export function ItemChat(props: {
  itemId: string;
  models: AiPublicModelProfile[];
  selectedModelId: () => string;
  selectModel: (id: string) => void;
}) {
  const chat = createAiChatController({
    baseUrl: `/api/inventory/ai/items/${props.itemId}`,
    trackViewedState: true,
  });
  const [draft, setDraft] = createSignal("");

  return (
    <div class="k2b-ui">
      <AiChatActionsProvider
        actions={{
          onApproval: chat.respondToApproval,
          onFrontendToolResult: chat.submitFrontendToolResult,
          fileUrl: chat.fileContentUrl,
        }}
      >
        <AiChatProjection
          messages={chat.messages()}
          activeTurn={chat.activeTurn()}
          render={(items) => (
            <ChatTimeline
              items={items()}
              loading={chat.loadingConversation()}
              hasMore={chat.hasMoreHistory()}
              loadingOlder={chat.loadingOlder()}
              onLoadOlder={chat.loadOlderMessages}
            />
          )}
        />
      </AiChatActionsProvider>

      <ChatComposer
        value={draft()}
        onValueChange={setDraft}
        models={aiChatModelOptions(props.models)}
        selectedModelId={props.selectedModelId()}
        onModelChange={props.selectModel}
        running={chat.running()}
        stopping={chat.runStatus() === "stopping"}
        onSend={(input) =>
          chat.send({
            ...aiComposerSendInput(input),
            modelProfileId: props.selectedModelId(),
          })
        }
        onSteer={chat.steer}
        onStop={async () => {
          await chat.abort();
        }}
        context={<ChatContextUsage contextWindow={128_000} />}
      />
    </div>
  );
}
```

Keep the `k2b-ui` scope on the nearest stable application root and import
`@k2b/ui/styles.css` once in the application stylesheet.

The controller exposes:

- conversations and active conversation state;
- messages, active turn, and stream status;
- history and timeline loading;
- send, steer, abort, retry, fork, and compaction;
- approval and frontend-tool actions;
- file URLs and file counts;
- one error state for the active chat.

## Show meaningful states

Distinguish:

- connecting from generating;
- waiting for approval from running;
- stopping from stopped;
- failed from aborted;
- an empty conversation from a loading conversation.

Keep the Stop action available until the server accepts the abort.

Render tool input and output as data. Do not inject model text as HTML.

## Handle frontend tools

Pass approval, frontend-tool, retry, fork, and file handlers through
`AiChatActionsProvider`. Rich Cloud blocks remain Cloud-owned JSX inside the
generic timeline.

The controller claims each call once, runs the handler, and sends the result
back to the turn. Show interaction tools only when the relevant application
view is present.

Server tools remain the default for domain access.

See [Observability](/en/docs/operations/observability#operate-ai-workloads) for
runtime monitoring and production checks.
