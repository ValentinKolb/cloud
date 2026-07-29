# AppWorkspace

`AppWorkspace` is the full-height shell for application workspaces. It owns the sidebar, primary work area, contextual detail panels, and optional bottom drawer.

The application owns the content and which regions are open.

## Use AppWorkspace

Use it for resource lists, readers, editors, and operational screens that need persistent navigation around a primary work area.

Use `AppOverview` for a simple landing page. Use `Panes` inside `AppWorkspace.Main` when users must rearrange or split several peer tools.

## Import

```tsx
import {
  AppWorkspace,
  installAppWorkspaceController,
  normalizeAppWorkspaceLayoutState,
  type AppWorkspaceLayoutState,
} from "@k2b/ui";
```

## Compose the regions

`AppWorkspace.Content` is required. Put `Main` first and each `Detail` after it
inside `Content`. Put `BottomDrawer` at the workspace root.

`Main` adds no padding. Pass an application class through `class` when the workspace needs an inset. Omit it for edge-to-edge tables, editors, canvases, or `Panes`.

Use `MainPane` for a stable peer region such as a list beside a reader. Use `Detail` for contextual information about the current selection. Use `BottomDrawer` for activity, preview, or a composer below the work area.

Give every pane, detail, and drawer a stable purpose-based `id`. Do not use the selected record id. The host can use these ids with the exported layout-state helpers to restore geometry.

Set `resizable={false}` on the root to disable shared resizing. A region can override the root with its own `resizable` property.

`Detail` and `BottomDrawer` remain mounted while closed. Their `open` property
controls visibility, so local state and SSR DOM identity remain stable.

## Navigation

Provide both `SidebarMobile` and `SidebarDesktop` when the workspace has navigation. Sidebar items with an `href` remain real links.

Set `scrollPreserveKey` on scrolling sidebar bodies when enhanced navigation should restore their position.

The sidebar compound members cover these jobs:

- `SidebarHeader` supplies the application identity and optional action;
- `SidebarMobile`, `SidebarMobileItems`, and `SidebarMobileBody` compose the
  compact navigation;
- `SidebarDesktop`, `SidebarBody`, `SidebarSection`, and `SidebarFooter`
  compose the persistent navigation;
- `SidebarItem`, `SidebarItemIcon`, `SidebarItemLabel`, `SidebarItemMeta`, and
  `SidebarItemAction` compose a navigation row;
- `SidebarIconGrid` and `SidebarIconAction` provide compact icon-only actions.

## Accessibility

`MainPane.label` names the region. Sidebar icon actions and item actions require a clear `label`.

Resize handles are separators with orientation, limits, and the controlled region. Do not replace them with application-specific handles.

## Activate resizing

The complete workspace and its separator metadata render on the server. The
package does not install browser listeners or choose a persistence mechanism
automatically.

Install the controller once inside the hydrated owner. Pass `root` to limit
event delegation when a page can contain more than one workspace. `readState`
and `writeState` are generic seams: the application may use memory, local
storage, a cookie endpoint, or no persistence. The UI package does not know an
application id or cookie name.

```tsx
import {
  installAppWorkspaceController,
  type AppWorkspaceLayoutState,
} from "@k2b/ui";
import { onCleanup, onMount } from "solid-js";

let shell: HTMLDivElement | undefined;

onMount(() => {
  if (!shell) return;
  const dispose = installAppWorkspaceController({
    root: shell,
    readState: () => storedLayout(),
    writeState: (state: AppWorkspaceLayoutState) => saveLayout(state),
  });
  onCleanup(dispose);
});

<div ref={shell}>
  <AppWorkspace>{/* regions */}</AppWorkspace>
</div>;
```

The controller handles pointer and keyboard resizing, clamps sizes to the
available workspace, updates separator values, and writes only after a resize
settles or a keyboard step completes.

## Restore layout state

Use `normalizeAppWorkspaceLayoutState` for an unknown decoded value. It accepts
the legacy version 1 detail width and returns the current version 2 shape.
`parseAppWorkspaceLayoutState` and `serializeAppWorkspaceLayoutState` handle the
encoded string representation.

`appWorkspaceLayoutStyle` converts a state into CSS variable declarations for
SSR. Apply the returned string to an ancestor of `AppWorkspace` so the first
render uses the stored geometry.

The lower-level exports support custom hosts:

- `safeAppWorkspacePanelId` bounds ids used in CSS variables;
- `appWorkspacePanelVariable` returns the variable for a pane, detail, or
  drawer;
- `appWorkspaceResizeLimits`, `resolveAppWorkspaceSidebarWidth`, and
  `shouldCollapseAppWorkspaceSidebar` expose the controller's sizing rules;
- the geometry constants themselves, in pixels, one `DEFAULT`/`MIN`/`MAX`
  triple per resizable region:
  `APP_WORKSPACE_SIDEBAR_DEFAULT`, `APP_WORKSPACE_SIDEBAR_MIN`,
  `APP_WORKSPACE_SIDEBAR_MAX`;
  `APP_WORKSPACE_PANE_DEFAULT`, `APP_WORKSPACE_PANE_MIN`,
  `APP_WORKSPACE_PANE_MAX`;
  `APP_WORKSPACE_DETAIL_DEFAULT`, `APP_WORKSPACE_DETAIL_MIN`,
  `APP_WORKSPACE_DETAIL_MAX`;
  `APP_WORKSPACE_DRAWER_DEFAULT`, `APP_WORKSPACE_DRAWER_MIN`,
  `APP_WORKSPACE_DRAWER_MAX`;
  plus `APP_WORKSPACE_SIDEBAR_COLLAPSED` and
  `APP_WORKSPACE_SIDEBAR_COLLAPSE_THRESHOLD`.
- `APP_WORKSPACE_MAIN_MIN` and `APP_WORKSPACE_MAIN_MIN_HEIGHT` are the space
  the main region always keeps. They are not a resizable region of their own:
  every other region's usable maximum is the container minus this floor, which
  is why dragging a detail panel or drawer stops before the work area is
  squeezed away. `appWorkspaceResizeLimits` applies them for you.

Most applications should use the controller and state helpers instead of
reimplementing those lower-level rules.

## Runtime

Rendering and state normalization are SSR-safe. Install the controller only in
the browser and dispose it with the hydrated owner.

The package exports parse, normalize, serialize, and style helpers for layout state. The application decides where that state is stored and can apply the same state during SSR to avoid geometry jumps.

## Example

```tsx
<AppWorkspace class="app-shell-frame">
  <AppWorkspace.Sidebar collapsible>
    <AppWorkspace.SidebarHeader title="Inventory" icon="ti ti-box" />
    <AppWorkspace.SidebarMobile>
      <AppWorkspace.SidebarMobileItems>
        <AppWorkspace.SidebarItem
          href="/app/inventory"
          icon="ti ti-list"
          active
          navigation="document"
        >
          All items
        </AppWorkspace.SidebarItem>
      </AppWorkspace.SidebarMobileItems>
    </AppWorkspace.SidebarMobile>
    <AppWorkspace.SidebarDesktop>
      <AppWorkspace.SidebarBody scrollPreserveKey="inventory-sidebar">
        <AppWorkspace.SidebarSection title="Views">
          <AppWorkspace.SidebarItem
            href="/app/inventory"
            icon="ti ti-list"
            active
            navigation="document"
          >
            All items
          </AppWorkspace.SidebarItem>
        </AppWorkspace.SidebarSection>
      </AppWorkspace.SidebarBody>
    </AppWorkspace.SidebarDesktop>
  </AppWorkspace.Sidebar>

  <AppWorkspace.Content>
    <AppWorkspace.Main mobilePane={selectedId() ? "reader" : "list"}>
      <AppWorkspace.MainPane id="list" label="Inventory">
        <InventoryList />
      </AppWorkspace.MainPane>
      <AppWorkspace.MainPane id="reader" label="Item reader">
        <ItemReader id={selectedId()} />
      </AppWorkspace.MainPane>
    </AppWorkspace.Main>
    <AppWorkspace.Detail
      id="item"
      open={selectedId() !== null}
      width="lg"
    >
      <ItemDetail id={selectedId()} />
    </AppWorkspace.Detail>
  </AppWorkspace.Content>
  <AppWorkspace.BottomDrawer
    id="activity"
    open={showActivity()}
    height="sm"
  >
    <ActivityLog />
  </AppWorkspace.BottomDrawer>
</AppWorkspace>
```
