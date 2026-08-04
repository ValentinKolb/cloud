# Dropdown and ContextMenu

`Dropdown` opens actions from a visible trigger. `ContextMenu` opens the same item model at the pointer position on right-click or beside its trigger from the keyboard. The parent supplies actions, links, and state changes.

## Use menus

Use `Dropdown` for secondary actions that need an explicit, keyboard-accessible trigger.

Use `ContextMenu` as a pointer shortcut on a record or canvas. Do not make it the only way to reach an action.

Do not use either menu as a select input. Choose the control from the state the
user is editing:

| Task | Component |
| --- | --- |
| Run an action or open a link | `Dropdown` |
| Choose one form value | `Select` |
| Choose one compact toolbar value | `SelectChip` |
| Choose several values | `MultiSelectInput` |
| Filter an existing result set | `FilterChip` |

See [Select inputs](../input/select) for the controlled selection contracts.

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
- custom static or composite content through `element`, optionally as a function receiving `close`;
- a section with optional `sectionLabel` and nested actions or elements.

Set `variant: "danger"` only on destructive items.

Prefer the declarative action and link items. `element` is an escape hatch for
content such as an embedded form or a richer static block; it is not a shortcut
for rebuilding menu rows. Interactive descendants must provide their complete
role, focus, keyboard, and close behavior. In particular, do not place a
general `Button` in `element` to imitate a selection row.

`Dropdown` also accepts `open`, `onOpenChange`, `position`, `align`, `width`, `triggerClass`, `class`, `label`, `disabled`, `openOnHover`, and `onClose`. Its trigger should be a real button or link.

`width` is a **CSS length string**, not a class name. It sets the menu's `--k2b-dropdown-width` and defaults to `12rem`:

```tsx
<Dropdown width="18rem" position="bottom-left" trigger={trigger} elements={actions} />
```

`ContextMenu` wraps `children` and adds `elements`, `disabled`, `onOpen`, `onClose`, an optional stable `id`, and an accessible `label`. The additive `items` form maps compact `{ id, label, onSelect }` records to the shared dropdown model.

## Accessibility

`Dropdown` adds menu state to its focusable trigger. Enter, Space, and arrow keys open it. Arrow keys, Home, End, Escape, and Tab manage the open menu.

Declarative actions close the visible menu before their callback runs. A state
update in the callback therefore cannot briefly repaint stale menu content.
Interactive menus close synchronously; `@k2b/ui` does not inherit a host's
generic `[popover]` exit transition. Animate decorative surfaces such as
tooltips separately instead of delaying an action menu's dismissal.

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
