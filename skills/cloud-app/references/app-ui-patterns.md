# Cloud app UI patterns

Use this reference before building or reshaping a built-in Cloud app UI. It is not a general frontend guide; it maps Cloud app screen types to the exact shared shell and reference app to copy first.

## First decision

Pick the closest existing app shell before writing JSX. The default is to mirror the shell and then change domain content.

| App surface | Use this Cloud pattern | Copy from | Do not invent |
| --- | --- | --- | --- |
| App start page with top-level resource cards | `AppOverview` with `Main` and `Aside title="Create"` | `packages/notebooks/src/frontend/NotebooksOverview.island.tsx`, `packages/spaces/src/frontend/SpacesOverview.island.tsx`, `packages/grids/src/frontend/_components/overview/BasesOverview.island.tsx` | Custom landing page, centered hero, one-off create card |
| Full resource workspace | `Layout fullWidth` + `AppWorkspace`; add `fullPage` only when the reference route needs footerless full-height behavior | `packages/spaces/src/frontend/[id]/page.tsx`, `packages/spaces/src/frontend/[id]/_components/workspace/SpacesWorkspace.island.tsx`, `packages/grids/src/frontend/_components/workspace/GridsWorkspace.island.tsx` | Hand-written sidebar/detail classes, generic `p-4` wrappers inside main |
| List/detail app | `AppWorkspace.Detail` with URL-backed selection | `packages/contacts/src/frontend/page.tsx`, `packages/contacts/src/frontend/[bookId]/page.tsx` | Local-only selected id that breaks reload/share/back |
| Resource settings | `SettingsModal` as the settings shell; open it in bare `prompts.dialog` for modal settings or render it in an existing route-backed settings page | `packages/notebooks/src/frontend/[id]/_components/settings/NotebookSettingsPanel.tsx`, `packages/notebooks/src/frontend/[id]/_components/settings/NotebookSettingsButton.tsx`, `packages/contacts/src/frontend/_components/BookSettingsForm.island.tsx`, `packages/grids/src/frontend/_components/settings/BaseSettingsPanel.tsx` | Bespoke settings layout, prompt header around `SettingsModal`, new settings route when the reference app uses a modal |
| Complex editor modal | `PanelDialog` opened with `dialogCore.open(..., panelDialogOptions)` or equivalent prompt bare surface | `packages/spaces/src/frontend/[id]/_components/shared/ItemForm.tsx`, `packages/contacts/src/frontend/_components/ContactUpsertForm.island.tsx`, `packages/grids/src/frontend/_components/records/RecordUpsertDialog.tsx` | Nested papers inside the modal body, small prompts forced into `PanelDialog` |
| Calendar workspace | Core `Calendar` with date/view in URL route state | `packages/spaces/src/frontend/[id]/_components/calendar/index.tsx` | Static shift/event list pretending to be a calendar |
| Dashboard metrics | `StatGrid` + `StatCell` | `packages/notebooks/src/frontend/admin.tsx`, `packages/contacts/src/frontend/admin.tsx`, `packages/oauth/src/frontend/page.tsx` | Raw stat grids or contextless numbers |
| Data table or log-like list | `DataTable` with URL-backed search/filter chips where server data changes | `packages/gateway-ops/src/observability/logs/_components/LogTable.island.tsx`, `packages/oauth/src/frontend/page.tsx`, `packages/contacts/src/frontend/admin.tsx` | Hand-written `<table>` markup for app dataviews |

If none of these rows fit, inspect `/app/ui-lab` and `packages/cloud/src/ui/` before creating local layout code.

## Visual design language (dimensional)

The shared utilities (`paper`, `btn-*`, `input`, badges, the input controls) carry a subtly-dimensional look driven by tokens in `packages/cloud/src/styles/global.css`. You almost never style depth by hand — use the shared classes and follow the rules below so every app stays consistent. `global.css` is built by the **core** container and served to every app, so these classes look identical everywhere; changing one utility there restyles all apps at once.

**Surfaces are raised, fields are recessed.** This light-from-above logic is the backbone:

- Cards/panels → `paper` (or `detail-section`). `paper` already carries a clip-safe inset bevel via `--theme-shadow-elevated`. Do **not** add an outer `shadow-*` to a card — a parent with `overflow:hidden`/scroll clips it; the inset bevel reads correctly everywhere. The Layout header and `sidebar` flow the same token, so they stay in sync.
- Inputs/wells → `input` (recessed). Select/Combobox/PIN/textarea all build on it, so they inherit the well look + dark focus. Inline select/dropdown/picker **triggers** (open a menu, don't accept typing) → `btn-input-recessed` — `btn-input`'s recessed sibling (filled + inset recess, sinks on `:active`) so they read as fields. Compose with `btn-input-sm/-md`; give the value span `flex-1` so the chevron sits right.
- Buttons → **filled** accent + soft bevel; they darken on hover and sink (inset shadow) on `:active`. `btn-primary` is a solid blue button now (not the old white-outline-that-fills-on-hover); `btn-secondary` = filled zinc, `btn-simple` = ghost. Just apply the class — press + bevel are built in (pure CSS, no markup wrapper).
- Controls (`SegmentedControl`, `Switch`, `Slider`, the native checkbox) = recessed track + raised knob/active segment. Use the shared components; don't hand-roll toggles.

**Outer shadow is only for portaled floating layers** — dialogs, popovers, dropdowns, context menus, toasts. Reach for the `popup` / `dialog-panel` utilities (they apply `var(--theme-shadow-float)`), or that token directly. Anything in normal flow uses the inset bevel instead. This split is what keeps shadows from being clipped.

**Depth tokens** (consume only when you must hand-roll a one-off surface — prefer the utilities): `--theme-shadow-elevated` (card bevel), `--theme-bevel-top` / `--theme-bevel-bottom`, `--theme-recess` / `--theme-recess-sm` (fields/checkboxes), `--theme-press` (`:active`), `--theme-shadow-float` (floating). `color-scheme: light/dark` is set globally so native `<input>`/`<select>`/scrollbars render correctly in dark — don't override it.

**Colour derives from shared tokens first, call-site accents second.** Prefer existing utility colours for app chrome. Badges/tags/status dots may stay call-site-coloured with soft tints when their colour is domain data — that's intentional and not something to centralize.

**No lazy dividers.** Separate header/body/footer inside a card with spacing, not an internal `border-t`/`<hr>`. (Row separators in `DataTable` and key→value `detail-facts` grids are functional data dividers and are fine.)

## Overview pages

Top-level resource overview pages that show resource cards plus starter/create actions should use `AppOverview`. Contacts-style list/detail pages are workspaces, not overview pages. `AppOverview` owns the page shell, max width, title block, two-column rhythm, and mobile stacking.

Canonical shape:

```tsx
<AppOverview title="Notebooks" subtitle="Collaborative notes and scripts." icon="ti ti-notebook">
  <AppOverview.Main title="Your notebooks" description="3 notebooks" toolbar={<TextInput type="search" />}>
    {resourceCards}
  </AppOverview.Main>

  <AppOverview.Aside title="Create" description="Choose a useful starter, or start blank.">
    <div class="grid grid-cols-1 gap-2">{templateButtons}{blankButton}</div>
  </AppOverview.Aside>
</AppOverview>
```

Cloud-specific rules:

- The create column is always `AppOverview.Aside title="Create"` for top-level resource overview pages.
- Starter/template buttons use `paper p-4 text-left flex items-start gap-3 hover:paper-highlighted transition-all`.
- The blank/create-from-scratch button follows the template buttons in the same grid.
- Resource cards use `paper ... hover:paper-highlighted` and include the domain icon/thumbnail, name, short description, and chevron.
- Search belongs in `AppOverview.Main.toolbar`, usually as `TextInput type="search"` with URL or local query behavior matching the reference app.

## Workspaces

Use `AppWorkspace` for full-height app screens with sidebar, main, and optional detail. This is the Cloud shell for resource work, not a generic layout helper.

Cloud-specific rules:

- SSR page wraps the island in `<Layout c={c} fullWidth title={breadcrumbs}>`. Add `fullPage` only when the route should suppress the normal footer and match an existing full-height reference.
- Sidebar is built from `AppWorkspace.Sidebar*` components, not custom nav markup.
- `AppWorkspace.SidebarBody` / `SidebarMobileBody` get stable `scrollPreserveKey` values for scrollable lists.
- `AppWorkspace.Main` should not get a generic `p-3` or `p-4` wrapper. The shell owns the outer gutters.
- Keep workspace vertical rhythm at `gap-2`.
- Detail panels use `AppWorkspace.Detail` and a `detail-stack` wrapper with separate `detail-section` cards. The stack owns inter-card spacing; sections own only their surface and inner padding.
- Links that require fresh SSR data use `navigation="document"` unless the mounted workspace owns an enhanced route-state loader.

## Settings

Use `SettingsModal` for resource settings. For modal settings, the prompt should provide only the overlay/portal:

```tsx
await prompts.dialog<void>(
  (close) => (
    <SettingsModal title="Notebook settings" icon="ti ti-notebook" onClose={close}>
      <SettingsModal.Tab id="general" title="General" icon="ti ti-settings" description="Name, icon, and metadata.">
        {generalSettings}
      </SettingsModal.Tab>
      <SettingsModal.Tab id="danger" title="Danger" icon="ti ti-alert-triangle" tone="danger">
        {dangerActions}
      </SettingsModal.Tab>
    </SettingsModal>
  ),
  { surface: "bare", header: false, size: "large" },
);
```

Cloud-specific rules:

- Do not add an extra dialog header around `SettingsModal`; the modal owns header, tabs, and close action.
- A route-backed settings page may still render `SettingsModal` as its body when that is the existing app pattern. The point is to reuse the shared settings shell, not to force every settings screen into the same navigation shape.
- Keep save state, dirty tracking, access callbacks, and API mutations in the app.
- Access tabs use `PermissionEditor`; callback functions close over the resource id and call the app's typed `apiClient`.
- Resource API keys belong in the resource settings surface with `ResourceApiKeys`, usually above `PermissionEditor`. Do not put key creation into `PermissionEditor`; read `api-keys.md` for the backend and UI pattern.
- Settings fields should have short descriptions when the label alone does not explain the Cloud behavior.

## Editors and prompts

Use the smallest Cloud dialog shell that fits:

- `prompts.form` for small forms.
- `prompts.dialog` for simple custom content.
- `SettingsModal` for tabbed settings.
- `PanelDialog` for complex editors with fixed header/footer, scrollable body, and sections.

`PanelDialog` is layout-only. It must not own app form state, validation, mutation flow, or API calls.

## Calendars

Calendar screens follow Spaces:

- SSR reads route state (`view`, `date`, filters, selected item) and loads the matching data window.
- The island passes `dateConfig` into `Calendar`.
- `onViewChange` and `onDateChange` update URL route state.
- Events expose `href` values so normal browser link behavior still works.
- Drag/drop or double-click writes use `mutation.create()` and the typed app client.
- If an enhanced workspace route updates breadcrumbs, publish server-computed breadcrumbs with `layout.update(...)`; reload must still SSR-render the same state.

## Public pages

Public app pages may have domain-specific visual style, but they still use Cloud primitives for behavior:

- app-owned public routes stay under the app's configured public/app path;
- public forms use the app's typed Hono client when they call app JSON APIs;
- optional modules must have complete create/edit/delete/admin visibility or must not be exposed as a selectable type;
- links that leave the public page open in a new tab with `target="_blank"` and `rel="noreferrer"`;
- anonymous/public flows say exactly what is anonymous and what is not.

## Cloud-specific anti-patterns

- A bespoke overview layout when `AppOverview` matches the surface.
- A bespoke settings layout when `SettingsModal` is the established app pattern.
- Raw `fetch("/api/...")` in an island for app JSON APIs instead of the typed Hono client.
- A visible feature type that can be created but not edited/rendered later.
- A calendar-like domain represented only as a static list when the user expects navigation by date/view.
- Contextless stats such as `4` without labels like `4 of 5`, time range, or count subtitle.
- Hand-written tables/stat grids where `DataTable` or `StatGrid` already matches.
