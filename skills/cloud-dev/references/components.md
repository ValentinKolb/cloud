# Component and CSS catalogue

A lookup reference — find the component, then confirm its props. Do not read end to end.

Everything here imports from `@valentinkolb/cloud/ui`. There is no `@valentinkolb/cloud/ui/input` subpath; inputs come from the same place.

> **Prop lists change; prose about them rots.** This page names what exists and what it is for, and spells out only the props that are easy to get wrong. **The component source is the authority** — `packages/cloud/src/ui/`, or `node_modules/@valentinkolb/cloud/src/ui/` standalone. Read it the first time you use a component. `/app/ui-lab` is the live visual harness.

## Shells

### AppWorkspace

The standard full-height work shell. A compound component — these are all its members:

| Group | Members |
|---|---|
| Regions | `Content`, `Main`, `MainPane`, `Detail`, `BottomDrawer` |
| Sidebar | `Sidebar`, `SidebarHeader`, `SidebarDesktop`, `SidebarBody`, `SidebarSection`, `SidebarFooter` |
| Sidebar mobile | `SidebarMobile`, `SidebarMobileItems`, `SidebarMobileBody` |
| Sidebar items | `SidebarItem`, `SidebarItemIcon`, `SidebarItemLabel`, `SidebarItemMeta`, `SidebarItemAction` |
| Sidebar icons | `SidebarIconGrid`, `SidebarIconAction` |

```tsx
<Layout c={c} fullWidth title={breadcrumbs}>
  <AppWorkspace class="min-h-0 flex-1">
    <AppWorkspace.Sidebar>
      <AppWorkspace.SidebarHeader title="My App" icon="ti ti-star" />
      <AppWorkspace.SidebarDesktop>
        <AppWorkspace.SidebarBody scrollPreserveKey="my-app-sidebar">
          <AppWorkspace.SidebarSection title="Items">
            <AppWorkspace.SidebarItem href="/app/my-app" icon="ti ti-list" navigation="document">
              All items
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarBody>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>

    <AppWorkspace.Content>
      <AppWorkspace.Main class="p-[var(--ui-space-shell)]">{content}</AppWorkspace.Main>
      <AppWorkspace.Detail id="record" open={Boolean(selectedId)} width="lg">{detail}</AppWorkspace.Detail>
    </AppWorkspace.Content>
  </AppWorkspace>
</Layout>
```

Non-obvious behaviour worth knowing before you fight it:

- **`Content` is required and is not inserted for you.** The workspace root renders its children unchanged, so `Main` and `Detail` must be wrapped in `AppWorkspace.Content` — that is the flex row they are siblings in. Putting them directly under the root silently defeats the layout and the shared resize behaviour.
- **`Main` adds no padding.** Standard inset workspaces put `p-[var(--ui-space-shell)]` on it directly — not `p-3`/`p-4`, not an extra wrapper. Edge-to-edge tables, editors, canvases, and pane layouts omit it deliberately.
- `Detail` is a **sibling after Main inside `Content`**, never a second column inside Main.
- `MainPane` is for a stable peer region inside primary work — a list beside its reader. Not for contextual detail.
- Sidebar, MainPane, Detail, and BottomDrawer share one resize controller and one SSR geometry cookie. Never implement a local resize handle. `resizeShadow={false}` disables the edge shadow where the composition already supplies depth.
- `scrollPreserveKey` on `SidebarBody` / `SidebarMobileBody` handles scroll restoration across enhanced navigation.
- Geometry ids must be stable and purpose-based. **Never key saved geometry by the selected entity id.**

Layout rules for all of this live in `design.md`.

### AppOverview

App start pages with resource cards plus create actions. Members: `Main`, `Aside`, `EmptyState`.

```tsx
<AppOverview title="Notebooks" subtitle="Collaborative notes." icon="ti ti-notebook">
  <AppOverview.Main title="Your notebooks" description="3 notebooks" toolbar={<TextInput type="search" />}>
    {cards}
  </AppOverview.Main>
  <AppOverview.Aside title="Create" description="Choose a starter, or start blank.">
    {templateButtons}
  </AppOverview.Aside>
</AppOverview>
```

The create column is always `Aside title="Create"`: a `grid grid-cols-1 gap-2` of `paper p-4 text-left flex items-start gap-3` starter buttons, followed by one blank/from-scratch button. The component is visual structure only — search state, URL params, and mutations stay in the app.

### Panes

Resizable, tabbed, movable panes for IDE-like surfaces inside `AppWorkspace.Main`: query explorers, dashboard editors, report builders, import mapping.

```tsx
import { createPanesValue, Panes, type PanesValue } from "@valentinkolb/cloud/ui";

const [paneValue, setPaneValue] = createSignal<PanesValue>(createPanesValue(["result", "editor", "reference"]));

<Panes.Root value={paneValue()} onChange={setPaneValue} allowResize allowMove allowReorder allowHorizontalSplit allowVerticalSplit>
  <Panes.Element id="result" title="Result" icon="ti ti-chart-line">{result}</Panes.Element>
  <Panes.Element id="editor" title="Query" icon="ti ti-code">{editor}</Panes.Element>
</Panes.Root>
```

`createPanesValue(ids, presentation)` seeds the layout; presentation is `"single" | "tabs" | "stack"`, default `"tabs"`. Keep pane ids stable, keep children edge-to-edge and put padding inside the actual `paper`/editor/table, and persist `PanesValue` only when the product genuinely needs saved layout.

For a stable list/reader split, use `AppWorkspace.MainPane` instead — it supplies the geometry without making the app own a pane model.

`DockWorkspace` is **deprecated** and exported only for backwards compatibility.

### SettingsModal

The single-frame shell for tabbed resource settings, opened in a bare prompt dialog so `dialogCore` supplies the backdrop, focus trap, and Escape handling.

```tsx
await prompts.dialog<void>(
  (close) => (
    <div class="dialog-fixed-frame flex min-h-0 flex-col overflow-hidden">
      <SettingsModal title="Notebook settings" onClose={close}>
        <SettingsModal.Tab id="general" title="General" icon="ti ti-settings" description="Name, icon, metadata.">
          {general}
        </SettingsModal.Tab>
        <SettingsModal.Tab id="danger" title="Danger" icon="ti ti-alert-triangle" tone="danger">
          {danger}
        </SettingsModal.Tab>
      </SettingsModal>
    </div>
  ),
  { surface: "bare", header: false, size: "large" },
);
```

`SettingsModal` props: `title` (accessible name, **not** rendered as a banner), `defaultTab`, `activeTab`, `onTabChange`, `onClose`, `closeLabel`, `class`, `children`. `subtitle` and `icon` are **deprecated** compatibility props — new settings flows should not use them, because the category rail already supplies context.

`SettingsModal.Tab` props: `id`, `title`, `description?`, `icon?`, `tone?: "default" | "danger"`, `children`.

Wrap it in `dialog-fixed-frame` so the outer height stays stable while only the active pane scrolls — apply the same class to loading and error fallbacks so lazy loading cannot resize the modal. A `max-height` alone is not enough; shorter tabs still collapse the frame.

Open the modal **before** loading its data, then fetch one typed settings context inside it with an abortable mutation. Do not add settings payloads to the workspace SSR state, and do not keep a parallel settings route just as a data source.

### PanelDialog

Layout-only shell for complex editor dialogs with a fixed header/footer and a scrolling body. Members: `Header`, `Body`, `Footer`, `Section`.

Use it when the body is a real editor with multiple groups. **Not** for one-field prompts (`prompts.form`), simple pickers (`prompts.dialog`), or tabbed settings (`SettingsModal`).

Open it via `dialogCore.open(...)` with one of three option presets: `panelDialogOptions` for content-sized single-view dialogs, `panelDialogFixedOptions` when tabs or progressive sections change content height substantially, and `panelDialogWorkspaceOptions` for full workspace-sized editors.

`surface="floating"` switches from the default contained panel to settings-style full-height pages where each section is its own `paper`.

It is visual structure only: form state, validation, mutations, and save/cancel semantics stay in the app.

## Data and display

### DataTable

Use it for real tabular data before writing table markup. It owns sticky headers, density, row hover and selection, custom cell and header renderers, footer rows, empty state, and the infinite-load sentinel.

```tsx
const columns: DataTableColumn<Item>[] = [
  { id: "title", header: "Title", value: "title" },
  { id: "count", header: "Count", value: (row) => row.count },
];

<DataTable rows={items} columns={columns} getRowId={(item) => item.id} />
```

`DataTableColumn<T>`: `id`, `header` (JSX or a render function), `subtitle?`, `value?` (a key of `T` **or** a function), `class?`, `headerClass?`, `cellClass?`, `align?` — align defaults to right for numeric values and left otherwise.

`DataTableProps<T>` also carries: `getRowId`, `selectedRowId`, `rowClass`, `hoverRows`, `onRowClick`, `onRowDoubleClick`, `renderCell`, `renderHeader`, `footer`, `hasMore`, `loadingMore`, `onLoadMore`, `empty`, `density` (`"compact" | "normal"`), `stickyHeader`, `highlightColumns`, `verticalAlign`, `cellContentClass`, `fillHeight`, `class`, `tableClass`, `scrollPreserveKey`.

**Sorting is link-based**, because these tables are server-rendered and the order belongs in the URL:

```tsx
<DataTable
  rows={rows}
  columns={columns}                                    // mark columns `sortable: true`
  sort={{ key: filter.sort, direction: "desc" }}
  sortHref={(next) => filter.build(state, { sort: next.key })}
/>
```

Set `sortable: "errorRate"` when the server's sort key differs from the column id — one column often shows a rate while another sorts by the count behind it. Clicking the active column flips its direction; inactive columns keep a dimmed arrow so the row reads as sortable. Never sort in the browser: the client only has the rows it was already given.

Set `highlightColumns={false}` when the design calls for row-only hover. Default cell rendering turns `null`/`undefined`/`""` into an em dash, `Date` into a locale string, and booleans into Yes/No.

### StatGrid and StatCell

```tsx
<StatGrid title="Last 24 hours" columns={4} action={{ label: "View all", href: "/admin/logs" }}>
  <StatCell label="Requests" value={requests} sub="vs. 1.2k yesterday" />
</StatGrid>
```

> `action` is **`{ label, href }`** — an object, not JSX. Passing a `<button>` will not typecheck.

`StatGrid`: `children`, `title?`, `action?`, `columns?` (values outside 1–6 fall back to the 6-column ladder), plus size (`"md" | "sm"`) and surface (`"white" | "muted"`) — use `muted` inside grey section cards such as `PanelDialog.Section`. The header divider only appears when `title` is set.

`StatCell`: `label`, `value` (string, number, or JSX), `sub?`, `valueClass?` (override the default tone for warning/error/success), `accent?`, `href?` (makes the whole cell a link), `title?`, and an optional numeric array for an inline sparkline.

Every stat needs context — a range, unit, denominator, or subtitle. A bare number is not a stat.

### DataPanel

The container around records: heading, count, search and filter slots, the rows, and the states that replace them. Reach for it before assembling `section.paper` + heading + toolbar by hand.

```tsx
<DataPanel
  title="Routes"
  subtitle={`${rows.length} of ${total} routes`}      // the relationship informs, a bare count does not
  actions={<RangePicker label={null} value={filter.range} options={rangeOptions} />}
  search={<SearchBar action={PATH} value={filter.search} ariaLabel="Search routes" />}
  filters={<RouteFilterBar filter={filter} />}
  error={loadError}                                    // takes precedence over empty
  isEmpty={rows.length === 0}
  empty="No route produced traffic in this window."
  footer={<Pagination currentPage={page} totalPages={pages} baseUrl={base} />}
>
  <DataTable rows={rows} columns={columns} />
</DataPanel>
```

`search` is a **slot**, not a built-in: `SearchBar` is an island and the kit must not re-export islands. `error` and `isEmpty` are separate on purpose — "could not read this" and "there is nothing here" call for different responses, and collapsing them is how a failed load ends up looking like an empty result.

`DataPanel` frames **records**; `StatGrid` summarises **metrics**. Both compose `PanelHeader`, so their titles match. Use `PanelHeader` directly only when building a new panel-shaped surface.

### StatusBadge

One vocabulary for health across every surface. `tone` carries the meaning, `label` the domain wording — "failed", "offline" and "error" are all `error`.

```tsx
<StatusBadge tone="ok" label="Online" />
<StatusBadge tone="degraded" label="Degraded" title="Postgres diagnostics unavailable" />
<StatusBadge tone="warn" label="Overdue" variant="dot" />     // dense tables
<StatusBadge tone="neutral" label="Disabled" variant="text" />
```

Tones: `ok`, `warn`, `error`, `degraded`, `running`, `neutral`. `degraded` is deliberately distinct from `error` — the check ran, but its backing source is unreachable, which previously rendered as healthy.

Never hand-roll a status pill. The colour language is something operators learn, and a second dialect of it costs them accuracy.

### NoticeCard

A finding the page keeps visible — between a toast and an empty state.

```tsx
<NoticeCard.Grid items={diagnostics.warnings}>
  {(warning) => <NoticeCard tone={warning.tone} title={warning.title} detail={warning.detail} />}
</NoticeCard.Grid>
```

Tones are `info`, `warn`, `error`. Pass the real one: an unreachable backend is `error`. `NoticeCard.Grid` picks its column count from how many notices there are and renders nothing when there are none.

### RangePicker

The time window for observability surfaces. Renders links, so it works without hydration and the window stays shareable.

```tsx
<RangePicker
  label="Window"
  value={filter.range}
  options={RANGES.map((range) => ({ value: range, href: filter.build(state, { range }) }))}
/>
```

The caller supplies each `href` — that is what keeps the page's other filters intact — and owns the vocabulary, because traces think in `10m–30d` and request telemetry in `1h–30d`.

### Placeholder and ProgressBar

`Placeholder` is the shared empty/loading/error surface — never draw an app-local empty card.

Props: `title?`, `description?`, `children?`, `icon?`, `action?`, `align?`, `surface?`, `state?`, `variant?`, `class?`.

Use `state="loading"` for polite loading semantics and `state="error"` for failures. A filtered-empty state is not the same as an empty resource: give it a direct reset action.

`ProgressBar` is for determinate work and needs a task-specific accessible `label`.

### Other display components

| Component | Use |
|---|---|
| `Pagination` | Server-backed result pages. The current page is not a link |
| `FilterChip` | Multi-option filter dropdown; commit on click, not on close |
| `Calendar` | Timezone-aware when passed `dateConfig` from `getDateConfig(c)`. Route state stores `YYYY-MM-DD`; persisted instants are UTC |
| `StructuredDataPreview` | Small JSON-like values — metadata, payloads, dimensions. Prefer it over a local `<pre>{JSON.stringify(…)}</pre>` |
| `CodeDisplay` | Read-only code block with optional `copy` and `lineNumbers` |
| `MarkdownView` | Expects **pre-rendered HTML**. Render server-side with `markdown.render` from `@valentinkolb/cloud/shared` |
| `CopyButton` | Clipboard copy with feedback |
| `CheckboxCard` | A checkbox option that needs a title, description, icon, or colour dot |
| `Avatar` | User identity picture with stable initials fallback. Pass `userId` and `avatarHash` when available; keep it circular. For profile-picture writes use `openAvatarUploadDialog`, never a generic `ImageInput` |
| `Chart`, `LinkCard`, `Lightbox`, `PdfPreview`, `FileTree`, `FileView`, `FileBrowser`, `LogEntriesTable`, `ContextMenu`, `Dropdown`, `FloatingWindow`, `RemoveBtn`, `Docs` | Exist; read the source when you need one |

## Interaction

### prompts

```typescript
import { prompts, toast, DialogHeader } from "@valentinkolb/cloud/ui";
```

| Method | Use |
|---|---|
| `prompts.form({ title, icon, size, fields })` | Typed form dialog. Returns the values object, or `null` on cancel |
| `prompts.dialog(render, options)` | Custom content. It already renders a header from `title`/`icon` — the body callback renders only content |
| `prompts.error(msg, opts?)` / `prompts.alert(...)` | Blocking feedback; use for failures |
| `prompts.confirm(msg, opts?)` | Confirmation before a destructive action |
| `prompts.search(resolver, options?)` | Generic async picker. Positional API: resolver first |

`prompts.form` field types — the discriminated union in full:

| `type` | Extra props | Returns |
|---|---|---|
| `text` | `multiline`, `lines`, `maxLength`, `minLength`, `icon`, `activeIcon`, `password`, `markdown` | `string` |
| `number` | `min`, `max`, `step` | `number` |
| `select` | `options: string[] \| { id, label?, description?, icon? }[]`, `icon`, `activeIcon`, `clearable` | `string` |
| `tags` | `maxTags`, `minTags`, `icon`, `activeIcon` | `string[]` |
| `boolean` | — | `boolean` |
| `datetime` | `dateOnly` | `string` |
| `image` | `round`, `ariaLabel` | `string` (base64) |
| `pin` | `length`, `stretch` | `string` |
| `info` | `content: string \| JSX.Element \| (() => JSX.Element)` | display only |

Every field except `info` also takes `label` (or `label: false`), `description`, `placeholder`, `required`, `default`, and `validate: (value) => string | null`.

Note `select` options use **`id`**, not `value`; `datetime` uses **`dateOnly`**; `info` uses **`content`**.

For a bare dialog shell — the `SettingsModal` case — pass `{ surface: "bare", header: false, size: "large" }`. When the content owns an unsaved-change guard, set `cancelBehavior: "ignore"` and route every close through the guarded function so Escape and backdrop clicks cannot bypass it. That must never produce an uncloseable dialog: the content still has to expose an accessible close.

### toast and Tooltip

`toast.success(...)`, `toast.error(...)`, `toast(msg, { title })`. An optional declarative `action: { label, href }` gives a short navigation link after a successful write — never a hidden write or a destructive action. `duration: 0` makes it sticky.

`Tooltip` wraps exactly one accessible trigger with a short, non-interactive hint. The control keeps its own accessible name; the tooltip supplements it. If the content needs actions or fields, use a popover or dialog.

### Spotlight and search

`SpotlightButton` + `openSpotlightSearch({ resolve, ... })` for app- or workspace-local navigation search. The local shortcut is `Mod+Shift+K`; `Cmd/Ctrl+K` stays reserved for global Cloud search registered through `app.start({ capabilities.search })`.

### EntitySearch

User/group/principal autocomplete. Include flags are **opt-in and all default to false**:

```tsx
<EntitySearch
  includeUsers
  includeGroups
  excludeUserIds={existingIds}
  onSelect={(principal) => grant(principal)}
/>
```

Props: `includeUsers`, `includeGroups`, `includeServiceAccounts`, `includeAuthenticated`, `includePublic`, `excludeUserIds`, `excludeGroupIds`, `excludeServiceAccountIds`, `providers` (`("ipa" | "local")[]`, whitelist semantics — only sent when exactly one entry), `onlyMembersOf`, `onSelect`, `placeholder`, `resultsHeightClass`, `disabled`.

`onSelect` receives a five-way discriminated union keyed by `type`: `user` (with `userId`), `group` (with `groupId`), `service_account` (with `serviceAccountId`, `kind`, `appId`, `resourceType`, `resourceId`), `authenticated`, and `public`.

### PermissionEditor

Grant UI for the shared access model.

Props: `initialEntries: AccessEntry[]`, `canEdit?`, `grantAccess(principal, permission)`, `updateAccess(accessId, permission)`, `revokeAccess(accessId)`, `allowPublic?`, `allowServiceAccounts?`. The caller closes over the resource id and calls its typed `apiClient`; the editor mutates only locally on optimistic update.

The permission type is grantable-only. **Do not import `GrantableLevel`** — it is local to the component. Use inference, or `Exclude<PermissionLevel, "none">` with `PermissionLevel` from `@valentinkolb/cloud/contracts`.

It never creates API keys, shows raw tokens, or owns credential revocation — that is `ResourceApiKeys`. See `auth.md`.

## Inputs

`TextInput`, `NumberInput`, `Select`, `MultiSelectInput`, `Combobox`, `TagsInput`, `SelectChip`, `ImageInput`, `ImageCropper`, `FileDropzone`, `DateTimeInput`, `DatePicker`, `ColorInput`, `IconInput`, `PinInput`, `Checkbox`, `CheckboxCard`, `Switch`, `SegmentedControl`, `Slider`, `AutocompleteEditor`, `TemplateEditor`.

> **Reactive props are accessor functions**, not values: `value={() => name()}`, `error={() => errors().name}`.

Use Cloud inputs everywhere, including `Select` — never substitute a native control for convenience.

Two that are commonly documented wrong:

- **`NumberInput` steppers are on by default.** `showSteppers` defaults to `true`; pass `false` to hide them. `disableSteppers` is separate — it disables the controls while still rendering them.
- **Markdown editing has two entry points.** `<TextInput markdown />` for form fields, which wraps in the standard input chrome; `<MarkdownEditor />` for standalone surfaces like a mail composer or a full-page note, with no chrome.

## CSS utilities

Only these exist. Several class names in older documentation — `sidebar-shell`, `sidebar-mobile`, `sidebar-desktop`, and a bare `rail` — do **not**.

**Buttons and inputs**
`btn-base` · `btn-sm` · `btn-md` · `btn-simple` · `btn-primary` · `btn-secondary` · `btn-success` · `btn-success-subtle` · `btn-danger` · `btn-ai` · `btn-input` · `btn-input-sm` · `btn-input-md` · `btn-input-active` · `btn-input-recessed` · `btn-input-primary` · `btn-input-success` · `btn-input-ai` · `btn-segment` · `btn-segment-icon` · `icon-btn` · `icon-btn-ai` · `input` · `input-ai` · `focus-ui`

**Surfaces and layout**
`paper` · `paper-highlighted` · `section` · `article` · `container` · `dialog-panel` · `dialog-fixed-frame` · `dialog-viewport-content` · `panel-dialog-shell` · `panel-dialog-section` · `panel-dialog-section-icon` · `app-cols` · `app-rows` · `no-scrollbar` · `ellipsis` · `list-item` · `list-item-active` · `section-label`

**Feedback**
`info-block` · `info-block-note` · `info-block-info` · `info-block-success` · `info-block-warning` · `info-block-danger` · `info-block-error` · `status-dot` · `badge` · `chip` · `tag` · `thumbnail` · `popup` · `tooltip-surface` · `state-placeholder-icon` · `state-placeholder-icon-panel` · `state-placeholder-icon-error` · `progress-track` · `progress-fill-primary` · `progress-fill-success` · `progress-fill-danger`

**Menus**
`context-menu-surface` · `dropdown-menu-surface` · `menu-item` · `menu-section` · `menu-label`

**Navigation**
`sidebar` · `sidebar-container` · `sidebar-container-mobile` · `sidebar-header` · `sidebar-header-icon` · `sidebar-header-title` · `sidebar-header-subtitle` · `sidebar-header-settings` · `sidebar-body` · `sidebar-footer` · `sidebar-group` · `sidebar-section-title` · `sidebar-item` · `sidebar-item-active` · `sidebar-item-tall` · `sidebar-item-meta` · `sidebar-item-action` · `sidebar-item-mobile` · `sidebar-mobile-toggle` · `sidebar-mobile-actions` · `sidebar-icon-grid` · `sidebar-icon-grid-wrap` · `sidebar-icon-action` · `sidebar-icon-action-active` · `sidebar-icon-action-success` · `sidebar-icon-action-danger` · `sidebar-tree` · `sidebar-tree-item` · `sidebar-tree-row` · `sidebar-tree-toggle` · `rail-item` · `rail-item-active` · `segmented-control` · `segmented-control-item` · `pagination-item` · `pagination-item-current` · `pagination-ellipsis`

**App identity**
`app-accent-text` · `app-accent-border` — the only sanctioned way to consume `--app-accent` in content. Never hardcode an app colour locally.

**Detail panels**
`detail-stack` · `detail-header` · `detail-section` · `detail-section-compact` · `detail-section-label` · `detail-row` · `detail-row-icon` · `detail-row-label` · `detail-facts` · `detail-fact-key`

The shape is a **flat orientation hero, then a scrolling stack of section cards**. `detail-header` owns identity, status, close/overflow, and the frequent quick actions — it takes no `paper`, background, border, radius, shadow, or bottom divider. `detail-stack` owns the spacing between cards; `detail-section` auto-applies `paper p-4`. The outer panel container gets no `paper` at all, only structural classes.

**Data tables**
`data-table-header` · `data-table-divider` · `data-table-row-divider` · `data-table-row-hover` · `data-table-row-selected` · `data-table-column-hover` — owned by `DataTable`; app code should not apply them directly.

Semantic design tokens (`--ui-surface`, `--ui-radius-*`, `--ui-space-*`, `--ui-focus`, …) are catalogued in `design.md`. Consume those rather than hardcoded neutrals, radii, or shadows.
