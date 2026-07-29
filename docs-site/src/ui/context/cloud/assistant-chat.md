# Cloud assistant chat

Cloud's `AiComposer`, `AiMessageList`, and `AiContextIndicator` adapt the portable chat presentation to Cloud AI sessions, turns, tools, attachments, retries, forks, and usage snapshots.

## Use Cloud assistant chat

Use these adapters inside Cloud applications that speak the platform AI protocol. For a standalone Solid application or a different backend, use `ChatComposer`, `ChatTimeline`, and `ChatContextUsage` from `@k2b/ui`.

## Import

```tsx
import {
  AiComposer,
  AiContextIndicator,
  AiMessageList,
} from "@valentinkolb/cloud/ai/ui";
```

## Cloud ownership

The components understand Cloud message records, active turns, tool blocks, stored attachments, model profiles, retries, forks, and steering. Those contracts intentionally remain outside `@k2b/ui`.

Applications still own the current session and pass the callbacks that perform mutations.

`AiMessageList` receives one `session` object. Its required accessors are
`messages` and `activeTurn`; conversation identity, loading, older-history
loading, and timeline navigation are optional.

`AiComposer` receives three objects:

- `models` supplies model profiles, the selected id accessor, and selection;
- `state` supplies disabled and running accessors plus optional draft,
  attachments, usage, and file-browser state;
- `actions` supplies `send(input)`, `steer(message)`, and `stop()`, plus
  optional slash commands and new-conversation behavior.

`AiContextIndicator` is the self-contained usage view. Pass the latest request
usage, optional loop usage, context-window size, and model label directly.

## Accessibility

Keep session and model labels meaningful. Tool actions, retry controls, attachments, and stop controls already expose button semantics; custom renderers must preserve accessible names and visible status text.

## Runtime

These components require a hydrated Cloud application. `AiMessageList` and
`AiComposer` can render bounded fixtures, but real messages, turns,
attachments, retries, and mutations require the platform AI routes. They are
not supported against an unrelated chat protocol.

## Example

```tsx
<AiMessageList
  session={{
    conversationId: () => sessionId(),
    messages,
    activeTurn,
    loading: () => loadingHistory(),
  }}
  actions={messageActions}
/>
<AiComposer
  models={{
    profiles: availableModels,
    selectedId: selectedModelId,
    onSelect: setSelectedModelId,
  }}
  state={{
    sessionKey: () => sessionId() ?? "new",
    disabled: () => !sessionId(),
    running: () => activeTurn()?.status === "running",
    stopping: () => stopping(),
    attachments,
    onAttachmentsChange: setAttachments,
    usage: latestUsage,
    loopUsage: latestLoopUsage,
    contextWindow: selectedContextWindow,
    contextModelLabel: selectedModelLabel,
  }}
  actions={{
    send: sendMessage,
    steer: steerMessage,
    stop: stopTurn,
  }}
/>
```
