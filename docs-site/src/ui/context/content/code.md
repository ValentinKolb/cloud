# Code and logs

`CodeDisplay` renders highlighted source text. `LogEntriesTable` renders the shared operational log columns. The caller owns the source text, log query, permission checks, and retention.

## Use code and logs

Use `CodeDisplay` for read-only snippets, generated configuration, and diagnostic payloads that benefit from syntax highlighting.

Use `LogEntriesTable` for compact log results with level, source, message, and timestamp. Logs are operational evidence, not durable business records.

## Import

```tsx
import {
  CodeDisplay,
  LogEntriesTable,
  type CodeDisplayLanguage,
  type LogTableEntry,
} from "@valentinkolb/cloud/ui";
```

## Code display

Pass source text through `code`. Supported language modes include TypeScript, TSX, JavaScript, JSX, shell scripts, Markdown, and plain text.

Line numbers are shown by default. Set `lineNumbers={false}` for short commands. The copy action is shown by default; set `copy={false}` when copying is not useful.

`title` labels the block, usually with a filename or command purpose.

## Log entries

Each `LogTableEntry` contains:

```ts
type LogTableEntry = {
  id: number | string;
  level: string;
  source: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};
```

The shared table recognizes `debug`, `info`, `warn`, and `error` levels. It displays level, source, message, and formatted time. Keep metadata in the record for a separate detail surface when readers need it.

Query, filter, and page logs on the server before passing `entries`. Use `emptyMessage` to distinguish an empty filter result from an empty log stream.

## Accessibility

Code remains selectable text. Titles and copy controls have text labels. Do not use highlighting as the only explanation of an important token.

Log levels combine an icon, color, and visible label. Messages should identify the event without depending on metadata that the table does not display.

## Runtime

Highlighting and log rows render on the server. The copy action needs hydration and the Clipboard API.

`LogEntriesTable` does not fetch or subscribe to logs. Refresh or realtime behavior belongs to the owning page.

## Example

```tsx
<CodeDisplay
  title="health.ts"
  language="ts"
  code={`export const health = () => ({ ok: true });`}
/>

<LogEntriesTable
  entries={[
    {
      id: "event-42",
      level: "warn",
      source: "mail.queue",
      message: "Delivery retry scheduled",
      metadata: { attempt: 2 },
      createdAt: "2026-07-27T10:15:00Z",
    },
  ]}
  emptyMessage="No matching log entries."
/>
```
