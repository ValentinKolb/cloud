# Spotlight search

`SpotlightButton` launches the portable search prompt with one shortcut and accessible-name contract across navigation contexts.

## Use Spotlight search

Use it for a global or scoped entity search that should open from several navigation surfaces.

## Import

```tsx
import { openSpotlightSearch, SpotlightButton } from "@k2b/ui";
```

## Example

```tsx
const openSearch = () => openSpotlightSearch({
  title: "Open project",
  resolve: ({ query }) => projects.filter((project) => project.label.includes(query)),
});

<SpotlightButton variant="chip" onClick={openSearch} />
```

Variants cover default, compact, chip, sidebar, sidebar-mobile, and icon launchers.

## Accessibility

Every variant retains an accessible label. `isSpotlightShortcut` recognizes Command+Shift+K and Control+Shift+K.

## Runtime

The button renders during SSR; opening and resolving the prompt require hydration.
