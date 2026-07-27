# AppWorkspace

`AppWorkspace` is the full-height shell for application workspaces. It owns the sidebar, primary work area, contextual detail panels, and optional bottom drawer.

The application owns the content and which regions are open.

## Use AppWorkspace

Use it for resource lists, readers, editors, and operational screens that need persistent navigation around a primary work area.

Use `AppOverview` for a simple landing page. Use `Panes` inside `AppWorkspace.Main` when users must rearrange or split several peer tools.

## Import

```tsx
import { AppWorkspace } from "@valentinkolb/cloud/ui";
```

## Compose the regions

`AppWorkspace.Content` is required. Put `Main` first and each `Detail` after it inside `Content`.

`Main` adds no padding. Add `p-[var(--ui-space-shell)]` for a standard inset workspace. Omit it for edge-to-edge tables, editors, canvases, or `Panes`.

Use `MainPane` for a stable peer region such as a list beside a reader. Use `Detail` for contextual information about the current selection. Use `BottomDrawer` for activity, preview, or a composer below the work area.

Give every pane, detail, and drawer a stable purpose-based `id`. Do not use the selected record id. Cloud uses these ids to restore saved geometry.

Set `resizable={false}` on the root to disable shared resizing. A region can override the root with its own `resizable` property.

## Navigation

Provide both `SidebarMobile` and `SidebarDesktop` when the workspace has navigation. Sidebar items with an `href` remain real links.

Set `scrollPreserveKey` on scrolling sidebar bodies when enhanced navigation should restore their position.

## Accessibility

`MainPane.label` names the region. Sidebar icon actions and item actions require a clear `label`.

Resize handles are separators with orientation, limits, and the controlled region. Do not replace them with application-specific handles.

## Runtime

The complete workspace renders on the server. Cloud's browser workspace controller activates resize handles and stores geometry in the application workspace cookie.

The initial server render reads the same geometry, so navigation, details, and drawers do not need to jump after hydration.

## Example

```tsx
<AppWorkspace class="min-h-0 flex-1">
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
    <AppWorkspace.Main class="p-[var(--ui-space-shell)]">
      <InventoryList />
    </AppWorkspace.Main>
    <AppWorkspace.Detail
      id="item"
      open={selectedId() !== null}
      width="lg"
    >
      <ItemDetail id={selectedId()} />
    </AppWorkspace.Detail>
  </AppWorkspace.Content>
</AppWorkspace>
```
