# Data Table View Pattern

Canonical example: `cloud/packages/apps/src/logging/frontend/`

Use this for admin tables, review queues, histories, list/detail screens, and other data-heavy pages where scanning matters more than decorative layout.

## Goal

Build pages that feel:

- compact
- full-width
- immediately scannable
- filterable without UI clutter
- detailed on demand, not all at once

This is not a rigid template. It is the default grammar for dense data pages in this repo.

## Page Structure

```
SSR page (page.tsx)
├── fetches data + pagination + filter state
├── renders FilterBar island (search + filters + actions)
├── renders Table island (rows + row detail interaction)
└── renders Pagination component
```

- SSR page owns data loading, filter parsing, pagination, and action availability.
- Prefer `fullHeight` on `AdminLayout` for true admin work pages.
- Use a single vertical stack for the content area, usually `flex flex-col gap-2` or `gap-3`.
- Do not add extra centered width wrappers unless the page is form-heavy rather than table-heavy.
- Default page size for dense admin tables: **100**.

## FilterBar Island

Preferred shape: one island, two rows. Keep search/filter/action behavior in one place instead of splitting every button into its own island.

```
Row 1: [SearchBar ─────────────────────────────]
Row 2: [Filters...] [Clear?] [Count] ───────────── [Actions...]
```

### Rules

- `SearchBar` always gets its own full-width row.
- Filter chips, entry count, and action buttons share the second row with `flex items-center gap-2 flex-wrap`.
- Action buttons use `ml-auto` to push right.
- Entry count should be visually quiet: small, dimmed, tabular numbers.
- Action button text should usually hide on mobile via `hidden sm:inline`.
- Use compact shared button styles like `btn-input btn-sm` for row-level toolbar actions.
- Mutations such as settings, cleanup, backfill, export, or bulk tools can live here via `mutation.create`.
- Avoid extra section headers above the filter bar if the page title already provides context.
- If there are no actions, keep only search + filters + count. Do not add placeholder wrappers.

### Example

```tsx
<div class="flex flex-col gap-2">
  <SearchBar action={searchAction} value={filter.search} placeholder="Search..." />
  <div class="flex items-center gap-2 flex-wrap">
    <FilterChip label="Status" ... />
    <FilterChip label="Source" ... />
    {hasFilters && <a href={baseUrl} class="text-[10px] text-red-500">Clear</a>}
    <span class="text-[10px] text-dimmed tabular-nums hidden sm:inline">{total} entries</span>
    <div class="ml-auto flex items-center gap-2 shrink-0">
      <button class="btn-input btn-sm" onClick={handleAction}>
        <i class="ti ti-settings" />
        <span class="hidden sm:inline">Action</span>
      </button>
    </div>
  </div>
</div>
```

## Table Island

One island should usually render the whole table and own row-click interaction.

If the page is simple and fully SSR, a dedicated table island is optional. Prefer the island once rows open dialogs, mutate, or coordinate local view state.

### Layout

```
paper overflow-hidden
└── overflow-x-auto
    └── table w-full text-xs
        ├── thead (border-b border-zinc-100)
        │   └── th: all text-left, font-medium text-dimmed
        └── tbody
            └── tr per entry (hover row, optional click → detail dialog/panel)
```

### Row Rules

- `text-xs` globally on the table. Row padding: `px-3 py-1.5`.
- **Single-line first** — rows should optimize for scanning, not rich reading.
- Use `truncate max-w-[30rem]` on text columns that could overflow.
- Put the most identifying content early: status/icon, entity/source, primary message/title, time.
- Lower-priority detail columns should hide responsively with `hidden xl:table-cell` or similar.
- Clickable rows use `cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/30`.
- If rows are not clickable, keep the hover treatment subtle and do not fake click affordance.
- Responsive columns: use `hidden xl:table-cell` for columns only visible on wide screens.

## Full-Width Admin Layout Rules

- Let the table own the page width.
- Prefer one `paper overflow-hidden` surface around the table, not multiple nested cards.
- Use vertical rhythm (`gap-2`, `gap-3`, top/bottom padding) instead of adding decorative containers between toolbar, table, and pagination.
- Keep pagination visually attached to the table block, usually directly below it.
- On admin pages, the content should feel like a working area, not a centered marketing card.

## Cell Content Rules

### Status / Type / Level Cells

Use icon + text label, colored by status:

```tsx
<span class={`inline-flex items-center gap-1.5 ${level.color}`}>
  <i class={`${level.icon} text-sm`} />
  <span>{level.label}</span>
</span>
```

### Main Text Cells

- Keep them one line in the table.
- Use `title={value}` when truncation would otherwise hide important information.
- Avoid stacked subtitle lines inside rows unless the page is intentionally looser than the admin-table pattern.

### Structured Data Columns

If a row has structured detail, show only a compact inline summary in the table.

Rules:
1. Parse first. Structured payloads may arrive as JSON strings.
2. Inline format should be summary-first, such as `key=value, key2=value2`.
3. Never dump full JSON into a table cell.
4. Hide low-priority structured columns on smaller screens.

```ts
function formatInline(data: Record<string, unknown> | string | null): string {
  const obj = parseStructuredData(data);
  if (!obj) return "";
  return Object.entries(obj)
    .map(([k, v]) => {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return `${k}=${v}`;
      return `${k}=${JSON.stringify(v)}`;
    })
    .join(", ");
}
```

## Detail Dialog

Preferred for row-click detail on admin tables. Use `prompts.dialog` with `size: "large"` unless a side panel is clearly better.

### Structure

```
Dialog title: concise entity/status summary
Dialog icon: semantic row icon

┌─ Key-value grid (status, source/entity, time, owner, etc.)
│
├─ Primary body section
│  └─ bg-zinc-100 rounded-md block with the main text/payload
│
├─ Structured detail section (optional)
│  ├─ Formatted view (default): key-value grid on bg-zinc-100
│  ├─ Raw view (optional): pretty JSON on bg-zinc-100 + CopyButton inside
│  └─ "View raw" / "View formatted" toggle button
│
└─ [Close] button
```

### Structured Detail Rules

- Default view: structured key-value grid on `bg-zinc-100 dark:bg-zinc-800 rounded-md px-3 py-2`.
- Keys: `text-dimmed font-medium`. Values: `text-secondary`, complex values in `font-mono text-[11px]`.
- Raw view: `JSON.stringify(obj, null, 2)` in a `<pre>` with `CopyButton` positioned `absolute top-2 right-2` inside the block.
- Toggle: simple `text-[10px] text-dimmed hover:text-secondary` button below the block.
- Use `createSignal` for the raw/formatted toggle state.
- Do not show raw JSON by default unless the page is explicitly developer-facing and raw payload is the primary value.

## Pagination

- Use shared `Pagination` component below the table.
- Build `baseUrl` from current filter state, append `&page=` for pagination links.
- Default 100 entries per page on dense admin pages unless the domain needs a smaller batch size.

## File Organization

```
app/frontend/
├── page.tsx                          SSR page (data fetching + layout)
├── _components/
│   ├── FilterBar.island.tsx          search + filters + actions (one island)
│   ├── Table.island.tsx              table + detail dialog (one island)
│   └── types.ts                      filter state type + URL helpers
└── lib/
    └── navigation.ts                 refreshCurrentPath helper
```

- Preferred baseline: two islands max for a table page, FilterBar + Table.
- No separate islands for individual action buttons.
- Filter state types and URL builders in a shared `types.ts`.

## When to Relax the Pattern

- Very small tables with no search, no filters, and no row detail can stay fully SSR.
- Non-admin pages can loosen density and use richer cards if scanning speed is not the main goal.
- If the main workflow is editing rather than reviewing, a detail panel or split view may be better than a click-to-dialog table.
