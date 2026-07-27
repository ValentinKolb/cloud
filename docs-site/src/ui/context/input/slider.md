# Slider

`Slider` edits one bounded numeric value with a native range input. The parent owns the value, validation, and persistence.

## Use Slider

Use it when relative position within a range matters more than entering an exact number.

Use `NumberInput` when exact values are the primary task.

## Import

```tsx
import { Slider } from "@valentinkolb/cloud/ui";
```

## Range and display

`value` is a required numeric accessor. `onChange` receives each value as the range input moves.

`min`, `max`, and `step` default to `0`, `100`, and `1`. `showValue` defaults to `true`; `formatValue` controls its text.

With `center`, the filled track starts at the range midpoint. Double-click resets to `defaultValue`, or to the midpoint for a centered slider and `min` otherwise.

## Accessibility

Always provide `label`; the displayed value alone does not name the native range input. Use `description` for units or consequences that are not clear from the label.

Browser keyboard controls remain available because the component uses `<input type="range">`.

## Runtime

Value updates and double-click reset require hydrated Solid client code.

## Example

```tsx
const [volume, setVolume] = createSignal(64);

<Slider
  label="Volume"
  value={volume}
  onChange={setVolume}
  min={0}
  max={100}
  formatValue={(value) => `${value}%`}
/>;
```
