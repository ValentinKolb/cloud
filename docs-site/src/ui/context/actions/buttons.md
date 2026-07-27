# Button utilities

Cloud button classes provide consistent action hierarchy, sizing, focus, disabled, and pressed states. The button element and its behavior remain application code.

## Use button utilities

Use one semantic variant and its matching size:

- `btn-primary` for the main forward or write action;
- `btn-secondary` for supporting actions;
- `btn-simple` for quiet toolbar or progressive actions;
- `btn-danger` for destructive actions;
- `btn-success` or `btn-success-subtle` only when success is the action's meaning;
- `btn-ai` only for controls that open, run, or configure AI.

## Import

Load the Cloud stylesheet once from the application entry:

```ts
import "@valentinkolb/cloud/styles/global.css";
```

The classes are CSS utilities, not JavaScript exports.

## Supported classes

| Family | Classes | Purpose |
| --- | --- | --- |
| Action size | `btn-sm`, `btn-md` | Size an action button. |
| Action tone | `btn-primary`, `btn-secondary`, `btn-simple`, `btn-danger`, `btn-success`, `btn-success-subtle`, `btn-ai` | Set action hierarchy or semantics. |
| Input size | `btn-input-sm`, `btn-input-md` | Size an input-shaped button. |
| Input control | `btn-input`, `btn-input-recessed` | Raised inline action or recessed picker trigger. |
| Input state | `btn-input-active`, `btn-input-primary`, `btn-input-success`, `btn-input-ai` | Active or semantic input-shaped controls. |
| Segment | `btn-segment`, `btn-segment-icon` | Compact toolbar segments. |
| Icon | `icon-btn`, `icon-btn-ai` | Fixed-size icon-only actions. |

`btn-base` and `focus-ui` are foundations used by the shared stylesheet. Application buttons should use the semantic classes above.

Set `aria-pressed="true"` on a toggled `icon-btn` or `icon-btn-ai`.

## Composition

Put search or flexible content before the action group. Keep the secondary action next to the primary action and allow the group to wrap below on narrow screens.

Icons supplement action text. Use icon-only buttons only when the icon is familiar and space is constrained.

## Accessibility

Use a real `<button type="button">` or an anchor for navigation. Icon-only buttons need `aria-label`; a tooltip may explain the icon but does not replace the accessible name.

Keep `disabled` on the native button while work cannot run.

## Runtime

The utilities render correctly in server HTML. Hydration is required only for the application event handler or toggled state.

## Example

```tsx
<div class="flex items-center gap-2">
  <button type="button" class="btn-secondary btn-sm">
    Cancel
  </button>
  <button type="submit" class="btn-primary btn-sm">
    Save
  </button>
  <button
    type="button"
    class="icon-btn"
    aria-label="More actions"
  >
    <i class="ti ti-dots" aria-hidden="true" />
  </button>
</div>
```
