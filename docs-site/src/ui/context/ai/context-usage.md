# Context usage

`Chat.ContextUsage` shows the latest request's context pressure as a compact percentage with a detailed tooltip.

## Use Context usage

Usually pass `contextUsage` to `Chat.Composer`. The composer omits the compact
indicator until both a context-window size and meaningful usage values are
available. Render `Chat.ContextUsage` directly only when an explicit
unavailable state is useful elsewhere.

The application owns limits, billing, compaction, and model selection.

## Import

```tsx
import { Chat } from "@k2b/ui";
```

## Values

Pass the latest request through `usage`, an optional multi-step total through
`loopUsage`, and the configured limit through `contextWindow`. The compact
trigger shows only the percentage; the tooltip exposes model, input, output,
loop total, window, and remaining tokens. Number output is SSR-stable by
default. Localized hosts can pass `formatNumber` explicitly.

## Accessibility

The trigger has a complete accessible label. The tooltip repeats values as text and uses a labeled progress bar, so the state does not depend on color.

## Runtime

The trigger renders on the server. Opening and positioning the tooltip requires hydration. The package never queries a provider or infers a model limit.

## Example

```tsx
<Chat.ContextUsage
  modelLabel="Deep"
  usage={{ input: 18_420, output: 2_140, total: 20_560 }}
  loopUsage={{ total: 31_800 }}
  contextWindow={128_000}
/>
```
