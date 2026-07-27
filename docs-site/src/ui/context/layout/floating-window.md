# FloatingWindow

`FloatingWindow` is a movable, resizable, non-modal utility surface. It stays visible while the user continues working in the application.

## Use FloatingWindow

Use it for long-lived reference work such as Help, an assistant, or a preview that belongs beside the main task.

Use a dialog when the user must finish or dismiss the task before continuing. Use an `AppWorkspace.Detail` when the content belongs to the current selection.

## Import

```tsx
import {
  openFloatingWindow,
  type FloatingWindowClose,
} from "@valentinkolb/cloud/ui";
```

## Open and close

`openFloatingWindow(view, options)` mounts the window in a portal and returns an idempotent close function.

The `view` also receives that close function. Use it for actions inside the window.

Options include `title`, `icon`, `accent`, initial width and height, minimum width and height, and an optional class.

The helper restores focus to the previously focused element when the window closes.

## Window behavior

Desktop windows can be moved and resized. Geometry is clamped to the viewport. Clicking a window brings it in front of other floating windows.

Below 640 pixels, the window becomes an inset mobile surface and disables movement and resizing.

The component does not persist its position. Add product-owned persistence only when restoring utility geometry is a real requirement.

## Accessibility

The window uses `role="dialog"` with `aria-modal="false"`. The title names it.

The title control supports arrow-key movement. The lower-right resize control supports arrow-key resizing. Holding Shift uses larger steps.

Escape closes only the top floating window.

## Runtime

Floating windows are browser-only. `openFloatingWindow` throws when `document` is unavailable.

Open them from an island or another hydrated client component. Do not call the helper during SSR.

## Example

```tsx
const close = openFloatingWindow(
  (closeWindow: FloatingWindowClose) => (
    <HelpReader articleId={articleId} onClose={closeWindow} />
  ),
  {
    title: "Help",
    icon: "ti ti-help",
    accent: app.appearance.accent,
    initialWidth: 520,
    initialHeight: 640,
  },
);
```
