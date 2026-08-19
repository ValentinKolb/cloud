# Cards and identity

`LinkCard` is a single-destination navigation tile. `Avatar` renders an application-owned image URL, a semantic icon, or an initials fallback.

## Use cards and identity

Use `LinkCard` when the complete surface leads to one destination. Use `Avatar` beside a visible name when identity matters. Do not place unrelated interactive controls inside a link card.

## Import

```tsx
import { Avatar, LinkCard } from "@k2b/ui";
```

`LinkCard` accepts a title, description, icon, destination, and semantic color. `Avatar` accepts a name, optional image URL or icon, fallback, size, and loading behavior. Image content takes precedence over the icon, which takes precedence over initials.

## Accessibility

The card remains one native link with a visible focus indicator. Avatar supplies an image alternative or fallback `role="img"` label.

## Runtime

Both components render on the server. Link navigation works without hydration; avatar image-failure fallback activates after hydration.

## Example

```tsx
<LinkCard
  href="/runtime"
  title="Runtime"
  description="Open runtime details"
  icon="ti ti-server"
  color="cyan"
/>

<Avatar name="Ada Lovelace" src={profileImageUrl} size="sm" />
<Avatar name="Workflow" icon="ti ti-route" size="sm" />
```
