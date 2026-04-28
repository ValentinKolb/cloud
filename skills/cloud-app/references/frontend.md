# Frontend Patterns — Detailed Reference

## SSR Architecture

The platform uses `@valentinkolb/ssr` — a minimal SolidJS islands framework for Bun.

### How It Works

1. **Pages** (`.tsx` in `frontend/`) run on the server — they fetch data and return JSX
2. **Islands** (`.island.tsx`) hydrate on the client with SolidJS reactivity
3. **Server components** (regular `.tsx` imported in pages) render once on the server and are never sent to the client

Data flows one way: page fetches data → passes as props to JSX → islands receive serialized props and hydrate independently.

### SSR Config

Every app needs `config.ts` with `defineApp()`:

```typescript
import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "my-app",
  name: "My App",
  icon: "ti ti-star",
  description: "Short description.",
  basePath: "/app/my-app",
  baseUrl: "http://app-my-app:3000",
  nav: { href: "/app/my-app", section: "primary", requiresAuth: true },
});

export const { ssr, plugin } = app;
```

The `ssr` export is the page handler wrapper used in `frontend/index.ts`. The `basePath` is defined directly in `defineApp()`.

### Page Pattern

Pages export a pre-wrapped `ssr<AuthContext>(...)` handler array. The `ssr` function from `config.ts` wraps the page into a Hono middleware array that you spread into route definitions.

```typescript
// frontend/page.tsx
import { ssr } from "../config";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.url);
  const id = c.req.param("id");  // for dynamic routes

  // Fetch data server-side (call services directly, no API needed)
  const data = await myService.items.list({ userId: user.id });

  // Return a render function (NOT JSX directly)
  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Items" }]}>
      {/* content */}
    </Layout>
  );
});
```

### Page Routing (frontend/index.ts)

Routes are NOT auto-generated from directory structure. Map them explicitly. Each page file exports a pre-wrapped `ssr<AuthContext>(...)` handler array — the route mapping simply spreads these:

```typescript
// frontend/index.ts
import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";

import mainPage from "./page";
import detailPage from "./[id]/page";

export const adminPages = new Hono<AuthContext>()
  .get("/", auth.requireRole("admin", auth.redirectToLogin), ...mainPage);

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...mainPage)
  .get("/:id", auth.requireRole("user", auth.redirectToLogin), ...detailPage);
```

### Dynamic Routes

Directory-based naming is just a convention for organization:

```
frontend/page.tsx           → mapped manually in frontend/index.ts as "/"
frontend/[id]/page.tsx      → mapped manually in frontend/index.ts as "/:id"
frontend/[id]/edit/page.tsx → mapped manually in frontend/index.ts as "/:id/edit"
```

Access params in page: `c.req.param("id")`

### Island Pattern

```typescript
// _components/MyIsland.island.tsx
import { createSignal, createMemo, For, Show } from "solid-js";

export default function MyIsland(props: { items: Item[]; userId: string }) {
  const [items, setItems] = createSignal(props.items);
  const count = createMemo(() => items().length);

  return (
    <div>
      <p>{count()} items</p>
      <For each={items()}>
        {(item) => <div>{item.title}</div>}
      </For>
    </div>
  );
}
```

**Rules:**
- File must end in `.island.tsx` — this is how the SSR framework detects islands (do not use `"use client"`, that's a Next.js concept)
- **ALL network calls must be inside `mutation.create()`** — never do manual fetch calls outside mutations
- `mutation` handles loading/error state automatically — never create manual loading/error signals
- Props must be serializable (no functions, no class instances)
- Islands hydrate independently — they don't share state
- Use SolidJS primitives: `createSignal`, `createMemo`, `createEffect`, `For`, `Show`, `Switch/Match`

## Platform Shell & Service Discovery

The platform runs as **multiple independent Bun containers** (one per app), but the user experiences it as a single, unified application. This works through three mechanisms:

1. **Shared Layout Shell** — every page uses the same `Layout` component with identical header, navigation rail, footer, and CSS
2. **Redis App Registry** — each container self-registers on startup; the Layout dynamically builds navigation from the live registry
3. **View Transitions** — the browser animates smoothly between pages, even when crossing container boundaries (same origin)

The result: navigating from `/app/spaces` to `/app/contacts` feels instant and seamless, even though these are completely separate Bun processes.

### Layout Component

`Layout` is the root wrapper for all pages. It provides the entire platform chrome — header with breadcrumbs, desktop navigation rail, mobile hamburger menu, global search, theme toggle, profile warnings, and footer.

```typescript
import { Layout } from "@valentinkolb/cloud/ssr";

<Layout
  c={c}                    // Hono context (required)
  title={breadcrumbs}       // Breadcrumb array or string
  fullWidth                 // Remove content side padding (for multi-column layouts)
  fullPage                  // Remove footer, overflow hidden (for fill-height layouts)
>
  {children}
</Layout>
```

**Breadcrumb format:**
```typescript
title={[
  { title: "Start", href: "/" },
  { title: "My App", href: "/app/my-app" },
  { title: "Item Detail" },   // last item has no href
]}
```

**How navigation is built automatically:**

- On startup, each app container calls `appRegistry.upsert()` with its nav config (icon, href, section, roles) and sends heartbeats every 60s
- Every container maintains a live streaming listener on the registry — when any app registers/deregisters, `currentRuntime` refreshes within milliseconds
- `Layout` reads `runtime.apps` from the Hono context and calls `buildNavLinks()` which:
  - Filters by `nav.section`: `"primary"` apps show in the rail, `"more"` apps in a dropdown, `"hidden"` apps are excluded
  - Applies role-based filtering (`requiresAuth`, `requiresRoles`) per user
  - Adds an admin link if the user has the admin role
- You never hardcode navigation — adding a new app container with a `nav` config is enough for it to appear everywhere

### AdminLayout

Wraps `Layout` with an admin-specific sidebar. The sidebar is also built from the registry — every app with an `adminHref` property automatically gets a link in the admin sidebar.

```typescript
import { AdminLayout } from "@valentinkolb/cloud/ssr";

<AdminLayout c={c} title="Settings" stretch>
  {children}
</AdminLayout>
```

`stretch` bypasses the scroll wrapper so the child component manages its own overflow (useful for full-height layouts).

The `title` prop on `AdminLayout` ONLY feeds the breadcrumbs — it does NOT render a visible heading. Every admin page must render its own `<h1>` block as the first child of the content column, using the canonical pattern:

```tsx
<AdminLayout c={c} title="Logs" stretch>
  <div class="flex-1 min-h-0 overflow-y-auto">
    <div class="flex flex-col gap-2">
      <div class="min-w-0" style="view-transition-name: admin-logs-title">
        <h1 class="text-base font-semibold text-primary">Logs</h1>
      </div>

      {/* stats, search bar, table, ... */}
    </div>
  </div>
</AdminLayout>
```

Title rules:
- **Plain block, not a flex row.** Wrapping the title inside `flex items-center justify-between` together with an action button vertically centres the `<h1>` against the (taller) button — the title visibly drops a few pixels below where it should sit. Action buttons go in their own row below the stats / search bar.
- `view-transition-name: admin-{slug}-title` (singular `-title`, not `-toolbar`) so cross-page animations match.
- Use `text-base font-semibold text-primary` — `text-base` is intentional, keep it consistent with the rest of the admin pages.

### Global Search

The platform provides a spotlight-style search dialog (triggered via `Cmd+K` / `Ctrl+K`). Each app registers search capabilities in `app.start()`:

```typescript
capabilities: {
  search: {
    tags: ["items"],
    help: "Search items by title",
    run: async ({ query, tags, limit, ctx }) => { /* return AppSearchResult[] */ },
  },
}
```

The core app aggregates results from all registered app containers and displays them grouped by app. Search results include `href` links that navigate across containers — view transitions make this feel seamless.

## UI Components

All components are imported from `@valentinkolb/cloud/ui`. There is no separate `@valentinkolb/cloud/ui/input` export path.

### Prompts System

The prompts system is the primary way to show dialogs, collect input, and display errors.

```typescript
import { prompts, DialogHeader } from "@valentinkolb/cloud/ui";
```

#### prompts.form()

```typescript
const result = await prompts.form({
  title: "Create Item",
  icon: "ti ti-plus",
  size: "medium",            // "small" | "medium" | "large"
  fields: {
    title: { type: "text", label: "Title", required: true, placeholder: "Enter title..." },
    description: { type: "text", label: "Description", multiline: true },
    priority: { type: "number", label: "Priority", default: 0, min: 0, max: 10 },
    category: {
      type: "select",
      label: "Category",
      options: [                                     // string[] or object[]
        { id: "work", label: "Work", icon: "ti ti-briefcase" },  // uses `id`, NOT `value`
        { id: "personal", label: "Personal" },
      ],
    },
    isPublic: { type: "boolean", label: "Make public" },
    tags: { type: "tags", label: "Tags", placeholder: "Add tags..." },
    dueDate: { type: "datetime", label: "Due date", dateOnly: true },  // `dateOnly`, NOT `type`
    note: { type: "info", content: "This is informational text" },     // `content`, NOT `text`
    avatar: { type: "image", label: "Avatar", round: true },
    code: { type: "pin", label: "Code", length: 6 },
  },
});
// result is typed object or null if cancelled
```

**Field types:**

| Type | Key props | Returns |
|------|-----------|---------|
| `text` | `multiline`, `password`, `placeholder`, `icon`, `activeIcon` | `string` |
| `number` | `min`, `max`, `step` | `number` |
| `select` | `options: string[] \| { id, label?, icon?, description? }[]`, `clearable` | `string` |
| `tags` | `placeholder`, `maxTags`, `minTags` | `string[]` |
| `boolean` | — | `boolean` |
| `datetime` | `dateOnly: boolean` | `string` |
| `image` | `round`, `ariaLabel` | `string` (base64) |
| `pin` | `length`, `stretch` | `string` |
| `info` | `content: string \| JSX.Element \| (() => JSX.Element)` | — (display only) |

All field types support: `label`, `description`, `required`, `default`, `validate: (value) => string | null`

#### prompts.dialog()

```typescript
const result = await prompts.dialog(
  (close) => (
    <div>
      <DialogHeader title="Custom" icon="ti ti-star" close={close} />
      <div class="p-4">
        <button class="btn-primary" onClick={() => close("done")}>Done</button>
      </div>
    </div>
  ),
  { size: "large" }
);
```

#### prompts.error() / prompts.alert()

```typescript
prompts.error("Something went wrong");
prompts.error("Detailed message", { title: "Upload Failed" });
await prompts.alert("Done", { title: "Success", icon: "ti ti-check" });
```

#### prompts.search()

Positional API: `prompts.search(resolver, options?)`

```typescript
const selected = await prompts.search(
  // First arg: resolver function
  async ({ query, abortSignal }) => {
    const res = await fetch(`/api/users?q=${query}`, { signal: abortSignal });
    const data = await res.json();
    return data.items.map(u => ({
      label: u.displayName,
      desc: u.mail,
      icon: "ti ti-user",
      value: u,
    }));
  },
  // Second arg: options
  { title: "Find User", placeholder: "Search by name..." }
);
```

### Input Components

All from `@valentinkolb/cloud/ui`. **Important:** Reactive props expect accessor functions, not direct values.

```jsx
import { TextInput, NumberInput, Select, Switch, Checkbox, TagsInput } from "@valentinkolb/cloud/ui";

<TextInput
  value={() => mySignal()}              // accessor function, NOT direct value
  onInput={(v) => setMySignal(v)}
  label="Name"
  placeholder="Enter name..."
  required
  error={() => errors().name}            // accessor function for error message
/>

<Select
  value={() => category()}
  onChange={(v) => setCategory(v)}
  label="Category"
  options={[{ id: "a", label: "A" }, { id: "b", label: "B" }]}  // uses `id`
/>

<Switch
  value={() => enabled()}
  onChange={(v) => setEnabled(v)}
  label="Enable feature"
/>
```

### FilterChip

Dropdown filter with sections:

```jsx
import { FilterChip } from "@valentinkolb/cloud/ui";

<FilterChip
  label="Level"
  icon="ti ti-filter"
  options={[{                           // array of FilterChipSection
    label: "Log Level",                 // optional section label
    multiple: true,                     // multi-select within section
    options: [
      { label: "Error", value: "error", icon: "ti ti-alert-circle", color: "red" },
      { label: "Warning", value: "warn", icon: "ti ti-alert-triangle", color: "amber" },
      { label: "Info", value: "info", icon: "ti ti-info-circle", color: "blue" },
    ],
  }]}
  value={selectedLevels()}               // current selection
  onChange={(values) => applyFilter("level", values.join(","))}
/>
```

**Props:** `label`, `icon`, `options: FilterChipSection[]`, `value: string[]`, `onChange`, `isActive?`, `position?`, `defaultValue?`

### Pagination

```jsx
import { Pagination } from "@valentinkolb/cloud/ui";

<Pagination
  currentPage={pagination.page}
  totalPages={pagination.total_pages}
  baseUrl="/app/my-app?page="         // page number appended directly (e.g. "?page=2")
/>
```

### EntitySearch

User/group search autocomplete:

```jsx
import { EntitySearch } from "@valentinkolb/cloud/ui";

<EntitySearch
  searchUsers={true}                    // enable user search
  searchGroups={true}                   // enable group search
  excludeUserIds={existingUserIds()}    // exclude already-selected
  excludeGroupIds={existingGroupIds()}
  onSelect={(result) => {
    // result: { type: "user", id, displayName, mail }
    //       | { type: "group", id, provider, name, description }
  }}
  placeholder="Search users or groups..."
/>
```

**Props:** `searchUsers?`, `searchGroups?`, `excludeUserIds?`, `excludeGroupIds?`, `onSelect`, `placeholder?`, `adding?`, `apiBaseUrl?`, `groupProvider?`

### PermissionEditor

Access control UI using the ResourceAccessAdapter pattern:

```jsx
import { PermissionEditor } from "@valentinkolb/cloud/ui";

<PermissionEditor
  resourceId={itemId}
  initialEntries={accessEntries()}
  canEdit={hasAdminPermission()}
  grantAccess={async (resourceId, principal, permission) => {
    // Create access entry, return AccessEntry
  }}
  updateAccess={async (resourceId, accessId, permission) => {
    // Update permission level
  }}
  revokeAccess={async (resourceId, accessId) => {
    // Remove access entry
  }}
  allowPublic={false}
/>
```

**Props:** `resourceId`, `initialEntries: AccessEntry[]`, `canEdit?`, `grantAccess`, `updateAccess`, `revokeAccess`, `allowPublic?`

See `packages/apps/src/contacts/frontend/_components/BookSettingsForm.island.tsx` for a real example.

### SidebarLayout / SidebarFromSpec

```jsx
import { SidebarFromSpec, type SidebarSpec } from "@valentinkolb/cloud/ui";

const spec: SidebarSpec = {
  header: {                              // required object, NOT array
    title: "My Sidebar",
    subtitle: "optional",
    icon: "ti ti-list",
    settingsHref: "/app/my-app/settings",
  },
  actions: [                             // SidebarSection[] or SidebarRow[]
    { title: "Actions", rows: [
      { id: "new", label: "New Item", icon: "ti ti-plus", actionIcon: "ti ti-plus", onActionClick: handleCreate },
    ]},
  ],
  nav: [                                 // SidebarSection[] or SidebarRow[]
    { id: "all", label: "All Items", href: "/app/my-app", icon: "ti ti-list", active: isAll },
    { id: "fav", label: "Favorites", href: "/app/my-app?fav=1", icon: "ti ti-star", active: isFav },
  ],
  tree: {                                // optional SidebarTreeSpec
    nodes: treeNodes,
    selectedId: selectedId(),
    onSelect: (id) => navigate(id),
    expandedIds: expandedIds(),
    onToggle: (id) => toggleExpand(id),
  },
  mobile: {                              // optional mobile behavior
    mode: "auto",
    defaultOpen: false,
  },
};

<div class="app-cols h-full">
  <SidebarFromSpec spec={spec} />
  <div class="flex-1 min-w-0 flex flex-col">{children}</div>
</div>
```

**SidebarRow:** `{ id, label?, href?, icon?, labelIcon?, meta?, active?, class?, content?, actionIcon?, actionLabel?, onActionClick? }`

### CopyButton

```jsx
import { CopyButton } from "@valentinkolb/cloud/ui";

<CopyButton text={item.id} label="Copy ID" />
```

**Props:** `text`, `label?`, `class?`

### MarkdownView

Expects pre-rendered HTML (use `renderMarkdown()` from `@valentinkolb/cloud/shared` on the server):

```jsx
import { MarkdownView } from "@valentinkolb/cloud/ui";

<MarkdownView html={preRenderedHtml} />
```

## CSS Utility Classes

### Buttons

```html
<button class="btn-primary">Primary</button>
<button class="btn-secondary">Secondary</button>
<button class="btn-danger">Danger</button>
<button class="btn-success">Success</button>
<button class="btn-simple">Simple</button>
<button class="btn-input">Input-styled</button>

<button class="btn-primary btn-sm">Small</button>
<button class="btn-primary btn-md">Medium</button>

<!-- With icon -->
<button class="btn-primary btn-sm"><i class="ti ti-plus" /> Create</button>
```

### Text

```html
<span class="text-primary">Main text</span>
<span class="text-secondary">Secondary text</span>
<span class="text-dimmed">Muted/placeholder text</span>
<span class="text-label">Label text</span>
<h2 class="section-label">Section Header</h2>
```

### Cards & Containers

```html
<div class="paper">Card content</div>
<a class="paper hover:paper-highlighted transition-all">Clickable card</a>

<div class="info-block-info"><i class="ti ti-info-circle" /> Info message</div>
<div class="info-block-warning"><i class="ti ti-alert-triangle" /> Warning</div>
<div class="info-block-danger"><i class="ti ti-alert-circle" /> Error</div>
```

### Stats

Three patterns for numeric metrics. All raw Tailwind, no custom utilities. Live demos:
`packages/ui-lab/src/frontend/UiLabShowcase.island.tsx` → section "Stat Cards".

**Small-grid (the default — use this for almost every dashboard)** — 2–6 metrics
side by side, divided cells, paper outer:

```html
<div class="paper overflow-hidden">
  <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px p-px bg-zinc-100 dark:bg-zinc-800">
    <div class="bg-white dark:bg-zinc-900 px-4 py-4 flex flex-col gap-0.5">
      <span class="text-[10px] uppercase tracking-wider text-dimmed">Apps</span>
      <span class="text-xl font-bold tabular-nums text-primary">17</span>
      <span class="text-[10px] text-dimmed">9·12</span>
    </div>
    <!-- repeat per metric -->
  </div>
</div>
```

**Border rules — get these wrong and the layout breaks. They are non-negotiable:**

1. **Outer container = `paper overflow-hidden`** (`overflow-hidden` clips cell
   corners against the rounded paper border).
2. **Grid container = `grid ... gap-px p-px bg-zinc-100 dark:bg-zinc-800`**. The
   `gap-px` draws lines BETWEEN cells; the `p-px` extends the same line around
   the OUTSIDE of the grid. Without `p-px` the leftmost / topmost cells lose
   their border.
3. **Each cell = `bg-white dark:bg-zinc-900`** (must match `paper` bg). The
   cell bg overlays the parent's zinc bg; only the 1px gap+padding shows
   through. If a cell forgets its bg, the whole cell turns into divider color.
4. **NEVER use `divide-x divide-y` for a 2D grid of stats** — it adds borders
   only to `:not(:first-child)`, which produces double lines at corners and
   missing lines on edges. Use the `gap-px p-px` trick above.
5. **Don't put `border-b` / `border-r` on neighbour blocks** to "help" the grid —
   the `p-px` already draws every outer edge. Adding extra borders doubles them.

**Cell typography (also non-negotiable for visual consistency):**

- Label: `text-[10px] uppercase tracking-wider text-dimmed`
- Value: `text-xl font-bold tabular-nums text-primary` (or `text-2xl` / `text-3xl` if you have space)
- Sub:   `text-[10px] text-dimmed`
- Use `&nbsp;` as sub when no sub text exists, so all cells stay equal height.
- Color a value (`text-amber-600`, `text-emerald-600`, `text-red-500`) for
  warning / success signals. **Never** color the cell background.

**Optional accent** — append after the sub when a metric has a state worth
signalling. Two forms depending on whether you have text:

**Icon-only accent** — drop the pill entirely, just use a colored icon. The
`.tag` background looks squished around a single icon. Use `text-[11px]` so
the icon reads as an accent, not chrome:

```html
<div class="flex items-center gap-1.5">
  <span class="text-[10px] text-dimmed">visible to users</span>
  <i class="ti ti-eye text-blue-600 dark:text-blue-400 text-[11px]" />
</div>
```

**Icon + text pill** — use `.tag` with bg. The `.tag` utility already includes
`gap-1` so the icon and text don't kiss:

```html
<div class="bg-white dark:bg-zinc-900 px-4 py-4 flex flex-col gap-0.5">
  <span class="text-[10px] uppercase tracking-wider text-dimmed">Errors</span>
  <span class="text-xl font-bold tabular-nums text-red-500">12</span>
  <div class="flex items-center gap-1.5">
    <span class="text-[10px] text-dimmed">last 24h</span>
    <span class="tag bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
      <i class="ti ti-trending-up text-[9px]" />+3
    </span>
  </div>
</div>
```

Color conventions (match the rest of the codebase — no rainbow):
- emerald — ok / healthy
- amber — warning / needs attention
- red — error / critical
- blue — informational accent / neutral category marker
- zinc — neutral

For pills with bg use the full pair:
`bg-{color}-100 text-{color}-700 dark:bg-{color}-900/40 dark:text-{color}-300`

For icon-only accents use just the text color:
`text-{color}-600 dark:text-{color}-400`

**Don't add an accent to every cell** — apply where there's a real signal:
warning state, trend, status. Otherwise keep the sub plain. The accents are
meant to break the rigid grid rhythm, not become the grid themselves.

**Pill row** — single line of compact chips, header-bar territory:

```html
<div class="flex flex-wrap gap-1">
  <span class="inline-flex items-baseline gap-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800/70 px-2 py-0.5">
    <span class="text-[10px] uppercase tracking-wider text-dimmed">apps</span>
    <span class="text-xs font-bold tabular-nums text-primary">17</span>
  </span>
  <!-- accent chip for status: -->
  <span class="inline-flex items-baseline gap-1.5 rounded-md bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5">
    <span class="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300">healthy</span>
    <span class="text-xs font-bold tabular-nums text-emerald-700 dark:text-emerald-300">17/17</span>
  </span>
</div>
```

**Hero (wide left widget + small grid)** — for dashboards where a richer
content block needs to sit alongside the stats. The "hero" side can be a
single big lead metric (`text-7xl` number + sub), a list of progress rows
(e.g. run-health style), or any composed content with vertical depth. The
right side is a 2x2 (or 3x2) small-grid following the same border rules as
above. See UI Lab and `packages/accounts/src/frontend/page.tsx` for live
examples. Only reach for this when the side-by-side composition is
meaningfully better than stacking.

**Anti-patterns — do not do**:

- Rainbow icon backgrounds (`bg-blue-100`, `bg-rose-100`, etc. for each icon).
  The codebase is zinc-based with single accent colors. Multi-color icon rows
  read as Material/Google and clash with the rest of the UI.
- Putting progress bars, status lists, or icon grids inside a stat-cell —
  use a plain `.paper` panel for those, side by side with the stats.
- Centered cell content (`items-center justify-center`). Stat cells are
  left-aligned; centering looks unbalanced when label / value / sub widths
  differ.

### Layout

```html
<div class="app-cols h-full">           <!-- sidebar + content grid -->
  <aside>Sidebar</aside>
  <main class="flex-1 min-w-0">Content</main>
</div>

<div class="max-w-4xl mx-auto">Centered</div>
<div class="flex items-center gap-2">Horizontal</div>
<div class="flex flex-col gap-2">Vertical</div>
<div class="flex items-center justify-between">Space between</div>
```

### Dark Mode

All styles support dark mode via `.dark` class. Use Tailwind's `dark:` prefix:

```html
<div class="bg-white dark:bg-zinc-900">Adapts to theme</div>
```

## Mutation Pattern (Detail)

The `mutation` module from `@valentinkolb/stdlib/solid`. **All network calls in islands must be inside `mutation.create()`** — never do manual fetch calls outside mutations. Never create manual loading/error signals — `mutation` handles this automatically.

**The Mutation + Prompts Pattern** — everything goes in the mutation, including the prompt:

```typescript
import { mutation } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";

const saveThing = mutation.create({
  mutation: async () => {
    // 1. Collect input (inside the mutation — prompts.form can fail too)
    const data = await prompts.form({
      title: "Save Item",
      icon: "ti ti-device-floppy",
      fields: {
        title: { type: "text", label: "Title", required: true },
        description: { type: "text", label: "Description", multiline: true },
      },
    });
    if (!data) return null; // user cancelled

    // 2. Make the API call
    const res = await apiClient.items.$post({ json: data });
    if (!res.ok) throw new Error((await res.json()).message);
    return res.json();
  },
  onSuccess: (result) => { if (result) { /* update local state */ } },
  onError: (err) => prompts.error(err.message),
});

// 3. Wire to button with loading state
<button
  class="btn-primary btn-sm"
  disabled={saveThing.loading()}
  onClick={() => saveThing.mutate()}
>
  {saveThing.loading()
    ? <><i class="ti ti-loader-2 animate-spin" /> Saving...</>
    : <><i class="ti ti-device-floppy" /> Save</>}
</button>

saveThing.abort();     // abort in-flight
saveThing.error();     // Error | null signal
```

**Simple mutation without prompt** (e.g. delete):

```typescript
const deleteItem = mutation.create({
  mutation: async (id: string) => {
    const res = await apiClient.items[":id"].$delete({ param: { id } });
    if (!res.ok) throw new Error((await res.json()).message);
  },
  onSuccess: (_, id) => setItems((prev) => prev.filter((i) => i.id !== id)),
  onError: (err) => prompts.error(err.message),
});

<button
  class="btn-danger btn-sm"
  disabled={deleteItem.loading()}
  onClick={() => deleteItem.mutate(item.id)}
>
  <i class="ti ti-trash" />
</button>
```

## Typed Hono API Client

```typescript
// api/client.ts
import { api } from "@valentinkolb/cloud/browser";
import type { ApiType } from ".";

export const apiClient = api.create<ApiType>({ baseUrl: "/api/app/my-app" });
```

The base URL must match how routes are mounted: `app.start()` mounts API routes at `/api`, and the app mounts sub-routes at `/app/my-app`, so the full path is `/api/app/my-app`.

**Usage in islands** (always inside `mutation.create()`):

```typescript
// GET
const res = await apiClient.items.$get({ query: { page: "1", search: "hello" } });
const data = await res.json();  // fully typed

// POST
const res = await apiClient.items.$post({ json: { title: "New" } });

// With path params
const res = await apiClient.items[":id"].$get({ param: { id: "some-uuid" } });

// DELETE
const res = await apiClient.items[":id"].$delete({ param: { id } });

// Always check res.ok and throw on failure (mutation catches it)
if (!res.ok) throw new Error((await res.json()).message);
```

## Common UI Patterns

### Empty State

```jsx
<div class="flex flex-col items-center justify-center py-12 gap-2">
  <i class="ti ti-inbox text-3xl text-dimmed" />
  <p class="text-sm text-dimmed">No items yet</p>
  <button class="btn-primary btn-sm" onClick={handleCreate}>
    <i class="ti ti-plus" /> Create first item
  </button>
</div>
```

### List Item with Actions

```jsx
<div class="paper p-3 flex items-center gap-3">
  <div class="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
    <i class="ti ti-file text-blue-500" />
  </div>
  <div class="flex-1 min-w-0">
    <span class="text-sm font-medium text-primary truncate block">{item.title}</span>
    <span class="text-xs text-dimmed">{formatDate(item.createdAt)}</span>
  </div>
  <div class="flex items-center gap-1">
    <button class="btn-simple btn-sm" onClick={() => handleEdit(item)}><i class="ti ti-edit" /></button>
    <button class="btn-danger btn-sm" onClick={() => handleDelete(item.id)}><i class="ti ti-trash" /></button>
  </div>
</div>
```

### Detail Dialog

```jsx
const showDetail = async (item: Item) => {
  await prompts.dialog(
    (close) => (
      <div>
        <DialogHeader title={item.title} icon="ti ti-file" close={close} />
        <div class="p-4 flex flex-col gap-3">
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <span class="text-dimmed">ID</span>
            <span class="flex items-center gap-1">{item.id} <CopyButton text={item.id} /></span>
            <span class="text-dimmed">Created</span>
            <span>{formatDate(item.createdAt)}</span>
          </div>
        </div>
      </div>
    ),
    { size: "medium" }
  );
};
```

### Confirmation Before Delete

```jsx
const handleDelete = async (id: string) => {
  const confirmed = await prompts.dialog(
    (close) => (
      <div>
        <DialogHeader title="Delete Item" icon="ti ti-trash" close={close} variant="danger" />
        <div class="p-4">
          <p class="text-sm">Are you sure? This cannot be undone.</p>
          <div class="flex justify-end gap-2 mt-4">
            <button class="btn-secondary btn-sm" onClick={() => close(false)}>Cancel</button>
            <button class="btn-danger btn-sm" onClick={() => close(true)}>Delete</button>
          </div>
        </div>
      </div>
    ),
    { size: "small" }
  );
  if (confirmed) deleteMutation.mutate(id);
};
```

### Sticky Action Bar

```jsx
<Show when={hasChanges()}>
  <div class="sticky bottom-0 p-3 paper flex items-center justify-between gap-2 border-t">
    <span class="text-xs text-dimmed">{changeCount()} unsaved changes</span>
    <div class="flex gap-2">
      <button class="btn-secondary btn-sm" onClick={discard}>Discard</button>
      <button class="btn-primary btn-sm" disabled={saving.loading()} onClick={saveAll}>
        {saving.loading() ? "Saving..." : "Save All"}
      </button>
    </div>
  </div>
</Show>
```

## URL State & Navigation Helpers

Filters and pagination live in URL params (SSR-friendly).

**In SSR pages** — read directly from the Hono request URL:

```typescript
const url = new URL(c.req.url);
const search = url.searchParams.get("search") ?? "";
const page = Number(url.searchParams.get("page") ?? 1);
```

**In islands** — each app provides navigation helpers in `frontend/lib/navigation.ts`:

```typescript
// frontend/lib/navigation.ts — standard helpers (create per app)
export const currentPathWithQuery = () => window.location.pathname + window.location.search;
export const refreshCurrentPath = () => window.location.assign(currentPathWithQuery());
export const navigateTo = (href: string) => window.location.assign(href);
```

**For search/filter bars** — use `SearchBar` from `@valentinkolb/cloud/ssr/islands`:

```typescript
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";

// Automatically syncs search input to URL param and triggers navigation
<SearchBar action="/app/my-app" param="search" placeholder="Search items..." />
```

**For complex filters** — define typed filter builders per app:

```typescript
// frontend/lib/filter.ts
export const buildFilterUrl = (base: string, updates: Partial<Filter>, current: Filter) => {
  const url = new URL(base, window.location.origin);
  if (updates.search ?? current.search) url.searchParams.set("search", updates.search ?? current.search);
  url.searchParams.delete("page"); // reset pagination on filter change
  return url.pathname + url.search;
};
```

## View Transitions

View transitions are enabled globally via `<meta name="view-transition" content="same-origin">` in the HTML template. **Always add `view-transition-name` to elements that should animate between pages.** This is not optional — use it on cards, headers, sidebars, tables, and any element that persists across page navigations.

This is especially important for the **multi-container architecture**: when a user navigates from `/app/spaces` to `/app/contacts`, the request hits a completely different Bun process — but because both use the same `Layout` shell and both set `view-transition-name` on the shared chrome (header, rail, footer), the browser animates smoothly as if it were a single-page app. The navigation rail, header, and profile section persist visually while only the content area transitions.

```jsx
// Static names for page sections
<div style="view-transition-name: admin-logs-title">...</div>
<section style="view-transition-name: admin-logs-table">...</section>

// Dynamic names for list items (enables card ↔ detail transitions)
<a href={`/app/my-app/${item.id}`} style={`view-transition-name: item-card-${item.id}`}>...</a>
```

**Naming convention:** `{app}-{element}-{id?}`. For sidebars with many items, use a `vt()` helper:

```typescript
const vt = (key: string) => `my-app-sidebar-${key}`;
<div style={`view-transition-name:${vt(`item-${item.id}`)}`}>...</div>
```

## Icons

**Tabler Icons** via CSS classes:

```html
<i class="ti ti-star" />
<i class="ti ti-plus" />
<i class="ti ti-trash" />
<i class="ti ti-loader-2 animate-spin" />
```

Browse: [tabler-icons.io](https://tabler-icons.io)

## Hotkeys

```typescript
import { hotkeys } from "@valentinkolb/stdlib/solid";

hotkeys.register("mod+k", () => openSearch());  // Cmd on Mac, Ctrl on Win/Linux
```
