# Dropdown and ContextMenu

`Dropdown` opens actions from a visible trigger. `ContextMenu` opens the same item model at the pointer position on right-click. The parent supplies actions, links, and state changes.

## Use menus

Use `Dropdown` for secondary actions that need an explicit, keyboard-accessible trigger.

Use `ContextMenu` as a pointer shortcut on a record or canvas. Do not make it the only way to reach an action.

## Import

```tsx
import {
  ContextMenu,
  Dropdown,
  type DropdownItem,
} from "@valentinkolb/cloud/ui";
```

## Items and sections

Both components accept `DropdownItem[]`. An item is one of:

- an action with `label`, optional `icon`, and `action`;
- a link with `label`, `href`, and optional `external`;
- an arbitrary `element`, optionally as a function receiving `close`;
- a section with optional `sectionLabel` and nested actions or elements.

Set `variant: "danger"` only on destructive items.

`Dropdown` also accepts `position`, `width`, `triggerClass`, `openOnHover`, and `onClose`. Its trigger should be a real button or link.

`ContextMenu` wraps `children` and adds `elements`, `disabled`, `onOpen`, `onClose`, and an optional stable `id`.

## Accessibility

`Dropdown` adds menu state to its focusable trigger. Enter, Space, and arrow keys open it. Arrow keys, Home, End, Escape, and Tab manage the open menu.

`ContextMenu` opens from the pointer context-menu event. Pair it with a visible `Dropdown` or another keyboard path for the same actions.

Labels must describe the action without relying on their icons. External links open in a new tab with the appropriate relationship attributes.

## Runtime

Both menus require hydrated browser code. `Dropdown` uses the native Popover API and CSS anchor positioning. `ContextMenu` renders its menu through a Solid portal.

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
    <button type="button" class="icon-btn" aria-label="Actions">
      <i class="ti ti-dots" aria-hidden="true" />
    </button>
  }
  elements={actions}
/>;
```
