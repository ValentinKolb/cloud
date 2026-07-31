# Buttons

`Button` and `IconButton` provide one semantic action hierarchy with consistent focus, disabled, and loading behavior.

## Use Buttons

Use `primary` for the main forward action, `secondary` for supporting actions, `ghost` for quiet toolbar actions, `subtle` for compact contextual actions, `danger` for destructive work, and `success` only when success is the action's meaning.

## Import

```tsx
import { Button, IconButton } from "@k2b/ui";
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
```

`size` accepts `xs`, `sm`, `md`, or `lg`. `Button` defaults to `primary`; `IconButton` defaults to `ghost`. Loading disables the action, exposes busy semantics, and may replace the visible label through `loadingLabel`.

## Accessibility

All native button attributes pass through. The default `type` is `button`, so form submission stays explicit. `IconButton` requires `label`, which supplies its accessible name and title.

## Runtime

Buttons render complete server HTML. Click and reactive loading behavior require hydration only when their state or handlers are client-owned.
