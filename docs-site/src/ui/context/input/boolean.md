# Boolean inputs

Cloud provides `Switch`, `Checkbox`, and `CheckboxCard` for controlled boolean values. The parent owns the value, validation, and persistence.

## Use boolean inputs

Use `Switch` for an immediate on/off setting.

Use `Checkbox` for a selection, acknowledgement, or form value. Use `CheckboxCard` when the choice needs an explanation, icon, or color marker.

## Import

```tsx
import {
  Checkbox,
  CheckboxCard,
  Switch,
} from "@valentinkolb/cloud/ui";
```

## State and variants

All three components read a boolean accessor through `value` and emit the next boolean through `onChange`.

`Switch` supports `label` and `disabled`. It does not render description, error, or required state.

`Checkbox` adds `description`, reactive `error`, and `required`.

`CheckboxCard` requires a text or JSX `label` and supports the same form state as `Checkbox`. Add either `icon` or a valid three- or six-digit hex `color` as supporting context. `variant="input"` uses the denser input surface; the default is `"card"`.

## Accessibility

Each component uses a native checkbox. Labels activate the control, focus remains visible, and checked state is available to assistive technology.

The label must state what the checked value means. Do not rely on position, color, or the switch shape to convey state.

## Runtime

State changes require hydrated Solid client code. The native inputs remain visible to assistive technology.

## Example

```tsx
const [notifications, setNotifications] = createSignal(true);
const [review, setReview] = createSignal(false);

<Switch
  label="Notifications"
  value={notifications}
  onChange={setNotifications}
/>;

<CheckboxCard
  label="Needs review"
  description="Require approval before publishing."
  icon="ti ti-eye-check"
  value={review}
  onChange={setReview}
/>;
```
