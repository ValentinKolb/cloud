# Chat

The chat family provides controlled, reusable presentation for AI assistants and other conversational workflows. It has no knowledge of Cloud sessions, providers, tools, persistence, or uploads.

## Use Chat

Compose `ChatTimeline` and `ChatComposer` when the application needs a full conversation surface. Use `ChatMessage` and `ChatActivity` directly for a custom timeline.

Keep messages, the draft, attachments, model selection, and running state in the application. The components own keyboard behavior, scrolling, disclosure, focus, and accessible status presentation.

Tool calls use `ChatActivity`. Its label, description, icon, tone, trailing state, and disclosure body are generic JSX, so an application can render running, successful, failed, approval, or result states without exposing its tool protocol to the package.

## Import

```tsx
import {
  ChatComposer,
  ChatTimeline,
  type ChatTimelineItem,
} from "@k2b/ui";
```

## Controlled behavior

`ChatComposer` calls `onSend` with trimmed text and attachments. Return `false` or throw to restore the previous draft and attachments. A synchronous throw, a rejected promise, and a `false` result are treated the same way, and the failure is passed to `onError` for user-facing reporting. While a run is active, `onSteer` can submit guidance and `onStop` can stop the run.

`ChatTimeline` follows new messages while the reader stays near the bottom. Set `hasMore` and `onLoadOlder` to load history: the timeline requests older items when the reader approaches the top and preserves the reader's scroll position once they are prepended. Return `false` from `onLoadOlder` when nothing was prepended.

## Accessibility

Pass a useful conversation `label` when more than one chat is visible. Messages expose role, time, running state, and failures as text; color and icons are supplementary.

File selection and model controls retain visible or accessible labels. Command actions must have concise names and descriptions.

The timeline viewport is focusable so the conversation can be scrolled from the keyboard, and history loading also has an explicit `Load older messages` control instead of relying on scroll position alone.

## Runtime

Initial messages render on the server. Composer editing, command selection, scrolling, uploads, model changes, and send actions require hydration.

The application owns storage, network requests, tool rendering, approvals, and error reporting. Raw files are handed to `fileSelection.onSelect`; the package never uploads them.

The chat family uses the semantic `--k2b-ai-accent`, `--k2b-ai-accent-hover`, `--k2b-ai-border`, and `--k2b-ai-surface` variables. They can be overridden independently from the application's general accent stack.

## Example

```tsx
const [draft, setDraft] = createSignal("");

<ChatTimeline items={items()} conversationKey={conversationId()} />
<ChatComposer
  value={draft()}
  onValueChange={setDraft}
  onSend={({ text, attachments }) => sendMessage(text, attachments)}
  attachments={attachments()}
  onAttachmentsChange={setAttachments}
  models={models}
  selectedModelId={modelId()}
  onModelChange={setModelId}
/>;
```
