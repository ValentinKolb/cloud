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
<div class="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)_34rem]">
  <aside class="space-y-2">{/* navigation/books */}</aside>
  <section class="min-w-0 space-y-4">{/* search + list */}</section>
  <section class="min-w-0">{/* detail panel */}</section>
</div>
```

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
