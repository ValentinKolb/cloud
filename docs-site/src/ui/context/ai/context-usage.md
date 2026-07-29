# Context usage

`ChatContextUsage` discloses request tokens and context-window pressure in a compact control that can sit beside a composer.

## Use Context usage

Show it when a model reports token usage or when users need to understand why a long conversation may be compacted. Omit it when the provider exposes no meaningful usage data.

The component is informational. Context limits, billing, compaction, and model selection remain application behavior.

## Import

```tsx
import { ChatContextUsage } from "@k2b/ui";
```

## Values

Pass the latest request through `usage`, an optional multi-step total through `loopUsage`, and the configured model limit through `contextWindow`.

The component derives the percentage and remaining tokens. It warns at high usage without claiming that the request failed.

## Accessibility

The trigger has a complete accessible label with used tokens and percentage. The tooltip repeats the values as text and uses a labeled progress bar, so the state does not depend on color.

## Runtime

The compact trigger renders on the server. Opening and positioning the tooltip requires hydration.

Token counts are display data. The package does not query a provider or infer a model limit.

## Example

```tsx
<ChatContextUsage
  modelLabel="Deep"
  usage={{ input: 18_420, output: 2_140, total: 20_560 }}
  loopUsage={{ total: 31_800 }}
  contextWindow={128_000}
/>
```
