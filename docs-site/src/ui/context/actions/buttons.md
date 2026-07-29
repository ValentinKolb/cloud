# Buttons and SpotlightButton

`Button` and `IconButton` provide one semantic action hierarchy with consistent focus, disabled, and loading behavior. They are package foundations for portable interfaces, not migrations of Cloud `Button` components.

`SpotlightButton` is the migrated launcher for a shared search prompt. It keeps one shortcut and accessible-name contract across navigation contexts.

## Use Buttons

Use `Button` for visible action text. Use `IconButton` only when the icon is familiar and space is constrained.

Choose `primary` for the main forward action, `secondary` for supporting actions, `ghost` for quiet toolbar actions, `danger` for destructive work, and `success` only when success is the action's meaning.

## Import

```tsx
import { Button, IconButton } from "@k2b/ui";
```

## Properties

`size` accepts `sm`, `md`, or `lg`. `loading` disables the action, adds busy semantics, and can replace the visible label through `loadingLabel`.

`Button` defaults to `primary`. `IconButton` defaults to `ghost` so a bare icon reads as a quiet toolbar action; pass `variant` explicitly to raise it.

All native button attributes pass through. The default `type` is `button`, so form submission is always explicit.

## Launch spotlight search

```tsx
import {
  isSpotlightShortcut,
  openSpotlightSearch,
  SpotlightButton,
  type SpotlightSearchResolver,
} from "@k2b/ui";
```

`SpotlightButton` accepts `default`, `compact`, `chip`, `sidebar`, `sidebar-mobile`, and `icon` variants. Compact and icon variants retain the label as their accessible name. Chip and sidebar variants show the shortcut unless `shortcutLabel={false}`.

`isSpotlightShortcut` recognizes Command+Shift+K and Control+Shift+K. `openSpotlightSearch` opens the portable search prompt with a zero-character minimum query by default. The caller supplies the resolver and handles the selected item.

## Accessibility

Use action-oriented labels. `IconButton` requires `label`; it supplies both the accessible name and title.

Do not replace disabled state with styling. Loading actions remain native disabled buttons and expose `aria-busy`.

## Runtime

Buttons render complete server HTML. Loading and click behavior require hydration only when their state or handlers are client-owned.

`SpotlightButton` also renders complete server HTML. Opening the prompt and handling the global shortcut require hydrated browser code.

## Example

```tsx
import {
  Button,
  IconButton,
  openSpotlightSearch,
  SpotlightButton,
  type SpotlightSearchResolver,
} from "@k2b/ui";

const projects = [
  { label: "Atlas", desc: "Customer portal", value: "atlas" },
  { label: "Beacon", desc: "Operations dashboard", value: "beacon" },
];

const resolveProjects: SpotlightSearchResolver<string> = ({ query }) => {
  const normalizedQuery = query.trim().toLowerCase();
  return projects.filter((project) =>
    `${project.label} ${project.desc}`.toLowerCase().includes(normalizedQuery),
  );
};

const openProjectSearch = async () => {
  await openSpotlightSearch<string>({
    title: "Open project",
    resolve: resolveProjects,
  });
};

<>
  <Button variant="primary" loading={saving()} loadingLabel="Saving">
    Save
  </Button>

  <IconButton label="Project settings" variant="ghost">
    <i class="ti ti-settings" aria-hidden="true" />
  </IconButton>

  <SpotlightButton
    variant="chip"
    onClick={openProjectSearch}
  />
</>
```
