# Frontend Patterns — Detailed Reference

For new built-in apps, start with `app-ui-patterns.md` before this file. This file is the detailed component/API reference; `app-ui-patterns.md` decides which Cloud shell to use and which existing app to mirror.

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

`c.get("user")` is fine on pages that are explicitly protected with a
user-backed role such as `auth.requireRole("user")`. For APIs, resource
settings, or pages that should work with user-bound API keys, resource API keys,
or OAuth service tokens, use `c.get("actor")` and `c.get("accessSubject")` and
perform resource permission checks in the service layer.

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
  - Filters by `nav.section`: `"primary"` apps show in the rail, `"more"` apps stay out of the rail, and `"hidden"` apps are excluded
  - Builds one core app launchpad containing all visible `"primary"` and `"more"` apps plus the admin link for admin users
  - Opens that launchpad from the rail "apps" button on desktop and from the header app-grid button on mobile; mobile does not render a separate app dropdown
  - Applies role-based filtering (`requiresAuth`, `requiresRoles`) per user
  - Adds `/me` as a Profile footer link and aggregates app `legalLinks` for the launchpad footer
- You never hardcode navigation — adding a new app container with a `nav` config is enough for it to appear everywhere

**Opening the app launchpad from an island:**

Use the core launchpad API instead of re-implementing an app picker. Without
arguments it opens the current `Layout` context; with arguments it can open a
custom app/link set for the current island.

```typescript
import { openAppLaunchpad } from "@valentinkolb/cloud/ssr/islands";

openAppLaunchpad();
```

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
  <div class="flex-1 min-h-0 overflow-y-auto" style="scrollbar-gutter: stable">
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

Use the UI Lab as the live frontend reference while building: `/app/ui-lab` redirects to `/app/ui-lab/input/text`, and every documented component pattern has a routed page such as `/app/ui-lab/layout/workspace`, `/app/ui-lab/layout/overview`, `/app/ui-lab/layout/settings-modal`, `/app/ui-lab/layout/permissions`, `/app/ui-lab/surfaces/stats`, and `/app/ui-lab/surfaces/widgets`. The source of truth is the component implementation in `packages/cloud/src/ui/`; UI Lab is the visual/reference harness.

### Prompts System

The prompts system is the primary way to show dialogs, collect input, and display errors.

```typescript
import { DialogHeader, prompts, toast } from "@valentinkolb/cloud/ui";
```

In islands, prompts that lead to API writes belong inside `mutation.create()` (see [Mutation Pattern](#mutation-pattern-detail)). Use `onSuccess` for `toast.success(...)`, local state updates, navigation, or `refreshCurrentPath()`. Use `onError` for `prompts.error(...)`. This keeps input collection, network state, success feedback, and error feedback in one lifecycle.

#### prompts.form()

```typescript
const result = await prompts.form({
  title: "Create Item",
  icon: "ti ti-plus",
  size: "medium",            // "small" | "medium" | "large" | "wide"
  fields: {
    title: { type: "text", label: "Title", required: true, placeholder: "Enter title..." },
    description: { type: "text", label: "Description", multiline: true, lines: 12 },  // `lines` sets approx visible rows
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
| `text` | `multiline`, `lines`, `password`, `placeholder`, `icon`, `activeIcon` | `string` |
| `number` | `min`, `max`, `step` | `number` |
| `select` | `options: string[] \| { id, label?, icon?, description? }[]`, `clearable` | `string` |
| `tags` | `placeholder`, `maxTags`, `minTags` | `string[]` |
| `boolean` | — | `boolean` |
| `datetime` | `dateOnly: boolean` | `string` |
| `image` | `round`, `ariaLabel` | `string` (base64) |
| `pin` | `length`, `stretch` | `string` |
| `info` | `content: string \| JSX.Element \| (() => JSX.Element)` | — (display only) |

Input field types (`text`, `number`, `select`, `tags`, `boolean`, `datetime`, `image`, `pin`) support: `label`, `description`, `required`, `default`, `validate: (value) => string | null`. The `info` field is display-only and accepts only `type: "info"` and `content`.

#### prompts.dialog()

`prompts.dialog` already renders a `DialogHeader` from the `title` and `icon` options — the body callback should render only the dialog content.

```typescript
const result = await prompts.dialog(
  (close) => (
    <div class="p-4">
      <button class="btn-primary" onClick={() => close("done")}>Done</button>
    </div>
  ),
  { title: "Custom", icon: "ti ti-star", size: "large" }
);
```

When you need to drive the whole dialog shell explicitly, use the bare surface. This is how Notebook settings render `SettingsModal`: the prompt supplies only the overlay/portal, while the body owns header, tabs, and close action. Source: `packages/notebooks/src/frontend/[id]/_components/settings/NotebookSettingsPanel.island.tsx`.

```tsx
await prompts.dialog<void>(
  (close) => (
    <SettingsModal title="Notebook settings" icon="ti ti-notebook" onClose={close}>
      <SettingsModal.Tab id="general" title="General" icon="ti ti-settings">
        ...
      </SettingsModal.Tab>
    </SettingsModal>
  ),
  { surface: "bare", header: false, size: "large" },
);
```

For a custom dialog that still uses the standard header layout, import `DialogHeader` from `@valentinkolb/cloud/ui` and pass only `{ close, title, icon }`.

**Rule:** put `prompts.form()` and `prompts.dialog()` inside the mutation when the prompt is part of a write flow. That keeps prompt failures, API failures, loading state, success handling, and cancellation in one controller.

#### prompts.error() / prompts.alert()

```typescript
prompts.error("Something went wrong");
prompts.error("Detailed message", { title: "Upload Failed" });
await prompts.alert("Done", { title: "Success", icon: "ti ti-check" });
```

Use `toast.success(...)` for non-blocking success feedback after a write succeeds. Use `prompts.error(...)` for failures because it is blocking and readable for longer messages. Source: `packages/cloud/src/ui/toast.ts`.

```typescript
toast.success("Notebook created");
toast("All changes synced", { title: "Saved" });
toast.error("Network unreachable");
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
import { TextInput, NumberInput, Select, MultiSelectInput, Switch, Checkbox, TagsInput, FileDropzone } from "@valentinkolb/cloud/ui";

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

<MultiSelectInput
  value={() => categoryIds()}
  onChange={(ids) => setCategoryIds(ids)}
  label="Categories"
  options={[
    { id: "a", label: "A", icon: "ti ti-tag", description: "Primary category", color: "#3b82f6" },
    { id: "b", label: "B", icon: "ti ti-tag", color: "#10b981" },
  ]}
/>

<Switch
  value={() => enabled()}
  onChange={(v) => setEnabled(v)}
  label="Enable feature"
/>
```

#### FileDropzone

Use `FileDropzone` for visible upload/drop surfaces in dialogs and forms. Source: `packages/cloud/src/ui/input/FileDropzone.tsx`; live reference: `/app/ui-lab/input/file-dropzone`; real usage: Notebooks `/upload` attachment dialog in `packages/notebooks/src/frontend/[id]/_components/editor/AttachmentPicker.tsx`.

The component owns the drag/drop affordance, file-picker button, accepted-file UI states, busy styling, and error display. The app still owns persistence and upload mutations. Do not hand-write dashed dropzone boxes in apps; use this component and pass `onDrop`.

```tsx
import { FileDropzone } from "@valentinkolb/cloud/ui";

<FileDropzone
  title="Drop file or click to choose"
  subtitle="Upload a new attachment and insert it at the cursor."
  hint="Max 10 MB"
  accept="image/*"
  multiple={false}
  busy={upload.loading}
  error={() => upload.error()?.message}
  onDrop={(files) => upload.mutate(files)}
/>
```

Key props: `onDrop(files)`, `accept?`, `multiple?`, `busy?`, `error?`, `title?`, `subtitle?`, `hint?`, `icon?`, `label?`, `description?`, `required?`, `disabled?`.

#### DateTimeInput and Timezones

`DateTimeInput` accepts `dateConfig?: DateContext` or `timeZone` as a convenience override. When a timezone is provided, the visible native input edits wall-clock time in that timezone while the value handed back to app code is a UTC instant string. Date-only mode stays `YYYY-MM-DD`.

```tsx
import { DateTimeInput } from "@valentinkolb/cloud/ui";

<DateTimeInput label="Start" value={startsAt} onChange={setStartsAt} dateConfig={props.dateConfig} />
<DateTimeInput label="Due date" value={deadline} onChange={setDeadline} dateOnly dateConfig={props.dateConfig} />
```

SSR pages should pass `dateConfig={getDateConfig(c)}` into islands that render date/time inputs, calendars, or other user-facing times. Do not use local `Date#getHours()` / `getMonth()` / `toLocaleString()` directly for timezone-sensitive UI; use `@valentinkolb/stdlib` `dates.*` with the same `DateContext`.

#### TextInput

`TextInput` supports plain text, password/search-like input types, textarea mode, markdown mode, prefix/suffix adornments, clear buttons, abbreviations, completions, and active icons. Source: `packages/cloud/src/ui/input/TextInput.tsx`.

Key props: `name?`, `label?`, `description?`, `placeholder?`, `value?: () => string | undefined`, `onChange?`, `onInput?`, `error?: () => string | undefined`, `required?`, `disabled?`, `multiline?`, `lines?`, `type?`, `icon?`, `activeIcon?`, `prefix?`, `suffix?`, `clearable?`, `onClear?`, `markdown?`, `abbreviations?`, `completions?`, `ariaLabel?`, `inputMode?`, `maxLength?`, `autocomplete?`.

#### NumberInput

`NumberInput` is not just a styled text input. Source: `packages/cloud/src/ui/input/NumberInput.tsx`.

```tsx
<NumberInput
  label="Budget"
  value={() => budget()}
  onInput={setBudget}
  min={0}
  step={50}
  decimalPlaces={2}
  prefix="EUR"
  clearable
/>
```

Key behavior:
- `value` is `() => number | null | undefined`; `onInput`/`onChange` receive `number | null`.
- Empty input emits `null`; `clearable` uses the same `null` state.
- `decimalPlaces` defaults to `0`, so plain `NumberInput` is integer-only.
- `allowNegative={false}` blocks negative typing and blur normalization.
- `showSteppers` renders explicit plus/minus buttons; `disableSteppers` keeps native keyboard/input behavior but hides step controls.
- `prefix`/`suffix` render inside the input shell.

#### Select, MultiSelectInput, and Combobox

`Select` owns option lists and optional async fetching. Source: `packages/cloud/src/ui/input/Select.tsx`.

```tsx
<Select
  value={() => selectedId()}
  selectedLabel={() => selectedLabel()}
  onChange={setSelectedId}
  options={[{ id: "work", label: "Work", icon: "ti ti-briefcase" }]}
  fetchData={async (query) => searchCategories(query)}
  fetchDebounceMs={250}
  clearable
/>
```

`MultiSelectInput` uses the same option shape as `Select`, plus optional `color`. It owns a stable `string[]` value and renders selected options as compact colored pills. Use it for multi-choice filters, labels, roles, tags backed by known ids, and other cases where the chosen values must be constrained to known options. Source: `packages/cloud/src/ui/input/MultiSelectInput.tsx`.

```tsx
<MultiSelectInput
  value={() => selectedIds()}
  onChange={setSelectedIds}
  options={[
    { id: "open", label: "Open", icon: "ti ti-circle", description: "Needs work", color: "#3b82f6" },
    { id: "done", label: "Done", icon: "ti ti-check", color: "#10b981" },
  ]}
  clearable
/>
```

`Combobox` is for search-and-pick flows where the selected item is handled by `onSelect`; it fetches options via `fetchData(query)` and does not own a stable selected value. Source: `packages/cloud/src/ui/input/Combobox.tsx`.

#### Markdown editing — two entry points

The same overtype-style markdown editor (invisible-textarea overlay on a
syntax-highlighted preview) is exposed in two shapes. Pick by use-case:

**`<TextInput markdown />`** — for **form fields**. Wraps the editor in the
standard `InputWrapper` chrome so it inherits label / description / error
rendering and matches the visual rhythm of `TextInput`, `NumberInput`, etc.
in a form column.

```jsx
<TextInput
  markdown
  label="Description"
  value={() => description()}
  onInput={setDescription}
  lines={8}
  abbreviations={{ mfg: "Mit freundlichen Grüßen", lg: "Liebe Grüße" }}
/>
```

**`<MarkdownEditor />`** — for **standalone editors** (email composer,
full-page note, doc body). No `InputWrapper`, no label slot — the
surrounding UI provides its own context. Same prop shape as the TextInput
markdown branch otherwise; `error` is a `boolean` flag (just toggles the
red border) rather than an accessor returning a message string, since
there's no chrome to render the message itself.

```jsx
<MarkdownEditor
  value={() => body()}
  onInput={setBody}
  onSubmit={send}                          // Cmd/Ctrl+Enter — bare Enter never submits
  placeholder="Write your message…"
  lines={20}
  abbreviations={signatureDict}
  spellcheck
/>
```

Both share: toolbar (B/I/code/link/H1-3/lists/quote with active-state on
the caret's current format), `Cmd/Ctrl + B/I/E/K/Shift+1-3/7/8` shortcuts,
smart Enter in lists (auto-continues marker, exits on empty item),
URL-on-selection paste → `[selection](url)`, optional `abbreviations` dict
for AutoText expansion (Cmd+Z or immediate Backspace reverts), lines /
words / chars footer. All mutations go through `execCommand("insertText")`
so native undo works.

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

`onChange` fires immediately when an option, clear, or reset action is clicked.
Do not wait for blur/close in URL-backed filters; the parent island should
commit the enhanced navigation immediately.

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

Access control UI for user/group/service-account/authenticated/public grants. Source: `packages/cloud/src/ui/misc/PermissionEditor.tsx`. Real usages close over the resource id in the callback implementation, for example Notebook settings (`packages/notebooks/src/frontend/[id]/_components/settings/NotebookSettingsPanel.tsx`) and Grids view settings (`packages/grids/src/frontend/_components/dialogs/ViewSettingsDialogs.tsx`).

`PermissionEditor` is not an API-key creation UI. If a resource needs API keys, put `ResourceApiKeys` in the resource settings surface and keep `PermissionEditor` for existing principal grants. Read `references/api-keys.md` before implementing that flow.

```jsx
import { PermissionEditor } from "@valentinkolb/cloud/ui";

<PermissionEditor
  initialEntries={accessEntries()}
  canEdit={hasAdminPermission()}
  allowPublic
  allowedLevels={[
    { level: "read", label: "View" },
    { level: "write", label: "Edit" },
    { level: "admin", label: "Admin" },
  ]}
  grantAccess={async (principal, permission) => {
    // Create access entry, return AccessEntry
  }}
  updateAccess={async (accessId, permission) => {
    // Update permission level
  }}
  revokeAccess={async (accessId) => {
    // Remove access entry
  }}
/>
```

**Props:** `initialEntries: AccessEntry[]`, `canEdit?`, `grantAccess(principal, permission): Promise<AccessEntry>`, `updateAccess(accessId, permission): Promise<void>`, `revokeAccess(accessId): Promise<void>`, `allowPublic?`, `allowServiceAccounts?`, `allowedLevels?`.

`allowedLevels` accepts `"read" | "write" | "admin"` or objects `{ level, label?, icon? }`. Use a single allowed level for view-only sharing flows, e.g. Grids passes `[{ level: "read", label: "View" }]`. The component does not accept a resource identifier prop; close over ids in the callback implementation instead.

`PermissionEditor` owns its own internal grant/update/revoke mutations and calls `prompts.error(err.message)` on callback failure. The app callbacks should perform the API request, check `res.ok`, throw meaningful errors, and return the created `AccessEntry` from `grantAccess`.

Do not import `GrantableLevel` from `@valentinkolb/cloud/contracts`; that barrel exports the platform contract types, not the UI helper type from `PermissionEditor.tsx`. In app code, prefer callback inference or derive the grantable union from the contract type:

```ts
import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";

type GrantableLevel = Exclude<PermissionLevel, "none">;
```

Canonical callback shape:

```tsx
<PermissionEditor
  initialEntries={accessEntries()}
  canEdit={canAdmin()}
  allowPublic
  grantAccess={async (principal, permission) => {
    const res = await apiClient[":id"].access.$post({
      param: { id: notebook.shortId },
      json: { principal, permission },
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to grant access."));
    return await res.json();
  }}
  updateAccess={async (accessId, permission) => {
    const res = await apiClient[":id"].access[":accessId"].$patch({
      param: { id: notebook.shortId, accessId },
      json: { permission },
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update access."));
  }}
  revokeAccess={async (accessId) => {
    const res = await apiClient[":id"].access[":accessId"].$delete({
      param: { id: notebook.shortId, accessId },
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to remove access."));
  }}
/>
```

### AppWorkspace

Compound layout for full-height app screens with left sidebar, main work area, and optional right detail panel. Source: `packages/cloud/src/ui/misc/AppWorkspace.tsx`. UI Lab uses it at `/app/ui-lab/layout/workspace`.

For full-height `AppWorkspace.Main` screens, use the same content spacing as admin stretch pages:

```tsx
<AppWorkspace.Main>
  <div class="flex-1 min-h-0 overflow-y-auto" style="scrollbar-gutter: stable">
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-3" style="view-transition-name: my-app-title">
        <h1 class="min-w-0 text-base font-semibold text-primary">Items</h1>
        <button type="button" class="btn-input btn-input-sm">Action</button>
      </div>

      <DataTable class="paper overflow-x-auto" />
    </div>
  </div>
</AppWorkspace.Main>
```

Do not add a generic `p-3` / `p-4` wrapper inside `AppWorkspace.Main`. Padding is already owned by the surrounding shell; extra page padding makes AppWorkspace screens drift from admin pages and other full-height apps. Keep vertical rhythm at `gap-2` unless a specific component needs internal padding.

Only put `scrollbar-gutter: stable` on the element that actually owns page scrolling. If the screen is composed of independently scrollable regions (for example an endpoints table and a requests table), keep `AppWorkspace.Main` as `flex min-h-0 flex-1 flex-col gap-2` without `overflow-y-auto` and put `overflow-auto` / `scrollPreserveKey` on each `DataTable`. Otherwise the reserved gutter appears as false spacing between main and detail.

Keep `AppWorkspace` column gaps at `gap-2`. Do not add margins between `AppWorkspace.Main` and `AppWorkspace.Detail`; let `app-cols` own that spacing.

Detail panels should read like Grids record details: compose multiple small
`detail-section` cards inside a `detail-stack` wrapper. Avoid wrapping the whole
detail panel in one large `paper`; it makes the panel feel like a modal inside
the workspace and breaks the shared app rhythm.

```jsx
import { AppWorkspace } from "@valentinkolb/cloud/ui";

<AppWorkspace>
  <AppWorkspace.Sidebar>
    <AppWorkspace.SidebarHeader title="My App" icon="ti ti-list" />
    <AppWorkspace.SidebarDesktop>
      <AppWorkspace.SidebarSection title="Navigation">
        <AppWorkspace.SidebarItem href="/app/my-app" icon="ti ti-list" active>
          All Items
        </AppWorkspace.SidebarItem>
      </AppWorkspace.SidebarSection>
    </AppWorkspace.SidebarDesktop>
  </AppWorkspace.Sidebar>
  <AppWorkspace.Main>{children}</AppWorkspace.Main>
  <AppWorkspace.Detail open={Boolean(selectedId())} width="md" class="detail-stack">
    <section class="detail-section">{detailHeader}</section>
    <section class="detail-section">{detailBody}</section>
  </AppWorkspace.Detail>
</AppWorkspace>
```

Use compound components instead of hand-written sidebar/detail classes. `SidebarItem` owns active, icon, mobile, tone, and meta styling.

Compound pieces:
- `AppWorkspace`, `AppWorkspace.Main`
- `AppWorkspace.Detail` with `open`, `width?: "sm" | "md" | "lg" | "xl"`, `widthClass?`, `viewTransitionName?`
- `AppWorkspace.Sidebar`, `SidebarHeader`, `SidebarMobile`, `SidebarMobileItems`, `SidebarDesktop`, `SidebarBody`, `SidebarFooter`, `SidebarSection`
- `AppWorkspace.SidebarBody` and `SidebarMobileBody` accept `scrollPreserveKey?: string | false`; pass a stable app-specific key when the body is a scrollable navigation/list region.
- `AppWorkspace.SidebarItem` with `href?`, `active?`, `activeClass?`, `icon?`, `meta?`, `tone?: "default" | "success" | "danger"`, `actionIcon?`, `actionLabel?`, `onActionClick?`, `onClick?`, and navigation props `navigation?: "enhanced" | "document"`, `onNavigate?`, `scroll?`, `replace?`.
- `AppWorkspace.SidebarIconGrid` and `SidebarIconAction` for compact icon action groups. `SidebarIconAction` supports the same navigation props as `SidebarItem`.

`SidebarItem`/`SidebarIconAction` default to enhanced navigation for same-origin `href`s. Without a custom `onNavigate`, enhanced navigation only updates history and scroll state; use `navigation="document"` when the target route must be loaded by SSR. Add `onNavigate` when the current island can safely update its own state for the target URL.

```tsx
// Full SSR route change: server must load new data.
<AppWorkspace.SidebarItem href="/app/grids" icon="ti ti-layout-grid" navigation="document">
  All grids
</AppWorkspace.SidebarItem>

// Client-side workspace transition: current island owns the next state.
<AppWorkspace.SidebarItem
  href="/app/ui-lab/layout/navigation"
  icon="ti ti-route"
  scroll="top"
  onNavigate={(nav) => {
    const next = resolveDocPage(nav.href);
    if (!next) return nav.fallback();
    setRoute(next);
    nav.push();
  }}
>
  Navigation
</AppWorkspace.SidebarItem>
```

Prefer `scrollPreserveKey` on scrollable AppWorkspace sidebar bodies instead of
manual scroll code:

```tsx
<AppWorkspace.SidebarBody scrollPreserveKey="my-app-sidebar">
  ...
</AppWorkspace.SidebarBody>
```

#### SSR list/detail workspace recipe

For a list/detail app, make selection URL-driven so reloads, sharing, SSR data loading, and back/forward navigation all work. The SSR page reads `?item=...`, renders `Layout fullWidth fullPage`, and passes serializable initial data to an island. The island may optimistically update local signals, but the canonical selected item stays in the URL.

```tsx
// frontend/page.tsx
return () => (
  <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Notes" }]} fullWidth fullPage>
    <NotesWorkspace notes={notes} selectedId={selectedId} selectedNote={selectedNote} />
  </Layout>
);
```

```tsx
// frontend/_components/NotesWorkspace.island.tsx
import { AppWorkspace, TextInput, navigateTo } from "@valentinkolb/cloud/ui";
import { createSignal, For, Show } from "solid-js";

export default function NotesWorkspace(props: {
  notes: NoteSummary[];
  selectedId: string | null;
  selectedNote: NoteDetail | null;
}) {
  const [query, setQuery] = createSignal("");

  return (
    <AppWorkspace>
      <AppWorkspace.Sidebar>
        <AppWorkspace.SidebarHeader title="Notes" icon="ti ti-notebook" />
        <AppWorkspace.SidebarDesktop>
          <AppWorkspace.SidebarSection title="Views">
            <AppWorkspace.SidebarItem href="/app/notes" icon="ti ti-notes" active>
              All notes
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarDesktop>
      </AppWorkspace.Sidebar>

      <AppWorkspace.Main>
        <div class="flex h-full min-h-0 flex-col">
          <div class="border-b border-zinc-200 p-3 dark:border-zinc-800">
            <TextInput value={query} onInput={setQuery} placeholder="Search notes..." clearable icon="ti ti-search" />
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto">
            <For each={props.notes}>
              {(note) => (
                <button
                  type="button"
                  class="block w-full border-b border-zinc-100 p-3 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  onClick={() => navigateTo(`/app/notes?item=${note.shortId}`)}
                >
                  <span class="block truncate text-sm font-medium text-primary">{note.title}</span>
                  <span class="text-xs text-dimmed">{note.updatedAt}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </AppWorkspace.Main>

      <AppWorkspace.Detail open={Boolean(props.selectedId)} width="lg">
        <Show when={props.selectedNote} fallback={<div class="p-4 text-sm text-dimmed">Select a note</div>}>
          {(note) => <NoteDetailPanel note={note()} />}
        </Show>
      </AppWorkspace.Detail>
    </AppWorkspace>
  );
}
```

For actions inside the detail panel, keep writes in `mutation.create()`. Use `navigateTo(...)` when the result selects a different URL, and `refreshCurrentPath()` when the current SSR page should reload with fresh server data. Source: `packages/cloud/src/ui/navigation.ts`.

```typescript
import { refreshCurrentPath, prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";

const archiveSelected = mutation.create<string | null, string | null>({
  mutation: async (selectedId) => {
    if (!selectedId) return null;
    const res = await apiClient.items[":id"].archive.$post({ param: { id: selectedId } });
    if (!res.ok) throw new Error("Failed to archive item");
    return selectedId;
  },
  onSuccess: (id) => {
    if (!id) return;
    toast.success("Item archived");
    refreshCurrentPath();
  },
  onError: (err) => prompts.error(err.message),
});
```

### AppOverview

Generic overview-page shell for app start pages. Source: `packages/cloud/src/ui/misc/AppOverview.tsx`; real usage: `packages/notebooks/src/frontend/NotebooksOverview.island.tsx`.

```tsx
<AppOverview title="Notebooks" subtitle="Collaborative notes and scripts." icon="ti ti-notebook">
  <AppOverview.Main title="Your notebooks" description="3 notebooks" toolbar={<TextInput type="search" />}>
    <NotebookCards />
  </AppOverview.Main>

  <AppOverview.Aside title="Create" description="Choose a starter, or start blank.">
    <TemplateButtons />
  </AppOverview.Aside>
</AppOverview>
```

Props:
- `AppOverview`: `title`, `subtitle?`, `icon`, `class?`, `children`
- `AppOverview.Main` / `Aside`: `title`, `description?: JSX.Element`, `toolbar?: JSX.Element`, `class?`, `children`
- `AppOverview.EmptyState`: `title`, `description?: JSX.Element`, `icon?`, `class?`, `children?`

The component is visual structure only. Keep search state, URL params, API calls, mutations, and templates in the consuming app.

For app landing pages that create top-level resources, keep the right column on
the shared create pattern used by Notebooks, Grids, and Spaces: `AppOverview.Aside
title="Create"` with a `grid grid-cols-1 gap-2` of `paper p-4 text-left flex
items-start gap-3` starter/template buttons, followed by a blank/create-from-
scratch button. Do not replace this with a one-off info card or generic shortcut
list; consistency makes app start pages easier to scan.

### SettingsModal

Tabbed settings shell for app configuration dialogs. Source: `packages/cloud/src/ui/misc/SettingsModal.tsx`; Notebook settings use it inside a bare prompt dialog at `packages/notebooks/src/frontend/[id]/_components/settings/NotebookSettingsPanel.island.tsx`.

```tsx
await prompts.dialog<void>(
  (close) => (
    <SettingsModal title="Notebook settings" subtitle={notebook.name} icon={notebook.icon} onClose={close}>
      <SettingsModal.Tab id="general" icon="ti ti-id" title="General" description="Name, icon, and metadata.">
        <GeneralSettings />
      </SettingsModal.Tab>
      <SettingsModal.Tab id="danger" icon="ti ti-alert-triangle" title="Danger" tone="danger">
        <DangerSettings />
      </SettingsModal.Tab>
    </SettingsModal>
  ),
  { surface: "bare", header: false, size: "large" },
);
```

`SettingsModal` props: `title`, `subtitle?`, `icon?`, `defaultTab?`, `activeTab?`, `onTabChange?`, `onClose?`, `closeLabel?`, `class?`, `children`.

`SettingsModal.Tab` props: `id`, `title`, `description?`, `icon?`, `tone?: "default" | "danger"`, `children`.

The component owns tab layout and optional internal active-tab state. Keep saving, dirty state, permissions, and mutations in the app.

### PanelDialog

Layout-only shell for complex editor dialogs. Source: `packages/cloud/src/ui/misc/PanelDialog.tsx`; real usage: Spaces item create/edit/event dialogs in `packages/spaces/src/frontend/[id]/_components/shared/ItemForm.tsx` opened via `dialogCore.open(..., panelDialogOptions)`.

Use `PanelDialog` when the modal body is a real editor with multiple groups, a fixed header/footer, and a scrollable body. Do **not** use it for small one-field prompts (`prompts.form` is better), simple picker dialogs (`prompts.dialog` is enough), or tabbed app settings (`SettingsModal` is the right shell).

```tsx
import { dialogCore, PanelDialog, panelDialogOptions } from "@valentinkolb/cloud/ui";

const result = await dialogCore.open<ItemFormData | null>(
  (close) => (
    <PanelDialog>
      <form onSubmit={submit}>
        <PanelDialog.Header title="Edit item" icon="ti ti-pencil" close={() => close(null)} />
        <PanelDialog.Body>
          <PanelDialog.Section title="Basics" subtitle="Name and notes." icon="ti ti-id">
            <TextInput label="Title" value={title} onInput={setTitle} required />
            <TextInput label="Description" value={description} onInput={setDescription} markdown />
          </PanelDialog.Section>
          <PanelDialog.Section title="Schedule" icon="ti ti-calendar-time">
            <DateTimeInput label="Start" value={startsAt} onChange={setStartsAt} dateConfig={props.dateConfig} />
            <DateTimeInput label="End" value={endsAt} onChange={setEndsAt} dateConfig={props.dateConfig} />
          </PanelDialog.Section>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <span />
          <div class="flex items-center gap-2">
            <button type="button" class="btn-secondary btn-sm" onClick={() => close(null)}>Cancel</button>
            <button type="submit" class="btn-primary btn-sm">Save</button>
          </div>
        </PanelDialog.Footer>
      </form>
    </PanelDialog>
  ),
  panelDialogOptions,
);
```

`PanelDialog` props: `children`.

`PanelDialog.Header` props: `title`, `subtitle?`, `icon`, `close`.

`PanelDialog.Body` / `Footer` props: `children`.

`PanelDialog.Section` props: `title`, `subtitle?`, `icon`, `children`.

`panelDialogOptions` is the standard `dialogCore.open` option object for this shell. It gives the Grids-style centered panel, fixed max viewport height, scroll-contained body, and bare content padding. `confirmDiscardIfDirty(dirty)` is available for editor close guards, but dirty state stays in the app.

The component is visual structure only. Keep form state, validation, input components, mutations, save/cancel semantics, and API calls in the consuming app. If the dialog is part of a write flow, open it inside `mutation.create()` just like `prompts.dialog`.

### Calendar and DateContext

`Calendar` is timezone-aware when passed `dateConfig`. It uses stdlib calendar helpers for day keys, month grids, week/day ranges, all-day rows, timed events, and date navigation. Source: `packages/cloud/src/ui/misc/Calendar.tsx`; Spaces passes the request config through `packages/spaces/src/frontend/[id]/page.tsx` and `SpacesWorkspace`.

```tsx
import { Calendar } from "@valentinkolb/cloud/ui";

<Calendar
  view={view()}
  date={date()}
  events={events()}
  dateConfig={props.dateConfig}
  onViewChange={setView}
  onDateChange={setDate}
/>
```

Rule of thumb: route state stores stable date keys (`YYYY-MM-DD`) and persisted event instants are UTC. Calendar rendering, range loading, drag/drop, and datetime inputs all receive the same `dateConfig`; app code persists the resulting UTC values through its mutation layer.

#### Settings dialog recipe

When opening settings from an island, use a bare prompt dialog. `SettingsModal` supplies the header, tabs, and close button; the prompt supplies only the overlay/portal. For access callbacks, do not import `GrantableLevel` from contracts: it is local to `PermissionEditor.tsx`. Prefer inference, or type grantable permissions as `Exclude<PermissionLevel, "none">` with `PermissionLevel` from `@valentinkolb/cloud/contracts`.

```tsx
import { PermissionEditor, SettingsModal, prompts } from "@valentinkolb/cloud/ui";
import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";

type GrantablePermission = Exclude<PermissionLevel, "none">;

type SettingsProps = {
  notebook: { shortId: string; name: string; icon?: string };
  accessEntries: AccessEntry[];
};

export const openNotebookSettings = (props: SettingsProps) =>
  prompts.dialog<void>((close) => <NotebookSettingsBody {...props} close={() => close()} />, {
    surface: "bare",
    header: false,
    size: "large",
  });

function NotebookSettingsBody(props: SettingsProps & { close: () => void }) {
  return (
    <div class="flex h-[86vh] min-h-0 flex-col overflow-hidden">
      <SettingsModal title="Notebook settings" subtitle={props.notebook.name} icon={props.notebook.icon ?? "ti ti-notebook"} onClose={props.close}>
        <SettingsModal.Tab id="general" title="General" icon="ti ti-settings">
          ...
        </SettingsModal.Tab>
        <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield">
          <PermissionEditor
            initialEntries={props.accessEntries}
            allowPublic
            grantAccess={async (principal: Principal, permission: GrantablePermission): Promise<AccessEntry> => {
              const res = await apiClient[":id"].access.$post({
                param: { id: props.notebook.shortId },
                json: { principal, permission },
              });
              if (!res.ok) throw new Error("Failed to grant access.");
              return await res.json();
            }}
            updateAccess={async (accessId, permission) => {
              const res = await apiClient[":id"].access[":accessId"].$patch({
                param: { id: props.notebook.shortId, accessId },
                json: { permission },
              });
              if (!res.ok) throw new Error("Failed to update access.");
            }}
            revokeAccess={async (accessId) => {
              const res = await apiClient[":id"].access[":accessId"].$delete({
                param: { id: props.notebook.shortId, accessId },
              });
              if (!res.ok) throw new Error("Failed to revoke access.");
            }}
          />
        </SettingsModal.Tab>
        <SettingsModal.Tab id="danger" title="Danger" icon="ti ti-alert-triangle" tone="danger">
          ...
        </SettingsModal.Tab>
      </SettingsModal>
    </div>
  );
}
```

If a settings tab contains a submit button or a write action, wrap that write in `mutation.create()` inside the tab component. Use `onSuccess` for local state/refresh/toast and `onError` for `prompts.error`:

```tsx
import { prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";

const saveSettings = mutations.create<Notebook, void>({
  mutation: async () => {
    if (!name().trim()) throw new Error("Name is required");
    const res = await apiClient[":id"].$patch({
      param: { id: props.notebook.shortId },
      json: { name: name().trim(), icon: icon() || null },
    });
    if (!res.ok) throw new Error("Failed to save notebook settings.");
    return await res.json();
  },
  onSuccess: (next) => {
    setNotebook(next);
    toast.success("Notebook settings saved");
  },
  onError: (err) => prompts.error(err.message),
});
```

### CodeDisplay and CheckboxCard

`CodeDisplay` is the shared read-only code block. Source: `packages/cloud/src/ui/misc/CodeDisplay.tsx`.

```tsx
<CodeDisplay title="Widget response" language="ts" code={source} copy lineNumbers />
```

Props: `code`, `language?`, `title?`, `copy?`, `lineNumbers?`, `class?`.

`CheckboxCard` is for checkbox options that need a title, description, icon, or color dot. Source: `packages/cloud/src/ui/input/CheckboxCard.tsx`.

```tsx
<CheckboxCard
  label="Notify assignee"
  description="Send an email when this status is selected."
  icon="ti ti-bell"
  value={() => notifyAssignee()}
  onChange={setNotifyAssignee}
/>
```

### CopyButton

```jsx
import { CopyButton } from "@valentinkolb/cloud/ui";

<CopyButton text={item.id} label="Copy ID" />
```

**Props:** `text`, `label?`, `class?`

### StructuredDataPreview

Use `StructuredDataPreview` for small JSON-like app data such as metadata,
event payloads, labels, dimensions, and settings snapshots. It renders readable
key-value rows by default, lets the user switch to raw JSON, and includes copy
support.

```jsx
import { StructuredDataPreview } from "@valentinkolb/cloud/ui";

<StructuredDataPreview title="Metadata" data={entry.metadata} empty="No metadata." />
```

**Props:** `title?`, `data`, `defaultMode?`, `copy?`, `empty?`, `maxRows?`, `class?`

Prefer this over local `<pre>{JSON.stringify(...)}</pre>` blocks in detail panels
and logs. Keep large tabular data in `DataTable`.

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
<button class="icon-btn" aria-label="Settings"><i class="ti ti-settings" /></button>

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
<span class="badge">Badge</span>
<span class="chip">Chip</span>
<span class="tag">Tag</span>
<span class="thumbnail"><i class="ti ti-file" /></span>
```

Button utilities come from `packages/cloud/src/styles/utilities-buttons.css`: `btn-base`, `btn-sm`, `btn-md`, `btn-simple`, `btn-primary`, `btn-secondary`, `btn-success`, `btn-danger`, `btn-input`, `btn-input-sm`, `btn-input-md`, `btn-input-active`, `btn-input-primary`, `btn-input-success`, `input`, and `icon-btn`.

Surface/feedback utilities come from `packages/cloud/src/styles/utilities-layout.css` and `packages/cloud/src/styles/utilities-feedback.css`: `paper`, `dialog-panel`, `paper-highlighted`, `app-cols`, `app-rows`, `info-block`, `info-block-note`, `info-block-info`, `info-block-success`, `info-block-warning`, `info-block-danger`, `status-dot`, `badge`, `chip`, `thumbnail`, `popup`, and `tag`.

Navigation utilities are owned by `packages/cloud/src/styles/utilities-navigation.css`. Prefer `AppWorkspace` for app shells, but if you need lower-level composition the available classes include `sidebar-shell`, `sidebar-header`, `sidebar-mobile`, `sidebar-desktop`, `sidebar-section`, `sidebar-item`, `sidebar-icon-grid`, `sidebar-icon-action`, `rail`, and `rail-item`.

### Detail panels (read view)

Info-dense detail surfaces (right side of a list/detail layout, non-modal)
use the `detail-*` utility family. The pattern is **flow of per-section
paper cards** on a page-bg canvas — never nested papers, never the
old `paper`-around-`divide-y` stat-card pattern.

Live reference: `packages/contacts/src/frontend/_components/ContactDetailPanel.island.tsx`.

```html
<div class="detail-stack">

  <section class="detail-section">
    <!-- Header section: title + chips + close. No detail-section-label here. -->
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <h2 class="text-lg font-semibold leading-tight text-primary">…name…</h2>
        <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span class="…book chip…">…</span>
        </div>
      </div>
      <button class="btn-simple btn-sm">…close icon…</button>
    </div>
  </section>

  <section class="detail-section">
    <h3 class="detail-section-label">Reach</h3>
    <a href="mailto:…" class="detail-row hover:text-blue-500">
      <i class="ti ti-mail detail-row-icon text-blue-500 dark:text-blue-400" />
      <span class="detail-row-label">work</span>
      <span class="break-all">foo@example.com</span>
    </a>
    <!-- repeat per row -->
  </section>

  <section class="detail-section">
    <h3 class="detail-section-label">Work</h3>
    <dl class="detail-facts">
      <dt class="detail-fact-key">Company</dt>
      <dd>Acme GmbH</dd>
      <dt class="detail-fact-key">VAT ID</dt>
      <dd class="font-mono break-all">DE123456789</dd>
    </dl>
  </section>

</div>
```

| Class | Purpose |
|---|---|
| `detail-stack` | Scrolling detail-panel stack. Owns `flex h-full min-h-0 flex-1 flex-col gap-2 overflow-y-auto`; use it as the parent for section cards. |
| `detail-section` | Section card. Auto-applies `paper p-4`. The first content child sitting flush below the label gets `pt-0 mt-0` so the gap to the label is exactly the label's `mb-3`, regardless of which content type follows. |
| `detail-section-compact` | Compact section card for headers/tool surfaces that intentionally need `paper p-3`. Use sparingly and explicitly. |
| `detail-section-label` | Section heading: `mb-3 text-xs font-semibold uppercase tracking-wider text-secondary`. Use for "REACH", "WORK", "PERSONAL", … |
| `detail-row` | Single-line row for emails / phones / websites / simple facts. Layout: leading icon column + optional small label slot + value. Composes with `detail-row-icon` and `detail-row-label`. |
| `detail-row-icon` | Fixed-width icon slot for `detail-row` (keeps values aligned). Add a color utility (`text-blue-500`, `text-amber-500`, …) to colorize per data type. |
| `detail-row-label` | Optional small label between icon and value, e.g. "work", "private". Truncates if overlong. |
| `detail-facts` | Compact key/value grid for facts without per-row icons (e.g. PERSONAL group). Children pair up: `detail-fact-key`, then value. |
| `detail-fact-key` | Dimmed key in `detail-facts`. |

**Rules:**
- Outer panel container has **no** `paper` — just structural classes (flex,
  height, scroll). The page bg becomes the canvas, sections are the cards.
- Empty sections must not render (`<Show when={hasReach()}>`). Sparse records
  show fewer cards, never empty shells.
- The panel's wrapper provides no horizontal padding; sections fill the panel
  edge-to-edge.

### Editor / form panels (write view)

Editors that live **inside a modal** flip the rule: the modal frame IS the
single surface, so sections inside are FLAT — `detail-section-label` for the
heading, generous `mt-8` between sections, no inner papers. Live reference:
`packages/contacts/src/frontend/_components/ContactUpsertForm.island.tsx`.

For paired side-by-side `TextInput` fields, **either both have a `description`
or neither** — mismatched description heights create vertical asymmetry that
reads as a layout bug. Use `<div class="md:col-span-2">` to push a field with
a long description onto its own row.

### Data Tables

Use `DataTable` instead of hand-writing `<table>` markup for tabular rows and
dataviews. Source: `packages/cloud/src/ui/misc/DataTable.tsx`. Live UI Lab
route: `/app/ui-lab/content/table`. Real usages include
`packages/gateway-ops/src/observability/logs/_components/LogTable.island.tsx`,
`packages/gateway-ops/src/frontend/page.tsx`, `packages/oauth/src/frontend/page.tsx`,
and `packages/spaces/src/frontend/admin.tsx`.

```tsx
import { DataTable, type DataTableColumn } from "@valentinkolb/cloud/ui";

type Row = { id: string; name: string; status: "new" | "done"; total: number };

const columns: DataTableColumn<Row>[] = [
  { id: "name", header: "Name", value: "name" },
  { id: "status", header: "Status", value: "status" },
  { id: "total", header: "Total", value: "total", cellClass: "tabular-nums" },
];

<DataTable
  rows={rows}
  columns={columns}
  getRowId={(row) => row.id}
  selectedRowId={selectedId()}
  onRowClick={(row) => setSelectedId(row.id)}
  renderCell={({ row, col, value, render }) =>
    col.id === "status" ? <StatusBadge value={row.status} /> : render(value)
  }
/>;
```

Core props: `rows`, `columns`, `getRowId?`, `selectedRowId?`, `rowClass?`,
`hoverRows?`, `onRowClick?`, `renderCell?`, `renderHeader?`, `footer?`,
`hasMore?`, `loadingMore?`, `onLoadMore?`, `empty?`, `density?`,
`stickyHeader?`, `cellContentClass?`, `fillHeight?`, `class?`, `tableClass?`.

`DataTable` owns sticky headers, row hover/keyboard activation when
`onRowClick` is present, selected-row styling, empty state, footer rows,
density, custom cell/header renderers, and an intersection-observer load-more
sentinel. Keep app code focused on columns, row IDs, and domain-specific cell
rendering.

### Stats

Use `StatGrid` and `StatCell` instead of hand-writing stat grids. Sources: `packages/cloud/src/ui/misc/StatGrid.tsx` and `packages/cloud/src/ui/misc/StatCell.tsx`. Live UI Lab route: `/app/ui-lab/surfaces/stats`.

```tsx
import { StatCell, StatGrid } from "@valentinkolb/cloud/ui";

<StatGrid title="Overview" columns={4} action={<button class="btn-simple btn-sm">Refresh</button>}>
  <StatCell label="Accounts" value="273" sub="272 IPA · 1 local" accent={{ tone: "blue", icon: "ti ti-users" }} />
  <StatCell label="Requests" value="0" sub="none pending" />
  <StatCell label="Expiring 30d" value="8" sub="needs review" accent={{ tone: "amber", icon: "ti ti-alert-triangle", text: "soon" }} />
  <StatCell label="Health" value="100%" sub="all checks" accent={{ tone: "emerald", icon: "ti ti-check", text: "ok" }} />
</StatGrid>
```

`StatGrid` props: `children`, `title?`, `action?`, `columns?: 1 | 2 | 3 | 4 | 5 | 6`, `class?`. The implementation maps columns to literal Tailwind grid classes and owns the `paper`, `gap-px`, and divider-background layout.

`StatCell` props: `label`, `value`, `sub?`, `valueClass?`, `accent?`, `href?`, `title?`, `trend?: number[]`. Accent tones are `emerald`, `amber`, `red`, `blue`, and `zinc`; an accent may be icon-only or `{ tone, icon, text, href? }`.

For account-app style dashboards, compose a wide custom left panel beside a `StatGrid` rather than forcing progress rows into stat cells:

```tsx
<div class="paper overflow-hidden">
  <div class="grid lg:grid-cols-[1.35fr_2fr]">
    <section class="p-6">
      <h3 class="section-label">Run health</h3>
      {/* progress rows or richer custom content */}
    </section>
    <StatGrid columns={2} class="rounded-none border-0">
      <StatCell label="Accounts" value="273" sub="272 IPA · 1 local" />
      <StatCell label="Groups" value="176" sub="176 IPA · 0 local" />
      <StatCell label="Requests" value="0" sub="none pending" />
      <StatCell label="Expiring 30d" value="0" sub="none soon" />
    </StatGrid>
  </div>
</div>
```

Do not reintroduce the old raw-grid `p-px` stat pattern in app code. The shared components now own the cell backgrounds, dividers, optional header, and metric typography.

**Anti-patterns — do not do**:

- Rainbow icon backgrounds (`bg-blue-100`, `bg-rose-100`, etc. for each icon).
  The codebase is zinc-based with single accent colors. Multi-color icon rows
  read as Material/Google and clash with the rest of the UI.
- Putting progress bars, status lists, or icon grids inside a stat-cell —
  use a plain `.paper` panel for those, side by side with the stats.
- Centered cell content (`items-center justify-center`). Stat cells are
  left-aligned; centering looks unbalanced when label / value / sub widths
  differ.

### Dashboard Widgets

Dashboard widgets are controlled by the app's widget API endpoint response, not by end-users editing the widget component directly. Sources: `packages/cloud/src/contracts/widgets.ts`, `packages/cloud/src/ui/widgets/Widget.tsx`, and the UI Lab route `/app/ui-lab/surfaces/widgets`.

Register widget endpoints in `defineApp()`:

```ts
export const app = defineApp({
  id: "my-app",
  widgets: [{ id: "overview", path: "/api/my-app/widget/overview" }],
  // ...
});
```

Return a `WidgetResponse` from the endpoint. The dashboard forwards the user's
cookie when fetching the endpoint; return `204` when the current user should not
see the widget.

```ts
import { Hono } from "hono";
import type { AppContext } from "@valentinkolb/cloud/server";
import type { WidgetResponse } from "@valentinkolb/cloud/contracts";
import { app } from "../config";

export const recentNotesWidget = async (): Promise<WidgetResponse> => ({
  title: "Recent notes",
  icon: "ti ti-notebook",
  href: "/app/notebooks",
  meta: "last 24h",
  blocks: [
    {
      kind: "stat",
      label: "Open notes",
      value: 8,
      sub: "2 need review",
      accent: { tone: "amber", icon: "ti ti-clock", text: "queue" },
    },
    {
      kind: "list",
      grow: true,
      items: [
        {
          icon: "ti ti-file-text",
          iconTone: "blue",
          label: "Launch checklist",
          sub: "Product",
          meta: "2m",
          href: "/app/notebooks/a1b2c3/notes/d4e5f6",
        },
      ],
    },
    {
      kind: "hero",
      title: "All caught up",
      subtitle: "No blocked notes",
      icon: "ti ti-circle-check",
      tone: "emerald",
    },
    {
      kind: "status",
      tone: "info",
      title: "Index healthy",
      message: "Search synced 2 minutes ago",
      icon: "ti ti-database-check",
    },
    {
      kind: "pills",
      pills: [
        { label: "open", value: 8, tone: "amber", href: "/app/notebooks?status=open" },
        { label: "done", value: 24, tone: "emerald" },
      ],
    },
  ],
});

const widgets = new Hono<AppContext<typeof app>>().get("/overview", async (c) => {
  if (!canReadWidget(c)) return c.body(null, 204);
  const response = await recentNotesWidget();
  return c.json(response);
});

export default widgets;
```

Supported block kinds:
- `stat`: `label`, `value`, `sub?`, `valueClass?`, `accent?`, `grow?`
- `list`: `items`, `emptyMessage?`, `grow?`
- `status`: `tone: "ok" | "warn" | "error" | "info"`, `title`, `message?`, `icon?`, `grow?`
- `pills`: `pills: { label, value, tone?, href? }[]`, `grow?`
- `hero`: `title`, `subtitle?`, `icon?`, `tone?`

Tone values are `blue`, `emerald`, `amber`, `red`, and `zinc`. Keep widget JSON compact; route users with `href` on the widget or individual list items.

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

The `mutation` module from `@valentinkolb/stdlib/solid`. **All network calls in islands must be inside `mutation.create()`** — never do manual fetch calls outside mutations. Never create manual loading/error signals — `mutation` handles this automatically. Source examples: `packages/notebooks/src/frontend/[id]/_components/settings/NotebookSettingsPanel.island.tsx`, `packages/grids/src/frontend/_components/dashboard/DashboardWysiwygEditor.island.tsx`, and `packages/ipa-hosts/src/frontend/NewHostgroup.island.tsx`.

**The Mutation + Prompts Pattern** — everything goes in the mutation, including the prompt. This is the recommended default for create/update/delete flows: prompt for input, call the API, update local state in `onSuccess`, show a success `toast`, and show blocking failures with `prompts.error` in `onError`.

```typescript
import { mutation } from "@valentinkolb/stdlib/solid";
import { prompts, toast } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";

const readErrorMessage = async (res: Response, fallback: string) => {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? fallback;
};

const createItem = mutation.create<Item | null, void>({
  mutation: async () => {
    // 1. Collect input (inside the mutation — prompts.form can fail too)
    const data = await prompts.form({
      title: "Create Item",
      icon: "ti ti-plus",
      confirmText: "Create",
      fields: {
        title: { type: "text", label: "Title", required: true },
        description: { type: "text", label: "Description", multiline: true },
      },
    });
    if (!data) return null; // user cancelled

    // 2. Make the API call
    const res = await apiClient.items.$post({ json: data });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to create item"));
    return await res.json();
  },
  onSuccess: (created) => {
    if (!created) return; // prompt was cancelled
    setItems((prev) => [created, ...prev]);
    toast.success(`Created "${created.title}"`);
  },
  onError: (err) => prompts.error(err.message),
});

// 3. Wire to button with loading state
<button
  class="btn-primary btn-sm"
  disabled={createItem.loading()}
  onClick={() => createItem.mutate()}
>
  {createItem.loading()
    ? <><i class="ti ti-loader-2 animate-spin" /> Creating...</>
    : <><i class="ti ti-plus" /> Create</>}
</button>

createItem.abort();     // abort in-flight
createItem.error();     // Error | null signal
```

**Destructive action pattern** — the confirm prompt also belongs inside the mutation. Cancel returns a sentinel result; successful deletes use `onSuccess` for local state and toast, errors use `onError` with `prompts.error`.

```typescript
import { mutation } from "@valentinkolb/stdlib/solid";
import { prompts, toast } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";

const deleteItem = mutation.create<{ deleted: boolean; id: string }, Item>({
  mutation: async (item) => {
    const confirmed = await prompts.confirm(`Delete "${item.title}"? This cannot be undone.`, {
      title: "Delete Item",
      icon: "ti ti-trash",
      confirmText: "Delete",
      variant: "danger",
    });
    if (!confirmed) return { deleted: false, id: item.id };

    const res = await apiClient.items[":id"].$delete({ param: { id: item.id } });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to delete item"));
    return { deleted: true, id: item.id };
  },
  onSuccess: (result, item) => {
    if (!result?.deleted) return;
    setItems((prev) => prev.filter((candidate) => candidate.id !== result.id));
    toast.success(`Deleted "${item.title}"`);
  },
  onError: (err) => prompts.error(err.message),
});

<button
  class="btn-danger btn-sm"
  disabled={deleteItem.loading()}
  onClick={() => deleteItem.mutate(item)}
>
  <i class="ti ti-trash" />
</button>
```

**Custom dialog input pattern** — `prompts.dialog()` also goes inside the mutation when the dialog collects input for a write. The dialog component closes with a typed payload; `onSuccess` applies the result and shows the toast.

```tsx
const renameItem = mutation.create<Item | null, Item>({
  mutation: async (item) => {
    const input = await prompts.dialog<{ title: string } | null>(
      (close) => <RenameDialog initialTitle={item.title} close={close} />,
      { title: "Rename item", icon: "ti ti-pencil", size: "medium" },
    );
    if (!input) return null;

    const res = await apiClient.items[":id"].$patch({
      param: { id: item.id },
      json: { title: input.title },
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to rename item"));
    return await res.json();
  },
  onSuccess: (updated) => {
    if (!updated) return;
    setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    toast.success("Item renamed");
  },
  onError: (err) => prompts.error(err.message),
});
```

**Inline save pattern** — when the input already lives on the screen, skip the
prompt but keep the same success/error hooks.

```typescript
const saveSettings = mutation.create<Settings, void>({
  mutation: async () => {
    if (!name().trim()) throw new Error("Name is required");
    const res = await apiClient.settings.$patch({
      json: { name: name().trim(), enabled: enabled() },
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to save settings"));
    return await res.json();
  },
  onSuccess: (next) => {
    setSettings(next);
    toast.success("Settings saved");
  },
  onError: (err) => prompts.error(err.message),
});
```

Do not open `prompts.form`, `prompts.confirm`, or `prompts.dialog` in a separate click handler and then call a mutation with the result unless the prompt belongs to a reusable non-mutating helper. For create/update/delete workflows, putting the prompt inside `mutation.create()` gives one loading state, one abort/error path, and consistent `onSuccess` / `onError` handling.

| Problem | Recommendation |
|---|---|
| User enters data before a write | Call `prompts.form()` or `prompts.dialog()` inside `mutation.mutation`; return `null` or a sentinel on cancel. |
| Write succeeds | Use `onSuccess` for signal updates, `refreshCurrentPath()`/navigation when needed, and `toast.success(...)` for lightweight feedback. |
| Write fails | Throw inside `mutation`; use `onError: (err) => prompts.error(err.message)` for a blocking error modal. |
| Button needs loading state | Use `disabled={mutation.loading()}` and render `ti-loader-2 animate-spin` from the same signal. |
| Optimistic UI needs rollback | Use `onBefore` to store previous state and mutate optimistically; restore in `onError` from that context. See `DashboardWysiwygEditor.island.tsx`. |

## Typed Hono API Client

```typescript
// api/client.ts
import { api } from "@valentinkolb/cloud/browser";
import type { ApiType } from ".";

export const apiClient = api.create<ApiType>({ baseUrl: "/api/my-app" });
```

The base URL must match how routes are mounted: `app.start()` mounts API routes at `/api`, and the app mounts its sub-Hono at `/my-app`, so the full path is `/api/my-app`. Sub-routes inside `apiRoutes` (`/widget/...`, `/admin/...`, root for CRUD) are picked up by the typed client automatically — `apiClient.widget.today.$get()` resolves to `/api/my-app/widget/today`.

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
if (!res.ok) throw new Error(await readErrorMessage(res, "Request failed"));
```

### Raw Fetch Migration Checklist

Use the typed Hono client for app-internal JSON APIs. This is not just a style
rule: the client preserves route response types across the SSR/client boundary,
so frontend code can stop guessing response shapes.

```typescript
const res = await apiClient.items[":id"].$patch({
  param: { id },
  json: { title },
});
if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to save item"));
const saved = await res.json(); // inferred from the route
```

Rules:
- No new `fetch("/api/...")` for app-internal JSON APIs.
- No new `any`.
- No `await res.json() as DomainType` or broad `unknown`-to-domain casts.
- Keep island network calls inside `mutation.create()`.
- Pass query values as strings in the client call; let route validators coerce
  with Zod when the service needs numbers or booleans.

Allowed raw-fetch exceptions:
- External URLs outside the current app.
- WebSocket, EventSource, and SSE transports.
- Blob/File/stream downloads where native `Response.blob()`, response headers,
  or streaming semantics are the contract.
- Binary/chunk upload flows when the Hono client would obscure the body
  contract. Keep these exceptions explicit and local.
- Smoke tests, browser scripts, generated CLI clients, and helper methods named
  `fetch` that are not global HTTP fetch calls.

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

`prompts.dialog` renders the header from `title` and `icon` automatically — the body callback only renders content.

```jsx
const showDetail = async (item: Item) => {
  await prompts.dialog(
    (close) => (
      <div class="p-4 flex flex-col gap-3">
        <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <span class="text-dimmed">ID</span>
          <span class="flex items-center gap-1">{item.id} <CopyButton text={item.id} /></span>
          <span class="text-dimmed">Created</span>
          <span>{formatDate(item.createdAt)}</span>
        </div>
      </div>
    ),
    { title: item.title, icon: "ti ti-file", size: "medium" }
  );
};
```

### Confirmation Before Delete

For destructive yes/no prompts use `prompts.confirm`; when the confirmation leads to an API write, call it inside the mutation body as shown in [Mutation Pattern](#mutation-pattern-detail). That keeps cancel, loading, success toast, and error modal in one lifecycle.

```jsx
const deleteItem = mutation.create<{ deleted: boolean; id: string }, Item>({
  mutation: async (item) => {
    const confirmed = await prompts.confirm(
      "Are you sure? This cannot be undone.",
      { title: "Delete Item", icon: "ti ti-trash", confirmText: "Delete", variant: "danger" },
    );
    if (!confirmed) return { deleted: false, id: item.id };

    const res = await apiClient.items[":id"].$delete({ param: { id: item.id } });
    if (!res.ok) throw new Error("Failed to delete item.");
    return { deleted: true, id: item.id };
  },
  onSuccess: (result) => {
    if (result.deleted) toast.success("Item deleted");
  },
  onError: (err) => prompts.error(err.message),
});
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

## Frontend Interaction Patterns

These patterns are sourced from existing apps. Prefer them when building new
cloud app frontends; do not invent local navigation/event helpers unless the
app has a narrower, well-proven need.

Decision guide:

| Situation | Use |
| --- | --- |
| One island owns the state | Solid signals/store inside that island |
| Parent coordinates a child | Props and callbacks |
| Selection/filter must survive reload, sharing, or browser back/forward | URL params |
| Independent mounted islands need client sync | Typed `CustomEvent`; pair with `popstate` when URL-backed |
| Normal page, route, or query change | `navigateTo()` full document navigation |
| Mutation where the server owns the refreshed view | `refreshCurrentPath()` |
| AppWorkspace sidebar target needs SSR data | `navigation="document"` |
| AppWorkspace sidebar target can be resolved by the current island | `onNavigate` + `nav.push()` / `nav.replaceWith()` |
| Same mounted workspace can replace its main entity without SSR correctness loss | Soft navigation request with hard navigation fallback |

### SSR Navigation & URL State

Filters, pagination, selected detail items, and most app navigation live in URL
params. This keeps pages SSR-friendly: the server can render the selected state,
and islands only initiate browser navigation.

Source:

- `packages/cloud/src/ui/navigation.ts`
- `packages/spaces/src/frontend/[id]/_components/filter/FilterBar.tsx`
- `packages/spaces/src/frontend/[id]/_components/workspace/SpacesWorkspace.island.tsx`
- `packages/cloud/src/ssr/islands/SearchBar.island.tsx`

**In SSR pages** — read directly from the Hono request URL:

```typescript
const url = new URL(c.req.raw.url);
const search = url.searchParams.get("search") ?? "";
const page = Number(url.searchParams.get("page") ?? 1);
```

**In islands** — import the shared navigation helpers from `@valentinkolb/cloud/ui`:

```typescript
import { currentPathWithQuery, navigateTo, refreshCurrentPath } from "@valentinkolb/cloud/ui";

navigateTo("/app/my-app/123");   // full document navigation, adds history entry
refreshCurrentPath();             // window.location.assign(currentPathWithQuery()) — full SSR re-render
```

`refreshCurrentPath` performs a full reload via `window.location.assign`. It
does not patch the DOM in place or preserve scroll position; the SSR pass
re-runs from scratch. Use it after mutations where the server owns the updated
view. Use `navigateTo(href)` when the next page or query state is known.

**For search/filter bars** — use `SearchBar` from `@valentinkolb/cloud/ssr/islands`:

```typescript
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";

// Reads the initial value from the URL; submit/clear updates the URL and navigates.
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

For AppWorkspace screens with enhanced client navigation, keep the actual
navigation commit in the workspace island, not inside every filter/search
control. The filter controls stay visual and callback-driven; the parent owns
URL construction, route-state loading, `replace` vs `push`, scroll mode, and
fallback behavior.

```tsx
const commitFilterPatch = (patch: Partial<FilterState>) => {
  const href = buildFilterUrl(currentListBaseUrl(), { ...patch, page: 1 }, filter());
  void openRoute(href, { replace: true, scroll: "preserve" });
};

<FilterBar
  filter={filter()}
  baseUrl={currentListBaseUrl()}
  onFilterChange={commitFilterPatch}
  onSearchChange={(search) => commitFilterPatch({ search })}
  onClearFilters={() => openRoute(buildFilterUrl(currentListBaseUrl(), defaultFilter, defaultFilter), {
    replace: true,
    scroll: "preserve",
  })}
/>
```

Search inputs must keep focus while typing. Keep the visible input value local
inside the search component, debounce the parent commit, and do not key/remount
the search component on every route-state update. The parent may refresh SSR
derived state after the debounce, but the input component should remain mounted
and visually identical. Use a short debounce for app-local filtering; `200ms`
is the preferred default for enhanced route-state search. If the route commit
is async, show a subtle trailing spinner in the input via `TextInput`'s
`suffix` slot while the debounce/request is pending.

Filter chips should commit on click, not on dropdown close. This keeps
multi-select filters, sort chips, and group chips aligned with the immediately
visible URL state. Use `replace` for these filter updates so typing and chip
toggling do not flood browser history.

Calendar filters that should survive reload/share/back-forward, such as Spaces
calendar tags, also belong in route state. Keep ephemeral modal state local, but
put visible calendar scope filters in query params and resolve the filtered
calendar item set in the route-state loader.

Recommended rule: filter/search/sort/group changes use `replace`, reset `page`
to `1`, usually clear selected detail IDs if the result set can change, and use
`scroll="preserve"` for list containers. Pagination changes only the page param
and may use `push` when browser back should step through pages. Mutation success
either updates local state or calls `refreshCurrentPath()`/the workspace route
refresh helper.

### Enhanced Link Navigation

`packages/cloud/src/ui/navigation.ts` exposes a small enhanced navigation layer:
`navigate`, `documentNavigate`, `captureScroll`, `restoreScroll`, and
`startViewTransition`. `packages/cloud/src/ui/NavigationLink.tsx` exposes
`Link`. These helpers are browser-side only and are re-exported from
`@valentinkolb/cloud/ui`.

Enhanced navigation preserves real anchor behavior: modifier clicks, new tabs,
downloads, and external links fall back to normal browser navigation. For normal
SSR route changes, use `navigateTo(...)` or `navigation="document"` on
`AppWorkspace.SidebarItem`.

```tsx
import { Link } from "@valentinkolb/cloud/ui";

<Link
  href="/app/my-app/items/beta"
  scroll="top"
  onNavigate={(nav) => {
    const next = resolveItem(nav.href);
    if (!next) return nav.fallback();

    setSelectedItem(next);
    nav.push();
  }}
>
  Open beta
</Link>
```

Scroll modes:

- `scroll="top"` moves window scroll to top but restores keyed
  `[data-scroll-preserve]` regions.
- `scroll="preserve"` restores window scroll and keyed regions.
- `scroll="manual"` leaves all scroll handling to the app; use
  `nav.captureScroll()` and `nav.restoreScroll(...)` when needed.

Preferred pattern: mark the actual scrollable region with a stable
`data-scroll-preserve` key, then let `captureScroll()` collect and restore it
automatically during enhanced navigation. In AppWorkspace sidebars, use
`scrollPreserveKey` on `SidebarBody` or `SidebarMobileBody`; use the raw data
attribute for lower-level custom containers.

```tsx
<AppWorkspace.SidebarBody scrollPreserveKey="notebook-sidebar">
  ...
</AppWorkspace.SidebarBody>

<div data-scroll-preserve="records-list" class="overflow-y-auto">
  ...
</div>
```

Enhanced navigation runs inside `document.startViewTransition(...)` when the
browser supports it. Use `view-transition-name` on stable elements and
`viewTransitionName` props on `AppWorkspace` pieces to make transitions smooth.

#### SSR-first AppWorkspace enhanced navigation

For AppWorkspace routes where the sidebar and main area must change together,
prefer a route-owning island with server-computed route data:

1. Keep the SSR page as the canonical reload/share path. It reads the URL and
   renders the initial workspace state.
2. Extract the same server-side route-state loader into a shared function.
   Reuse existing service, permission, query-merge, and data-loading helpers.
3. Expose a small typed route-data endpoint for enhanced navigation. The
   endpoint parses and validates the target href, then returns the same state
   shape SSR would have rendered.
4. Put the sidebar and main route switch in one mounted workspace island. The
   island owns the current route state and can replace it after enhanced
   navigation.
5. In `onNavigate`, keep the real `href`, fetch route state, verify the target
   is fully handleable, set the visible state, then call `nav.push()` or
   `nav.replaceWith()`. Call `nav.fallback()` for anything outside that
   workspace.
6. If the route state changes the Cloud header breadcrumbs, publish the same
   server-computed breadcrumb array through `layout.update(...)`. This keeps
   the outer SSR `Layout` chrome in sync without wrapping `@valentinkolb/ssr/nav`
   or inventing a client router.

```tsx
import { layout } from "@valentinkolb/cloud/ui";

<AppWorkspace.SidebarItem
  href={`/app/my-app/${workspaceId}/items/${itemId}`}
  scroll="top"
  onNavigate={async (nav) => {
    const target = parseWorkspaceHref(nav.url);
    if (!target) return nav.fallback();

    const res = await apiClient.workspace.route.$get({
      query: { href: `${nav.url.pathname}${nav.url.search}` },
    });
    if (!res.ok) return nav.fallback();

    const next = await res.json();
    if (next.kind !== "ok") return nav.fallback();

    setWorkspaceState(next);
    layout.update({
      breadcrumbs: next.title,
      title: next.title.at(-1)?.title,
    });
    nav.push();
  }}
>
  Item
</AppWorkspace.SidebarItem>
```

`layout.update(...)` is only for progressive enhancement. The SSR page must
still pass the same breadcrumbs to `<Layout title={...}>` for reloads, sharing,
back/forward restoration after a hard load, and no-JavaScript fallback.
Route-data endpoints should return a `title`/breadcrumb array when the enhanced
route can change the header. Source: `packages/cloud/src/ui/layout.ts` and
`packages/cloud/src/ssr/LayoutBreadcrumbs.island.tsx`.

Do not duplicate permission checks, active-entity resolution, saved-view query
merging, widget resolution, or other SSR data logic in the browser. The client
may validate the URL shape, but the server remains the source of truth for the
route state.

Keep links outside the current workspace context on document navigation. For
example, a base workspace can enhance table/view/dashboard/settings links inside
that base, but an "All items" app overview route may need `navigation="document"`
because the mounted workspace island cannot represent that page.

Browser smoke checks for this pattern should prove:

- the click changes the URL and the visible state;
- a reload or shared URL still SSR-renders the same state;
- enhanced clicks do not create a new document navigation;
- keyed sidebar/list scroll survives via `scrollPreserveKey` or
  `data-scroll-preserve`;
- modifier clicks and new-tab behavior still use the normal anchor semantics.

### URL-Backed Detail Panels

For list/detail layouts, keep the selected entity in the URL and use a window
event only to synchronize already-mounted islands. This pattern appears in
contacts, files, and spaces. Spaces wraps the shared `detailPanel` helper from
`@valentinkolb/stdlib/solid`.

Source:

- `packages/spaces/src/frontend/lib/detail.ts`
- `packages/contacts/src/frontend/_components/context.ts`
- `packages/spaces/src/frontend/[id]/_components/detail/SpaceDetailLayoutSync.island.tsx`
- `packages/spaces/src/frontend/[id]/_components/kanban/KanbanBoard.island.tsx`

```typescript
import { detailPanel, type DetailSelectPayload } from "@valentinkolb/stdlib/solid";

export const ITEM_DETAIL_PARAM = "item";
export const ITEM_SELECT_EVENT = "my-app:item-select";

export const getSelectedItemFromUrl = () => detailPanel.getUrlParam(ITEM_DETAIL_PARAM);

export const selectItemInUrl = (itemId: string | null, item: Item | null = null) =>
  detailPanel.select(ITEM_DETAIL_PARAM, ITEM_SELECT_EVENT, item, itemId);

export const shouldHandleDetailClick = detailPanel.shouldHandleClick;

export const subscribeToItemSelection = (onChange: (change: {
  itemId: string | null;
  item: Item | null;
  source: "event" | "popstate";
}) => void) => {
  const onSelect = (event: Event) => {
    const payload = (event as CustomEvent<DetailSelectPayload<Item>>).detail;
    onChange({ itemId: payload.itemKey ?? null, item: payload.item ?? null, source: "event" });
  };

  const onPopState = () => {
    onChange({ itemId: getSelectedItemFromUrl(), item: null, source: "popstate" });
  };

  window.addEventListener(ITEM_SELECT_EVENT, onSelect);
  window.addEventListener("popstate", onPopState);

  return () => {
    window.removeEventListener(ITEM_SELECT_EVENT, onSelect);
    window.removeEventListener("popstate", onPopState);
  };
};
```

Use this when the selected detail should survive reloads, be linkable, and work
with browser back/forward. Do not use a purely local signal for canonical
selection state in SSR list/detail pages. Event payloads are ephemeral: listeners
must tolerate `item: null`, and reload/popstate flows must rehydrate from the
URL, server render, or API instead of relying on an object previously dispatched
through `CustomEvent`.

Decision rule: use hard SSR navigation when selecting an item requires
server-rendered detail data. Use `detailPanel.select(...)` when the list island
already has enough detail data or an already-mounted detail island can resolve
the URL-backed selection safely.

Render detail entries as real anchors with `href`. Intercept only eligible plain
left-clicks, then call `preventDefault()` and update the URL-backed detail state;
modifier clicks, new-tab behavior, and browser link affordances must keep
working.

```tsx
<a
  href={buildItemUrl(item.id)}
  onClick={(event) => {
    if (!shouldHandleDetailClick(event)) return;
    event.preventDefault();
    selectItemInUrl(item.id, item);
  }}
>
  {item.title}
</a>
```

### Typed Window Events

Use window `CustomEvent`s for loose coupling between islands that cannot share
Solid state directly. Keep event names and payload types in a plain `.ts` module
so server components and islands can import constants without pulling browser
code into SSR.

Source:

- `packages/notebooks/src/frontend/[id]/_components/detail/events.ts`
- `packages/notebooks/src/frontend/[id]/_components/detail/NotebookDetailPanel.island.tsx`
- `packages/notebooks/src/frontend/[id]/_components/editor/NoteEditor.client.tsx`

```typescript
// frontend/lib/events.ts
export const DETAIL_TOGGLE_EVENT = "my-app:detail-toggle";
export const DETAIL_STATE_EVENT = "my-app:detail-state";

export type DetailStateEvent = {
  isOpen: boolean;
};
```

```tsx
import { onCleanup, onMount } from "solid-js";
import { DETAIL_STATE_EVENT, DETAIL_TOGGLE_EVENT, type DetailStateEvent } from "../lib/events";

onMount(() => {
  const onState = (event: Event) => {
    const detail = (event as CustomEvent<DetailStateEvent>).detail;
    setOpen(Boolean(detail?.isOpen));
  };

  window.addEventListener(DETAIL_STATE_EVENT, onState);
  onCleanup(() => window.removeEventListener(DETAIL_STATE_EVENT, onState));
});

const toggle = () => window.dispatchEvent(new CustomEvent(DETAIL_TOGGLE_EVENT));
```

Rules:

- Define event constants once; do not inline string literals across components.
- Type the `CustomEvent` payload at the listener boundary.
- Register browser listeners in `onMount` and remove them in `onCleanup`.
- Pair custom events with `popstate` when the URL is also part of the state.
- Do not use window events for parent-child communication, single-island state,
  form state, mutation lifecycle, or as a replacement for props/signals inside
  one island.

### Soft Navigation Request Pattern

Use a soft-navigation request when a mounted island can handle an in-app route
change without a full SSR reload, but the app still needs a safe fallback. The
notebooks editor uses this for note-to-note navigation.

Source:

- `packages/notebooks/src/frontend/lib/soft-navigation.ts`
- `packages/notebooks/src/frontend/[id]/_components/editor/NoteEditor.client.tsx`
- `packages/notebooks/src/frontend/[id]/_components/sidebar/NoteTree.island.tsx`

```typescript
import { navigateTo } from "@valentinkolb/cloud/ui";

export const SOFT_NAV_REQUEST_EVENT = "my-app:soft-nav-request";

type SoftNavigationRequestDetail = {
  href: string;
  handled?: Promise<boolean>;
};

export const requestSoftNavigation = async (href: string): Promise<boolean> => {
  const detail: SoftNavigationRequestDetail = { href };
  window.dispatchEvent(new CustomEvent(SOFT_NAV_REQUEST_EVENT, { detail }));
  return (await detail.handled) ?? false;
};

export const navigateToItem = async (href: string) => {
  if (await requestSoftNavigation(href)) return;
  navigateTo(href);
};

export const handleSoftNavigationRequests = (handler: (href: string) => Promise<boolean>) => {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<SoftNavigationRequestDetail>).detail;
    if (!detail?.href) return;
    detail.handled = handler(detail.href);
  };

  window.addEventListener(SOFT_NAV_REQUEST_EVENT, listener);
  return () => window.removeEventListener(SOFT_NAV_REQUEST_EVENT, listener);
};
```

Use this only for an already-mounted workspace that can replace its main entity
without losing correctness. The handler must be able to fetch or already own all
data needed for the target URL, update URL-dependent UI consistently, avoid
leaking stale SSR data, and leave the hard navigation fallback correct. This is
a request/claim protocol for one capable owner, not general pub/sub; handlers
should return `false` when they cannot fully handle the href. For normal page
changes, use `navigateTo()`.

### Registry Bridge Pattern

Use a registry bridge when multiple independently-rendered islands need to
contribute UI to one shared shell location. `LayoutHelp` uses a global tab map
plus a custom event; registering returns a cleanup function.

Source:

- `packages/cloud/src/ssr/LayoutHelp.tsx`

```tsx
import { Layout } from "@valentinkolb/cloud/ssr/islands";

export function MyFeatureHelp() {
  return (
    <Layout.Help id="my-feature" title="My Feature" icon="ti ti-help">
      <p class="text-sm text-dimmed">Feature-specific help.</p>
    </Layout.Help>
  );
}
```

The pattern is useful for shell-level slots such as help, command menus, or
global inspectors. Keep registry state private to the owning shell component;
app code should use the shell's public component API.

### Optimistic Mutation Context

Use `mutation.create` `onBefore` context for optimistic updates, rollback data,
loading keys, and stale-response tokens. The spaces Kanban board captures
previous buckets before moving an item; the grids dashboard editor stores a save
token so older saves cannot overwrite newer UI state.

Source:

- `packages/spaces/src/frontend/[id]/_components/kanban/KanbanBoard.island.tsx`
- `packages/grids/src/frontend/_components/dashboard/DashboardWysiwygEditor.island.tsx`

```typescript
const saveMutation = mutation.create<SavedItem, Item, { previous: Item[]; token: number }>({
  onBefore: (next) => {
    const previous = items();
    const token = ++saveToken;
    setItems(applyOptimisticChange(previous, next));
    return { previous, token };
  },
  mutation: async (next, ctx) => {
    const res = await apiClient.items[":id"].$patch({
      param: { id: next.id },
      json: next,
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to save item."));
    return await res.json();
  },
  onSuccess: (saved, ctx) => {
    if (ctx?.token !== saveToken) return;
    setItems(reconcileSavedItem(items(), saved));
    toast.success("Saved");
  },
  onError: (err, ctx) => {
    if (ctx?.previous) setItems(ctx.previous);
    prompts.error(err.message);
  },
});
```

Use this for drag-and-drop, WYSIWYG configuration, inline edits, and other flows
where waiting for SSR refresh would feel broken. For simple create/delete flows,
prefer the plain mutation pattern above.

## View Transitions

View transitions are enabled globally via `<meta name="view-transition" content="same-origin">` in the HTML template. **Always add `view-transition-name` to elements that should animate between pages.** This is not optional — use it on cards, headers, sidebars, tables, and any element that persists across page navigations.

Source:

- `packages/cloud/src/_internal/define-app.ts`
- `packages/cloud/src/config/ssr.ts`
- `packages/cloud/src/ui/misc/AppWorkspace.tsx`
- `packages/notebooks/src/frontend/[id]/_components/sidebar/NotebookSidebar.island.tsx`

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
