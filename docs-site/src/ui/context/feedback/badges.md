# Badges and Chips

Cloud provides CSS utilities for compact labels, filter chips, prose tags, and status dots. The application owns their semantics, colors, and interaction.

## Use badges and chips

- Use `badge` for compact metadata or a short count.
- Use `chip` for a more substantial label or filter control with an icon.
- Use `tag` for a small category label in prose or lists.
- Use `status-dot` only beside a visible status label.

Use `StatusBadge` when a health or runtime state should follow the platform's shared status vocabulary.

## Import

```ts
import "@valentinkolb/cloud/ui/styles.css";
```

## Properties

These classes provide shape, spacing, and optional semantic tones. Native element properties and interaction stay with the application.

### Badge utilities

| Class | Purpose |
| --- | --- |
| `badge` | Base shape, spacing, and inline layout. The caller supplies color classes. |
| `badge-neutral` | Neutral badge with built-in light and dark tones. |
| `badge-success` | Successful state. |
| `badge-warning` | Warning state. |
| `badge-danger` | Failed or dangerous state. |
| `badge-sm` | Reduces padding and type size for dense rows. Compose it with a badge class. |

Use the built-in tone modifiers for semantic states. Use explicit `bg-*`, `text-*`, and dark-mode classes only for domain categories that are not health states.

### Chip, tag, and status dot

`chip` supplies a rounded border, spacing, and pointer treatment. Apply it to a native `<button>` or `<a>` when it is interactive. A non-interactive chip can use a `<span>`.

`tag` supplies a small rounded pill, spacing, and font weight. Add color classes for the category.

`status-dot` supplies only a fixed circular shape. Add a background color and a visible text label.

## Accessibility

Never make a clickable `<span>`. Use a button for an action and a link for navigation.

Color is not a label. Keep status text beside every status dot, and keep badge text meaningful without its background color. Decorative icons need `aria-hidden="true"`.

## Runtime

These utilities are CSS-only and need no hydration. Interaction behavior belongs to the native element or owning component.

## Example

```tsx
<div class="flex flex-wrap items-center gap-2">
  <span class="badge-success">Synced</span>

  <button type="button" class="chip" aria-pressed={assigned()}>
    <i class="ti ti-user" aria-hidden="true" />
    Assigned
  </button>

  <span class="tag bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
    backend
  </span>

  <span class="inline-flex items-center gap-2">
    <span class="status-dot bg-emerald-500" aria-hidden="true" />
    Online
  </span>
</div>
```
