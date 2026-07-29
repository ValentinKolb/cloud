# Code

`CodeDisplay` renders highlighted, selectable source with optional title, line numbers, and copy action. The application owns the source text and its trust boundary.

## Use code

Use it for read-only snippets, generated configuration, and diagnostic payloads. Use `StructuredDataPreview` for data whose structure matters more than its serialized form.

## Import

```tsx
import {
  CodeDisplay,
  type CodeDisplayLanguage,
  type CodeDisplayProps,
} from "@k2b/ui";
```

`CodeDisplayLanguage` supports TypeScript, JavaScript, script, Markdown, and plain text modes. Line numbers and copy are enabled by default and can be disabled independently.

## Accessibility

Source remains selectable text. Titles and copy controls have text labels. Highlighting must not be the only explanation of an important token.

## Runtime

Highlighting renders on the server. Copy requires hydration and the Clipboard API.

## Example

```tsx
<CodeDisplay
  title="health.ts"
  language="ts"
  code={`export const health = () => ({ ok: true });`}
/>
```
