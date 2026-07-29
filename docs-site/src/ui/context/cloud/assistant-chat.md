# Cloud assistant chat

Cloud does not ship a second chat component set. It adapts Cloud AI sessions,
turns, tools, attachments, retries, forks, and usage snapshots to the portable
chat components in `@k2b/ui`.

## Use Cloud assistant chat

Use the Cloud adapters only inside applications that speak the platform AI
protocol. For a standalone Solid application or a different backend, use the
generic components directly.

## Import

```tsx
import {
  AiChatActionsProvider,
  AiChatProjection,
  aiChatAttachments,
  aiChatModelOptions,
  aiComposerSendInput,
} from "@valentinkolb/cloud/ai/ui";
import {
  ChatComposer,
  ChatContextUsage,
  ChatTimeline,
} from "@k2b/ui";
```

## Cloud ownership

The adapters understand Cloud message records, active turns, tool blocks,
stored attachments, model profiles, retries, forks, and steering. Those
contracts intentionally remain outside `@k2b/ui`.

Applications still own the current session and pass the callbacks that perform mutations.

- `AiChatProjection` reactively projects persisted messages and the active turn
  into `ChatTimelineItem[]` below the Cloud action provider.
- `AiChatActionsProvider` binds Cloud approval, frontend-tool, retry, fork, and
  file behavior to rich timeline blocks.
- `aiChatModelOptions` and `aiChatAttachments` map Cloud records into generic
  composer values; `aiComposerAttachmentRecords` restores the application
  records after generic controlled-state updates.
- `aiComposerSendInput` maps a generic composer submission back to the Cloud
  controller input.

## Accessibility

`ChatComposer`, `ChatTimeline`, and `ChatContextUsage` own the common keyboard,
focus, status, and accessible-name behavior. Cloud renderers must preserve
accessible names and visible status text for domain-specific tools.

## Runtime

The generic components can render bounded fixtures without Cloud. Real
messages, turns, attachments, retries, and mutations require the platform AI
routes and controller.

## Example

```tsx
<AiChatActionsProvider actions={messageActions}>
  <AiChatProjection
    messages={messages()}
    activeTurn={activeTurn()}
    render={(items) => (
      <ChatTimeline items={items()} loading={loadingHistory()} />
    )}
  />
</AiChatActionsProvider>

<ChatComposer
  value={draft()}
  onValueChange={setDraft}
  models={aiChatModelOptions(availableModels())}
  selectedModelId={selectedModelId()}
  onModelChange={setSelectedModelId}
  attachments={aiChatAttachments(attachments())}
  onSend={(input) => sendMessage(aiComposerSendInput(input))}
  context={
    <ChatContextUsage
      usage={latestUsage()}
      loopUsage={latestLoopUsage()}
      contextWindow={selectedContextWindow()}
      modelLabel={selectedModelLabel()}
    />
  }}
/>
```
