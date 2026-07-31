# Toolbar

`Toolbar` gives related actions one semantic and responsive container.

## Use Toolbar

Use it for editor commands, table actions, and compact page controls. Use `Toolbar.Group` for named clusters, `Toolbar.Separator` between clusters, and `Toolbar.Spacer` before a trailing primary action.

## Import

```tsx
import { Button, IconButton, Toolbar } from "@k2b/ui";
```

## Layout

Enable `wrap` where actions may outgrow the available width. The toolbar does not impose button variants or a second focus model.

## Accessibility

Always provide `label`. Name groups when their purpose is not obvious. Buttons keep native keyboard behavior, labels, and disabled state.

## Runtime

The layout renders on the server. Only child action handlers require hydration.

## Example

```tsx
<Toolbar label="Document actions" wrap>
  <Toolbar.Group label="History">
    <IconButton label="Undo"><i class="ti ti-arrow-back-up" /></IconButton>
    <IconButton label="Redo"><i class="ti ti-arrow-forward-up" /></IconButton>
  </Toolbar.Group>
  <Toolbar.Separator />
  <Button size="xs" variant="subtle">Status</Button>
  <Toolbar.Spacer />
  <Button size="sm">Publish</Button>
</Toolbar>
```
