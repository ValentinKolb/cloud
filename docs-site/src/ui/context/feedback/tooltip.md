# Tooltip

`Tooltip` adds a concise, non-interactive hint to an existing control. It opens for pointer hover and keyboard focus and keeps the surface inside the viewport.

## Use Tooltip

Use it to explain an icon-only or unfamiliar control.

Keep essential instructions and validation messages visible in the page. Use a popover or dialog when the content contains links, buttons, or other interaction.

## Import

```tsx
import {
  IconButton,
  Tooltip,
  type TooltipPlacement,
} from "@k2b/ui";
```

## Properties

| Property | Type | Default | Purpose |
| --- | --- | --- | --- |
| `content` | `JSX.Element` | required | Supplies the non-interactive hint. |
| `children` | `JSX.Element` | none | Contains the control being described. Typed optional through `ParentProps`, but a tooltip without a trigger has nothing to describe. |
| `placement` | `"top" \| "bottom"` | `"top"` | Requests the preferred vertical placement. |
| `delay` | `number` | `250` | Sets the open delay in milliseconds. |
| `disabled` | `boolean` | `false` | Prevents the tooltip from opening and closes an open tooltip when changed to `true`. |
| `class` | `string` | none | Adds classes to the inline wrapper. |

The tooltip searches its children for the first button, link, input, select, textarea, role button, or focusable element. If none exists, the wrapper becomes the target. Both pointer hover and keyboard focus use the same open delay and surface.

Placement is a preference. The surface flips vertically when the requested side does not fit and clamps horizontally to the viewport. Positioning measures twice: it first fixes the available horizontal position, then remeasures wrapped content before calculating the final top and left coordinates.

## Accessibility

The target receives `aria-describedby` after hydration. Keep the control's own accessible name; a tooltip description does not replace `aria-label`.

Tooltips open on focus as well as hover. Escape dismisses the current hint. Pointer down, pointer leave, focus out, scrolling, and resizing also close it.

Keep content short and non-interactive. Do not communicate required state through a tooltip alone.

## Runtime

The wrapper and tooltip surface render on the server. Hydration attaches `aria-describedby`, opens the Popover API surface, positions it, and handles dismissal.

Long content wraps to the surface maximum width. Keep it concise even though the second measurement prevents wrapping from producing stale vertical placement.

## Example

```tsx
<Tooltip content="Application settings">
  <IconButton label="Settings">
    <i class="ti ti-settings" aria-hidden="true" />
  </IconButton>
</Tooltip>

<Tooltip
  placement="bottom"
  content="This longer explanation wraps and remains inside the viewport."
>
  <button type="button">Focus or hover</button>
</Tooltip>
```
