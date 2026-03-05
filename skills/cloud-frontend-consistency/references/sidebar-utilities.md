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

1. Use small vertical spacing inside one group.
2. Use larger vertical spacing between groups.
3. Keep this ratio identical across `Actions`, `Navigation`, and other groups.

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
