# Panes

`Panes` arranges peer tools as tabs and resizable nested splits. The application owns the serializable layout and the runtime item definitions.

## Use Panes

Use it for code editors, query explorers, dashboard editors, and other workspaces where users open, close, move, or split peer tools.

Use `Tabs` for one fixed tab group. Use `AppWorkspace.MainPane` for a fixed list-and-reader layout.

## Import

```tsx
import {
  activatePanesItem,
  addPanesItem,
  applyPanesIntent,
  createPanesLayout,
  isPanesItemVisible,
  PANES_LAYOUT_VERSION,
  parsePanesLayout,
  Panes,
  reconcilePanesLayout,
  removePanesItem,
  resizePanesSplit,
  type PanesItem,
  type PanesLayout,
  type PanesNode,
} from "@k2b/ui";
```

## Own the layout

Create the initial controlled value with `createPanesLayout(itemIds)`. It creates one tab group, or an empty workspace when the list is empty.

Pass the current `PanesLayout` to `layout` and replace it from `onLayoutChange`. A layout is a versioned binary tree:

- a `group` stores a non-empty ordered list of item ids and its active id;
- a `split` stores its direction, ratio, and two child nodes;
- `root: null` represents an empty workspace.

The tree contains no DOM ids or render functions and can be stored as JSON. Helpers emit `version: PANES_LAYOUT_VERSION`. `parsePanesLayout(value)` accepts only a valid current layout and returns `null` for malformed, unsupported, duplicate, or excessively deep input. Choose an explicit product fallback when persisted input is invalid.

Keep item ids stable. `reconcilePanesLayout(layout, desiredOpenIds)` removes other ids and appends missing desired ids to the first group. Use it when the complete desired set should also be open. For workspaces where available items and open items differ, use `addPanesItem` and `removePanesItem` instead.

The pure helpers support the same operations outside the component:

- `activatePanesItem` selects an item;
- `addPanesItem` opens an item in a target group;
- `removePanesItem` closes an item and collapses empty split branches;
- `applyPanesIntent` applies a tab move, reorder, or split;
- `resizePanesSplit` changes a split ratio;
- `isPanesItemVisible` reports whether an item is active in its group.

Each layout-mutating helper returns the original layout when the requested operation is invalid or has no effect.

## Define runtime items

Pass runtime-only `PanesItem` descriptors separately from the layout:

```ts
type PanesItem = {
  id: string;
  title: string;
  icon?: string;
  render: () => JSX.Element;
  onClose?: () => void;
};
```

`render` is lazy: Panes invokes it only for the active item in each group. Switching tabs unmounts the previous content. Reordering a group does not recreate its active content.

The presence of `onClose` enables the close control. Its callback only reports intent; the application updates its domain state and layout. The icon-only control overlays the trailing edge on hover or keyboard focus and has no separate background. It reserves no label space while hidden; while visible, a long label truncates with an ellipsis instead of overlapping the control. Pressing it does not start a drag.

Pass `onAddItem` to show a plus control in every group. It receives an item id from the target group, or `null` for an empty workspace. The application chooses or creates the item, then updates the layout with `addPanesItem`.

## Interaction

`movable`, `resizable`, and `split` configure the available operations. `split` accepts `false`, `"horizontal"`, `"vertical"`, or `"both"`; all interactions are enabled by default.

Tab groups stay on one line and scroll horizontally when their tabs no longer fit. A thin overlay scrollbar appears while the tab row is hovered or contains keyboard focus without changing the row height.

Once dragging starts, Panes shows every valid destination at the same time: exact tab insertion positions, add-to-group targets, and explicit Add left, right, top, and bottom targets. The four directional trapezoids are separated by neutral gaps around an icon-only add-to-group area, so each action reads as its own destination. Their visible shape is also their hit area. Duplicate and no-op destinations are not offered. Releasing elsewhere cancels the move.

Tab insertion targets use compact slots between tabs. The pointer preview follows the same pill shape, icon, label spacing, and truncation as the source tab.

While resizing, a separator snaps to a nearby separator of the same direction in a neighboring pane. This aligns adjacent pane heights or widths without adding alignment metadata to the persisted layout. Pointer and keyboard resizing use the same visible geometry.

## Accessibility

Give every item a concise title. Set `ariaLabel` when the surrounding context does not already identify the workspace clearly; it defaults to `"Pane workspace"`.

Clicking or tapping a tab activates it. Left and Right Arrow move through the tabs; Home and End select the first and last tab. `Delete` and `Backspace` request closing the focused tab when `onClose` is available.

Start a focused tab move with Space or Enter, select a visible target with the arrow keys, then confirm with Space or Enter; Escape cancels the move. Focus a separator and use the arrow keys for its orientation to resize the panes. Hold Shift for a larger step; Home and End move to the minimum and maximum supported ratio.

## Runtime

`Panes` is controlled interactive Solid code and must be hydrated. Its initial active contents can render on the server.

Persist only `PanesLayout`. Runtime descriptors contain functions and stay in application code; they never cross the serialization boundary. Use the same deterministic initial layout during SSR and hydration.

## Example

```tsx
const definitions = [
  { id: "result", title: "Result", icon: "ti ti-table", render: () => <ResultView /> },
  { id: "query", title: "Query", icon: "ti ti-code", render: () => <QueryEditor /> },
  { id: "schema", title: "Schema", icon: "ti ti-database", render: () => <SchemaBrowser /> },
] as const;

const [layout, setLayout] = createSignal<PanesLayout>(
  createPanesLayout(["result", "query"]),
);

const items: readonly PanesItem[] = definitions.map((item) => ({
  ...item,
  onClose: () => setLayout((current) => removePanesItem(current, item.id)),
}));

const openItem = (targetItemId: string | null) =>
  setLayout((current) =>
    addPanesItem(current, { itemId: "schema", targetItemId }),
  );

const schemaIsOpen = () => {
  const contains = (node: PanesNode | null): boolean =>
    node?.type === "group"
      ? node.items.includes("schema")
      : node?.type === "split" && (contains(node.first) || contains(node.second));
  return contains(layout().root);
};

<Panes
  layout={layout()}
  onLayoutChange={setLayout}
  items={items}
  onAddItem={schemaIsOpen() ? undefined : openItem}
  ariaLabel="Query workspace"
/>;
```
