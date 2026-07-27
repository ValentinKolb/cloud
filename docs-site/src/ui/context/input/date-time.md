# DateTimeInput

> **Deprecated:** Use `DatePicker` or `DateTimePicker` for new work.

`DateTimeInput` is a deprecated native date and date-time wrapper kept for compatibility with existing applications.

## Use the replacement

Use `DatePicker` for date-only values and `DateTimePicker` for date and time. Both provide the shared Cloud calendar interaction and explicit time-zone handling.

Keep `DateTimeInput` only while maintaining an existing screen that already depends on the browser-native control.

## Import

```tsx
import {
  DatePicker,
  DateTimeInput,
  DateTimePicker,
} from "@valentinkolb/cloud/ui";
```

## Legacy value behavior

`dateOnly` selects a native date input and emits a date key.

The default native date-time input emits local date-time text when no time zone is configured. With `dateConfig.timeZone` or the `timeZone` shortcut, it displays the instant in that zone and emits an instant after a change.

The parent supplies the value as an accessor and updates it through `onChange`.

## Accessibility

Existing uses should provide a visible `label`. Descriptions and reactive errors are connected to the native input.

Do not depend on the placeholder: browsers do not display placeholders for native date controls.

## Runtime

The native input renders in server HTML. Change handling and time-zone conversion require hydrated Solid client code. The browser owns the native picker UI, so its presentation varies by platform.

## Example

Prefer the replacement in new code:

```tsx
const [startsAt, setStartsAt] = createSignal<string | null>(null);

<DateTimePicker
  label="Starts at"
  value={startsAt}
  onChange={setStartsAt}
  dateConfig={{ timeZone: "Europe/Berlin" }}
/>;
```
