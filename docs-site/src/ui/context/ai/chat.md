# Chat

`Chat` is a controlled compound component for assistants and other conversational workflows. It has no knowledge of Cloud sessions, providers, tool protocols, persistence, or uploads.

## Use Chat

Compose `Chat.Timeline` and `Chat.Composer` inside `Chat`. The application owns messages, draft, attachments, model selection, run state, and mutations. The components own keyboard behavior, scrolling, focus, disclosures, structured actions, and accessible status presentation.

Timeline items are plain message or activity records. Message actions and attachments are structured arrays; activity bodies remain JSX so an application can render rich tool results without coupling the package to a protocol.

## Import

```tsx
import { Chat, type ChatTimelineItem } from "@k2b/ui";
```

## Controlled behavior

`Chat.Composer` calls `onSubmit` with an `intent`, trimmed text, and generic attachments. The intent is `send` while idle and `steer` while a response is running. Return `false` or throw to restore the consumed draft and attachments; failures are passed to `onError`.

Use `state="running"` to show Stop when the draft is empty. Once the user types, Send replaces Stop and submits a steer. `menuActions` populate the Plus menu; `contextActions` sit beside context usage. Model options can provide an icon or provider image.

Every structured chat action declares exactly one behavior: `onSelect` for an
application callback or `copyText` for clipboard content. The same contract is
used by message, menu, and context actions.

`Chat.Timeline` follows new messages while the reader remains near the bottom. Set `hasMore` and `onLoadOlder` to load history while preserving the visible scroll position.

Pass `timeLabel` for visible localized timestamps and `createdAt` for the
machine-readable `dateTime` value. `createdAt` alone intentionally renders no
runtime-locale text, which keeps SSR and hydration stable.

## Accessibility

Pass a useful conversation `label` when more than one chat is visible. Visual role labels are intentionally omitted, while screen readers still receive the message role. Time, status, menus, attachments, model selection, context usage, and history loading remain keyboard reachable and named.

User metadata appears on hover or keyboard focus and remains visible on devices without hover. Color and icons are supplementary.

## Runtime

Initial messages render on the server. Editing, commands, scrolling, file selection, menus, model changes, and submission require hydration.

Raw files are handed to `fileSelection.onSelect`. The package never uploads, persists, streams, authorizes, retries, or executes tools.

The family uses `--k2b-ai-accent`, `--k2b-ai-accent-hover`, `--k2b-ai-border`, and `--k2b-ai-surface`, which can be themed independently from the general accent stack.

## Example

```tsx
const [draft, setDraft] = createSignal("");

<Chat>
  <Chat.Timeline items={items()} conversationKey={conversationId()} />
  <Chat.Composer
    value={draft()}
    onValueChange={setDraft}
    onSubmit={submit}
    state={runState()}
    attachments={attachments()}
    onAttachmentsChange={setAttachments}
    menuActions={[{ id: "new", label: "New chat", onSelect: createChat }]}
    models={models}
    selectedModelId={modelId()}
    onModelChange={setModelId}
    contextUsage={{ usage: usage(), contextWindow: 128_000 }}
  />
</Chat>;
```
