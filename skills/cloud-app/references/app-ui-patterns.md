# Cloud app UI patterns

Use this reference before building or reshaping a built-in Cloud app UI. It is not a general frontend guide; it maps Cloud app screen types to the exact shared shell and reference app to copy first.

## First decision

Pick the closest existing app shell before writing JSX. The default is to mirror the shell and then change domain content.

| App surface | Use this Cloud pattern | Copy from | Do not invent |
| --- | --- | --- | --- |
| App start page with top-level resource cards | `AppOverview` with `Main` and `Aside title="Create"` | `packages/notebooks/src/frontend/NotebooksOverview.island.tsx`, `packages/spaces/src/frontend/SpacesOverview.island.tsx`, `packages/grids/src/frontend/_components/overview/BasesOverview.island.tsx` | Custom landing page, centered hero, one-off create card |
| Full resource workspace | `Layout fullWidth` + `AppWorkspace`; add `fullPage` only when the reference route needs footerless full-height behavior | `packages/spaces/src/frontend/[id]/page.tsx`, `packages/spaces/src/frontend/[id]/_components/workspace/SpacesWorkspace.island.tsx`, `packages/grids/src/frontend/_components/workspace/GridsWorkspace.island.tsx` | Hand-written sidebar/detail classes, generic `p-4` wrappers inside main |
| IDE-like query/editor workspace | `Panes` inside the app's main work area with explicit result/editor/context elements | UI Lab `/app/ui-lab/layout/panes`; existing Pulse screens still use deprecated `DockWorkspace` | Hand-written resizable split panes, nested custom tab bars, localStorage-only layout state |
| List/detail app | `AppWorkspace.Detail` with URL-backed selection | `packages/contacts/src/frontend/page.tsx`, `packages/contacts/src/frontend/[bookId]/page.tsx` | Local-only selected id that breaks reload/share/back |
| Resource settings | `SettingsModal` as the settings shell; open it in bare `prompts.dialog` for modal settings or render it in an existing route-backed settings page | `packages/notebooks/src/frontend/[id]/_components/settings/NotebookSettingsPanel.tsx`, `packages/notebooks/src/frontend/[id]/_components/settings/NotebookSettingsButton.tsx`, `packages/contacts/src/frontend/_components/BookSettingsForm.island.tsx`, `packages/grids/src/frontend/_components/settings/BaseSettingsPanel.tsx` | Bespoke settings layout, prompt header around `SettingsModal`, new settings route when the reference app uses a modal |
| Complex editor modal | `PanelDialog` opened with `dialogCore.open(..., panelDialogOptions)` or equivalent prompt bare surface | `packages/spaces/src/frontend/[id]/_components/shared/ItemForm.tsx`, `packages/contacts/src/frontend/_components/ContactUpsertForm.island.tsx`, `packages/grids/src/frontend/_components/records/RecordUpsertDialog.tsx` | Nested papers inside the modal body, small prompts forced into `PanelDialog` |
| Calendar workspace | Core `Calendar` with date/view in URL route state | `packages/spaces/src/frontend/[id]/_components/calendar/index.tsx` | Static shift/event list pretending to be a calendar |
| Dashboard metrics | `StatGrid` + `StatCell` | `packages/notebooks/src/frontend/admin.tsx`, `packages/contacts/src/frontend/admin.tsx`, `packages/oauth/src/frontend/page.tsx` | Raw stat grids or contextless numbers |
| Data table or log-like list | `DataTable` with URL-backed search/filter chips where server data changes | `packages/gateway-ops/src/observability/logs/_components/LogTable.island.tsx`, `packages/oauth/src/frontend/page.tsx`, `packages/contacts/src/frontend/admin.tsx` | Hand-written `<table>` markup for app dataviews |

If none of these rows fit, inspect `/app/ui-lab` and `packages/cloud/src/ui/` before creating local layout code.

## Visual design language

Follow `design.md` for colour roles, surfaces, geometry, density, interaction states, responsive behaviour, dark mode, and review criteria. Shared primitives own those decisions; app code supplies domain content and meaningful data/status colours.

Do not restyle a shared shell locally. If the design system cannot express a justified app requirement, improve the core primitive and document the rule in `design.md` before adding an app-specific exception.

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
- For app/workspace-local spotlight navigation, use `SpotlightButton` and `openSpotlightSearch()` from `@valentinkolb/cloud/ui`. Reserve `Cmd/Ctrl+K` for global Cloud search; local spotlight uses `Mod+Shift+K`.

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

Use `Panes` for the nested work surface inside an app main area when the screen behaves like an IDE: output/result, editor, context, and reference panes. Keep pane children edge-to-edge; put padding inside the actual `paper`, table, editor, or panel component. `DockWorkspace` is deprecated and should not be used for new screens.

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
