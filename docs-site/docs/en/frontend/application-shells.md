---
title: Application shells
navTitle: Application shells
section: Frontend
order: 830
description: Choose the shared shell that matches an application's information structure.
tags: [shells, workspace, ui]
updated: 2026-07-27
---

# Application shells

Choose a shared shell before arranging domain content.

## Choose a shell

| Surface | Primitive |
| --- | --- |
| App start page with resource cards | `AppOverview` |
| Sidebar, main content, and optional detail | `AppWorkspace` |
| IDE-like resizable editor | `Panes` inside `AppWorkspace.Main` |
| Stable list and reader split | `AppWorkspace.MainPane` |
| Contextual selected item | `AppWorkspace.Detail` |
| Activity, preview, or composer | `AppWorkspace.BottomDrawer` |
| Resource settings | `SettingsModal` |
| Complex editor dialog | `PanelDialog` |
| Tabular records | `DataPanel` and `DataTable` |
| Metrics | `StatGrid` and `StatCell` |

`DockWorkspace` is deprecated. Use `Panes` for new work.

## Build an overview

`AppOverview` contains a main area and an optional aside. Put create actions in
`AppOverview.Aside`.

Use it for orientation and first actions. Do not turn it into a dashboard of
every application capability.

## Build a workspace

```tsx
<Layout c={c} title="Inventory" fullWidth fullPage>
  <AppWorkspace>
    <AppWorkspace.Sidebar label="Inventory">
      <InventoryNavigation />
    </AppWorkspace.Sidebar>
    <AppWorkspace.Main>
      <InventoryTable />
    </AppWorkspace.Main>
    {selected && (
      <AppWorkspace.Detail label="Item details">
        <ItemDetail item={selected} />
      </AppWorkspace.Detail>
    )}
  </AppWorkspace>
</Layout>
```

Selection belongs in the URL. The server must be able to render the same
detail after reload. See
[URL state and navigation](/docs/en/frontend/url-state-and-navigation).

Use the workspace members for geometry. Do not add another grid that imitates
a detail panel or resize handle.

## Choose a dialog

- Use `prompts.form()` for a small form.
- Use `prompts.dialog()` for custom compact content.
- Use `SettingsModal` for tabbed resource settings.
- Use `PanelDialog` for a multi-section editor.

The shared dialog core owns focus trapping, Escape, backdrop, and layering.

See [Forms, prompts, and feedback](/docs/en/frontend/forms-prompts-and-feedback)
for input and mutation behavior.

Do not restyle a shared shell locally. Improve the primitive when the design
system cannot express a recurring requirement.

Inspect current examples in the [UI catalog](/ui).
