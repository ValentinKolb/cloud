# IconInput

`IconInput` selects one Tabler icon from a searchable catalogue. The parent owns the selected class string and its persistence.

## Use IconInput

Use it when users may choose an icon for a resource or category.

Pass `options` when the domain should expose only a curated subset.

## Import

```tsx
import { IconInput } from "@valentinkolb/cloud/ui";
```

## Value and search

The controlled `value` is the complete Tabler class string, for example `"ti ti-currency-euro"`. Render it directly with `<i class={icon()}>`.

`onChange` receives the next class string. Empty selection is allowed by default through `clearable`.

Search is local and matches labels and synonyms with fuzzy filtering. `searchLimit` defaults to `50` for non-empty searches. Opening the picker with an empty query shows the full catalogue alphabetically.

Relevant properties are `label`, `description`, `placeholder`, `value`, `onChange`, `error`, `required`, `clearable`, `disabled`, `options`, and `searchLimit`.

## Accessibility

Provide a visible `label`. Option labels name the icons; the glyph is supplementary.

When the selected icon is rendered elsewhere as an action, that action still needs its own accessible name.

## Runtime

The picker uses the interactive `Select` component and local fuzzy search, so it must run in hydrated Solid client code. It performs no network request.

## Example

```tsx
const [icon, setIcon] = createSignal<string | undefined>(
  "ti ti-star",
);

<IconInput label="Icon" value={icon} onChange={setIcon} />;

<i class={icon()} aria-hidden="true" />;
```
