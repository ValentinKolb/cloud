# Progress

`ProgressBar` presents determinate progress from 0 to 100.

## Use progress

Use the default tone for ordinary work, success for a positive completion state, and danger when the progress itself represents a limit or failing state.

## Import

```tsx
import { ProgressBar } from "@k2b/ui";
```

## Accessibility

Pass a task-specific `label`. Tone supplements the numeric value and must not carry meaning alone.

## Runtime

`ProgressBar` renders on the server and needs no hydration for its initial value.

## Example

```tsx
<ProgressBar value={72.4} label="Upload progress" tone="success" showValue />
```
