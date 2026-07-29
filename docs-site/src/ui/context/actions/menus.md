# Dropdown and ContextMenu

`Dropdown` opens actions from a visible trigger. `ContextMenu` opens the same item model at the pointer position on right-click or beside its trigger from the keyboard. The parent supplies actions, links, and state changes.

## Use menus

Use `Dropdown` for secondary actions that need an explicit, keyboard-accessible trigger.

Use `ContextMenu` as a pointer shortcut on a record or canvas. Do not make it the only way to reach an action.

## Import

```tsx
import {
  ContextMenu,
  Dropdown,
  type DropdownItem,
  IconButton,
} from "@k2b/ui";
```

## Items and sections

Both components accept `DropdownItem[]`. An item is one of:

- an action with `label`, optional `icon`, and `action`;
- a link with `label`, `href`, and optional `external`;
- an arbitrary `element`, optionally as a function receiving `close`;
- a section with optional `sectionLabel` and nested actions or elements.

Set `variant: "danger"` only on destructive items.

`Dropdown` also accepts `open`, `onOpenChange`, `position`, `align`, `width`, `triggerClass`, `class`, `label`, `disabled`, `openOnHover`, and `onClose`. Its trigger should be a real button or link.

`width` is a **CSS length string**, not a class name. It sets the menu's `--k2b-dropdown-width` and defaults to `12rem`:

```tsx
<Dropdown width="18rem" position="bottom-left" trigger={trigger} elements={actions} />
```

`ContextMenu` wraps `children` and adds `elements`, `disabled`, `onOpen`, `onClose`, an optional stable `id`, and an accessible `label`. The additive `items` form maps compact `{ id, label, onSelect }` records to the shared dropdown model.

## Accessibility

`Dropdown` adds menu state to its focusable trigger. Enter, Space, and arrow keys open it. Arrow keys, Home, End, Escape, and Tab manage the open menu.

`ContextMenu` opens from the pointer context-menu event, the Context Menu key, or Shift+F10. Pair it with a visible `Dropdown` when the same actions must remain discoverable without knowing the shortcut.

Labels must describe the action without relying on their icons. External links open in a new tab with the appropriate relationship attributes.

## Runtime

Both menus require hydrated browser code. `Dropdown` uses the native Popover API, measures the trigger and menu, and clamps every supported position to an eight-pixel viewport inset. It repositions on viewport resize and ancestor scrolling.

`ContextMenu` renders its menu through a Solid portal, clamps pointer and keyboard openings to the viewport, and closes on outside pointer input, resize, or scrolling. Closing with Escape restores focus to the trigger.

## Example

```tsx
const actions: DropdownItem[] = [
  {
    label: "Edit",
    icon: "ti ti-pencil",
    action: openEditor,
  },
  {
    label: "Delete",
    icon: "ti ti-trash",
    variant: "danger",
    action: confirmDelete,
  },
];

<Dropdown
  trigger={
    <IconButton label="Actions">
      <i class="ti ti-dots" aria-hidden="true" />
    </IconButton>
  }
  elements={actions}
/>;
```
