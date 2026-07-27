# Tooltip

`Tooltip` adds a concise, non-interactive hint to an existing control. It opens for pointer hover and keyboard focus and keeps the surface inside the viewport.

## Use Tooltip

Use it to explain an icon-only or unfamiliar control.

Keep essential instructions and validation messages visible in the page. Use a popover or dialog when the content contains links, buttons, or other interaction.

## Import

```tsx
import {
  Tooltip,
  type TooltipPlacement,
} from "@valentinkolb/cloud/ui";
```

## Properties

| Property | Type | Default | Purpose |
| --- | --- | --- | --- |
| `content` | `JSX.Element` | required | Supplies the non-interactive hint. |
| `children` | `JSX.Element` | required | Contains the control being described. |
| `placement` | `"top" \| "bottom"` | `"top"` | Requests the preferred vertical placement. |
| `delay` | `number` | `250` | Sets the open delay in milliseconds. |
| `disabled` | `boolean` | `false` | Prevents the tooltip from opening. |
| `class` | `string` | none | Adds classes to the inline wrapper. |

The tooltip searches its children for the first button, link, input, select, textarea, role button, or focusable element. If none exists, the wrapper becomes the target.

Placement is a preference. The surface flips vertically when the requested side does not fit and clamps horizontally to the viewport.

## Accessibility

The target receives `aria-describedby` after hydration. Keep the control's own accessible name; a tooltip description does not replace `aria-label`.

Tooltips open on focus as well as hover. Escape dismisses the current hint. Pointer down, pointer leave, focus out, scrolling, and resizing also close it.

Keep content short and non-interactive. Do not communicate required state through a tooltip alone.

## Runtime

The wrapper and tooltip surface render on the server. Hydration attaches `aria-describedby`, opens the Popover API surface, positions it, and handles dismissal.

## Example

```tsx
<Tooltip content="Application settings">
  <button type="button" class="icon-btn" aria-label="Settings">
    <i class="ti ti-settings" aria-hidden="true" />
  </button>
</Tooltip>
```
