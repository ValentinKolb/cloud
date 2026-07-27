# Cards and Identity

`LinkCard` is a navigation tile, `ProgressBar` reports determinate progress, and `Avatar` identifies a user with a cached image or stable initials.

Each component owns its visual treatment. The application owns the destination, progress value, or user data.

## Use these components

- Use `LinkCard` in app launchers and tool grids where every tile leads to a destination.
- Use `ProgressBar` when progress can be expressed from 0 to 100.
- Use `Avatar` wherever a compact user identity needs an image fallback.

Do not use `LinkCard` for an action that does not navigate. Do not use `ProgressBar` for indeterminate work.

## Import

```tsx
import {
  Avatar,
  LinkCard,
  ProgressBar,
} from "@valentinkolb/cloud/ui";
```

## Properties

### LinkCard

| Property | Type | Purpose |
| --- | --- | --- |
| `href` | `string` | Navigation target for the complete card. |
| `title` | `string` | Names the destination. |
| `description` | `string` | Adds one short line of context. |
| `icon` | `string` | Tabler icon class for the leading tile. |
| `color` | `"blue" \| "emerald" \| "violet" \| "orange" \| "red" \| "amber" \| "zinc" \| "cyan" \| "rose"` | Tones the icon tile. |

Descriptions are rendered on one truncated line. Keep them short and do not place required detail there.

### ProgressBar

| Property | Type | Default | Purpose |
| --- | --- | --- | --- |
| `value` | `number` | required | Sets progress; values are rounded and clamped to 0–100. |
| `label` | `string` | `"Progress"` | Names the task for assistive technology. |
| `size` | `"xs" \| "sm" \| "md"` | `"md"` | Sets the track height. |
| `tone` | `"primary" \| "success" \| "danger"` | `"primary"` | Indicates ordinary, completed, or failed progress. |
| `showValue` | `boolean` | `false` | Shows the clamped percentage beside the track. |
| `class` | `string` | none | Adds classes to the outer row. |

### Avatar

| Property | Type | Default | Purpose |
| --- | --- | --- | --- |
| `username` | `string` | required | Supplies the accessible label and first two fallback characters. |
| `userId` | `string \| null` | none | Identifies the account avatar endpoint. |
| `avatarHash` | `string \| null` | none | Adds the avatar revision to the image URL. |
| `size` | `"xs" \| "sm" \| "md" \| "lg" \| "xl"` | `"md"` | Selects a fixed avatar size. |
| `class` | `string` | none | Adds classes to the image or fallback. |
| `style` | `string` | none | Adds inline styles to the image or fallback. |

An image is used only when both `userId` and `avatarHash` are present. Otherwise, `Avatar` renders the uppercased first two characters of the trimmed username, or `?` for an empty name.

## Accessibility

`LinkCard` is one link; do not place buttons or links inside it. Its title and description should make the destination clear.

Always pass a specific `ProgressBar` label. Tone supplements the numeric value and must not be the only status signal.

`Avatar` supplies an image alternative or `role="img"` label from `username`. Put the visible user name next to the avatar when identity matters.

## Runtime

All three components render on the server and need no hydration. `Avatar` image loading is lazy. Links retain native navigation behavior.

## Example

```tsx
<div class="app-rows">
  <LinkCard
    href="/app/files"
    title="Files"
    description="Browse shared storage"
    icon="ti ti-folder"
    color="blue"
  />

  <ProgressBar
    value={72}
    label="Upload progress"
    showValue
  />

  <div class="flex items-center gap-2">
    <Avatar username="Valentin Kolb" userId={user.id} avatarHash={user.avatarHash} size="sm" />
    <span>{user.name}</span>
  </div>
</div>
```
