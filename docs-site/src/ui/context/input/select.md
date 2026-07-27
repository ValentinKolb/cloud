# Select inputs

`Select`, `MultiSelectInput`, and `SelectChip` cover three different selection tasks. The parent owns every selected value.

## Use select inputs

- Use `Select` for one value in a form.
- Use `MultiSelectInput` for a controlled list of selected option IDs.
- Use `SelectChip` for one compact value in a toolbar.
- Use `Combobox` instead when selecting an item should immediately perform an action and clear the search field.

## Import

```tsx
import {
  MultiSelectInput,
  type MultiSelectInputProps,
  type MultiSelectOption,
  Select,
  SelectChip,
} from "@valentinkolb/cloud/ui";
```

## Select

`Select` reads its selected ID from an accessor and emits the next ID through `onChange`. Clearing emits an empty string.

Static options may be strings or objects with `id`, `label`, `description`, and a Tabler icon class.

`fetchData(query, signal)` enables remote search. It runs with an empty query when the dropdown opens, debounces later input, and aborts stale requests. Pass `selectedLabel` when the selected ID needs its display label before the first result arrives.

## MultiSelectInput

`MultiSelectInput` reads and emits an array of option IDs. Static options may also carry a color for selected pills.

It supports the same static or remote option sources. For remote data, `selectedOptions` supplies labels and metadata for selected IDs that are not in the current result page.

## SelectChip

`SelectChip` receives its current `value` directly rather than as an accessor. Its options use `{ value, label }`, and their values may be strings or numbers.

Keep it for compact toolbars. It has no field label, description, error, disabled, or clear state.

## Accessibility

Use visible labels on `Select` and `MultiSelectInput`. Their triggers expose combobox, listbox, expanded, selected, required, disabled, description, and error state.

Option labels must remain clear without icons or colors. `SelectChip` should appear where the surrounding toolbar already names the setting.

## Runtime

Triggers and selected values render in server HTML. Dropdown positioning, keyboard navigation, remote loading, selection, and clearing require hydrated Solid client code.

## Example

```tsx
const [status, setStatus] = createSignal<string | undefined>();

<Select
  label="Status"
  placeholder="Choose a status"
  options={[
    { id: "open", label: "Open", icon: "ti ti-circle" },
    { id: "done", label: "Done", icon: "ti ti-check" },
  ]}
  value={status}
  onChange={(value) => setStatus(value || undefined)}
  clearable
/>;
```
