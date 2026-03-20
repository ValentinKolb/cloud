# Sidebar Utilities

Use this reference when implementing app sidebars.

## Canonical Utility Classes

- Desktop:
  - `sidebar-container`
  - `sidebar-header`
  - `sidebar-header-icon`
  - `sidebar-header-text`
  - `sidebar-header-title`
  - `sidebar-header-subtitle`
  - `sidebar-header-settings`
  - `sidebar-group`
  - `sidebar-body`
  - `sidebar-footer`
  - `sidebar-item`
  - `sidebar-item-active`
  - `sidebar-section-title`
- Mobile:
  - `sidebar-container-mobile`
  - `sidebar-mobile-toggle`
  - `sidebar-mobile-actions`
  - `sidebar-item-mobile`

## Spacing Rules

1. Let `sidebar-container` only place the column; do not use it as the visible surface.
2. Render one inner `paper flex h-full min-h-0 flex-col gap-4 p-4` surface for desktop sidebars.
3. Use small vertical spacing inside one group.
4. Use larger vertical spacing between groups.
5. Keep this ratio identical across `Actions`, `Navigation`, and other groups.

## Desktop Recipe

```tsx
<aside class="sidebar-container">
  <div class="paper flex h-full min-h-0 flex-col gap-4 p-4">
    <div class="flex items-center gap-3">{/* icon + title + optional settings */}</div>
    <div class="flex flex-col gap-3">{/* top groups */}</div>
    <div class="sidebar-body">{/* scrollable content */}</div>
    <div class="sidebar-footer">{/* bottom actions */}</div>
  </div>
</aside>
```

## Mobile Rules

1. Keep mobile navigation as a flat set of pill actions.
2. Put settings link into the same action row style (`sidebar-item-mobile`).
3. Avoid desktop-only control blocks on mobile unless the app explicitly needs them.

## View Transitions

1. Add stable `view-transition-name` attributes to:
   - sidebar settings action
   - primary actions (`search`, `new`)
   - navigation rows
2. Use deterministic keys, for example:
   - `space-sidebar-<spaceId>-view-list-desktop`
   - `space-sidebar-<spaceId>-search-mobile`
