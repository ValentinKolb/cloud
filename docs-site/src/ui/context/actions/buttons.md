# Buttons

`Button`, `ButtonLink`, `IconButton`, and `IconButtonLink` provide one semantic action hierarchy with consistent focus, sizing, and variants.

## Use Buttons

Use `primary` for the main forward action, `secondary` for supporting actions, `ghost` for quiet toolbar actions, `subtle` for compact contextual actions, `danger` for destructive work, and `success` only when success is the action's meaning.

## Import

```tsx
import { Button, ButtonLink, IconButton, IconButtonLink } from "@k2b/ui";
```

## Example

```tsx
<Button variant="primary" loading={saving()} loadingLabel="Saving">
  Save
</Button>

<Button variant="subtle" size="xs">
  <i class="ti ti-activity" aria-hidden="true" /> Status
</Button>

<IconButton label="Project settings">
  <i class="ti ti-settings" aria-hidden="true" />
</IconButton>

<ButtonLink href="/settings" variant="secondary">Settings</ButtonLink>

<IconButtonLink href="/settings" label="Open settings">
  <i class="ti ti-external-link" aria-hidden="true" />
</IconButtonLink>
```

`size` accepts `xs`, `sm`, `md`, or `lg`. `Button` defaults to `primary`; `IconButton` defaults to `ghost`. Loading disables the action, exposes busy semantics, and may replace the visible label through `loadingLabel`.

Links use normal document navigation by default. Inside a hydrated SSR workspace, opt into the shared navigation contract explicitly:

```tsx
<ButtonLink href="/items" navigation="enhanced" scroll="preserve" onNavigate={refreshWorkspace}>
  More items
</ButtonLink>
```

## Accessibility

All matching native button or anchor attributes pass through. The default button `type` is `button`, so form submission stays explicit. `IconButton` and `IconButtonLink` require `label`, which supplies their accessible name and title.

## Runtime

Buttons render complete server HTML. Click and reactive loading behavior require hydration only when their state or handlers are client-owned.
