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

Cloud provides the Solid controller and components for chat surfaces.

Use them together. The controller owns transport and state. The components own
presentation.

## Create the controller

```tsx
import type { AiPublicModelProfile } from "@valentinkolb/cloud/ai";
import { createAiChatController } from "@valentinkolb/cloud/ai/solid";
import { AiComposer, AiMessageList } from "@valentinkolb/cloud/ai/ui";

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

  return (
    <>
      <AiMessageList
        session={{
          messages: chat.messages,
          activeTurn: chat.activeTurn,
          loading: chat.loadingConversation,
        }}
      />
      <AiComposer
        models={{
          profiles: () => props.models,
          selectedId: props.selectedModelId,
          onSelect: props.selectModel,
        }}
        state={{
          disabled: () => false,
          running: chat.running,
          canStop: () => Boolean(chat.activeTurn()),
          stopping: () => chat.runStatus() === "stopping",
        }}
        actions={{
          send: chat.send,
          steer: chat.steer,
          stop: chat.abort,
        }}
      />
    </>
  );
}
```

The exact component props depend on the chosen composition. Use the exported
types from `@valentinkolb/cloud/ai/ui`.

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

Pass handlers through `frontendTools`.

The controller claims each call once, runs the handler, and sends the result
back to the turn. Show interaction tools only when the relevant application
view is present.

Server tools remain the default for domain access.

See [Observability](/docs/en/operations/observability#operate-ai-workloads) for
runtime monitoring and production checks.
