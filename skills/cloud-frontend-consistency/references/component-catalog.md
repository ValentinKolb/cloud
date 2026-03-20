# Component Catalog and Layout Recipes

## Canonical Imports

```ts
import {
  TextInput,
  NumberInput,
  Select,
  Switch,
  Checkbox,
  DateTimeInput,
  Dropdown,
  RemoveBtn,
  ProgressBar,
  PermissionEditor,
  Pagination,
  EntitySearch,
  CopyButton,
  Lightbox,
} from "@valentinkolb/cloud/lib/ui";

import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import { dnd } from "@valentinkolb/cloud/lib/browser";
```

## Layout Recipe: Sidebar + List + Detail

Use for content-heavy app screens.

```tsx
<div class="app-cols h-full">
  <aside class="sidebar-container">
    <div class="paper flex h-full min-h-0 flex-col gap-4 p-4">
      <div class="flex items-center gap-3">{/* icon + title + optional settings */}</div>
      <div class="flex flex-col gap-3">{/* actions / top groups */}</div>
      <div class="sidebar-body">{/* nav / tree / settings blocks */}</div>
      <div class="sidebar-footer">{/* bottom actions */}</div>
    </div>
  </aside>
  <section class="order-3 lg:order-2 min-w-0 flex-1">{/* search + list */}</section>
  <section class="order-2 lg:order-3 min-w-0 shrink-0 lg:w-80 xl:w-72">{/* detail panel */}</section>
</div>
```

Notes:
- Let the sidebar surface own the padding; do not add a second outer shell inside the same column.
- Let the detail panel host fill its column edge-to-edge; keep extra padding inside the panel content only where needed.

## Layout Recipe: Search + List Header

```tsx
<section class="min-w-0 space-y-3">
  <SearchBar
    placeholder="Search..."
    action="/app/example"
    value={query}
    param="q"
  />
  <div class="flex items-center justify-between">
    <h2 class="text-sm font-medium">Items</h2>
    <button class="btn-primary btn-sm">Create</button>
  </div>
  {/* list */}
</section>
```

## Layout Recipe: Settings

```tsx
<div class="space-y-8">
  <header class="flex items-center gap-3">
    <a class="p-1.5 text-dimmed hover:text-primary"><i class="ti ti-arrow-left" /></a>
    <h2 class="text-lg font-semibold">Settings</h2>
  </header>

  <section class="flex flex-col gap-4">
    <h3 class="section-label">General</h3>
    {/* fields */}
  </section>

  <hr class="border-zinc-200 dark:border-zinc-700" />

  <section class="flex flex-col gap-4">
    <h3 class="section-label">Permissions</h3>
    {/* PermissionEditor */}
  </section>
</div>
```

## Button/Action Language

- Primary actions: clear and stable position.
- Secondary utilities: subtle/icon-first when contextual.
- Destructive actions: explicit danger styling + confirm dialog.
- Disabled actions: use native `disabled` and shared utility styles; do not use wrapper-level opacity as a substitute.

## Pattern Sources

- Files toolbar/actions/detail
- Notebooks settings/sidebar/version history
- Spaces detail/edit panels

## Interaction Recipe: Sortable Lists / Kanban

- Use `dnd.create` to register `draggable` + `droppable` elements.
- Keep droppable IDs/meta domain-specific (`drop:item:<column>:<itemId>`, `drop:end:<column>`).
- Build preview/insert intent in `buildIntent` and keep rendering logic declarative.
- Prefer one backend mutation per drop (`columnId`, `rank`, optional `completed`), then reconcile from server response.

## Interaction Recipe: Desktop-Like File/List Managers

- Keep the filter/action row flush with the content surface; do not add extra horizontal wrapper padding around it.
- When a view offers both grid and list/table representations, keep the same single-click, double-click, selection, and context-menu semantics in both.
- Prefer one shared action menu definition for row/tile dropdowns and right-click menus.
- Use `dnd.create` for move interactions instead of browser-native HTML drag previews.
- If marquee selection is needed, start it from empty surface space; do not hijack clicks on interactive rows, inputs, or action buttons.
- Use a real surface for the left sidebar, but keep the detail panel visually lighter than the sidebar if it already contains its own inner facts/actions surfaces.
- For parent-folder entries like `..`, keep the same tile/row geometry as normal folders; only the icon/color should differ.
