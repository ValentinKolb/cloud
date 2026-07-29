# IconInput

`IconInput` selects one Tabler icon from a searchable catalogue. The parent owns the selected class string and its persistence.

## Use IconInput

Use it when users may choose an icon for a resource or category.

Pass `options` when the domain should expose only a curated subset.

## Import

```tsx
import { DEFAULT_ICON_OPTIONS, IconInput } from "@k2b/ui";
```

`IconInput` uses `DEFAULT_ICON_OPTIONS` when `options` is omitted. Pass a
domain-specific list only when the application needs a narrower vocabulary.

## Value and search

The controlled `value` is the complete Tabler class string, for example `"ti ti-currency-euro"`. Render it directly with `<i class={icon()}>`.

`onValueChange` receives the next class string or `null`. Empty selection is
allowed by default through `clearable`. Omit `options` for the shared default
catalogue, or pass an explicit catalogue to limit the available icons.

Search is local and matches labels and synonyms with fuzzy filtering. `searchLimit` defaults to `50` for non-empty searches. Opening the picker with an empty query shows the full catalogue alphabetically.

Relevant properties are `label`, `description`, `placeholder`, `value`,
`onValueChange`, `error`, `required`, `clearable`, `disabled`, `options`, and
`searchLimit`.

## Accessibility

Provide a visible `label`. Option labels name the icons; the glyph is supplementary.

When the selected icon is rendered elsewhere as an action, that action still needs its own accessible name.

## Runtime

The picker uses the interactive `Select` component and local fuzzy search, so it must run in hydrated Solid client code. It performs no network request.

## Example

```tsx
const [icon, setIcon] = createSignal<string | null>(
  "ti ti-star",
);

const icons = [
  { value: "ti ti-star", label: "Star", keywords: ["favorite"] },
  { value: "ti ti-box", label: "Box", keywords: ["package"] },
];

<IconInput
  label="Icon"
  options={icons}
  value={icon()}
  onValueChange={setIcon}
/>;

<i class={icon()} aria-hidden="true" />;
```
