# Select inputs

`Select`, `MultiSelectInput`, and `SelectChip` cover three different selection
tasks. The parent owns every selected value.

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
} from "@k2b/ui";
```

## Select

Pass the selected value directly or through a Solid accessor. Selection and
clearing are atomic actions, so both `onValueChange` and `onValueCommit`
receive the complete next value. Clearing emits `null`.

Static options may be strings, `{ id, label?, description?, icon?, color? }`,
or normalized `{ value, label, description?, icon?, color?, disabled? }` objects.

`fetchData(query, signal)` accepts the convenient source shapes.
`loadOptions(query, signal)` accepts normalized options. Both run with an empty
query when the dropdown opens, debounce later input, and abort stale requests.
Pass `selectedOption` when the current value needs display metadata before the
first result arrives.

Remote sources always show the search field. Set `searchable` to add it to a
static option list, where it filters labels, descriptions, and values in the
browser. In `Select`, an option `color` replaces the icon with a color dot on the
trigger and in the list. `MultiSelectInput` tints the option icon and the
selected pill with it instead.

## MultiSelectInput

Pass the selected array directly or through a Solid accessor. Every selection
change reports the complete next array through both `onValueChange` and
`onValueCommit`. Static options may carry a color for selected pills.

It supports the same static or remote option sources. For remote data, `selectedOptions` supplies labels and metadata for selected IDs that are not in the current result page.

The dropdown always opens with a search field, which filters a static option
list in the browser. Pass `searchable={false}` for a short fixed list.

## SelectChip

`SelectChip` accepts its current `value` directly or through a Solid accessor.
Each selection reports through both value callbacks. Its options use
`{ value, label }`, and their values may be strings or numbers.

Keep it for compact toolbars. It supports the same field label, description,
reactive error, required, and disabled state, but has no clear state.

## Accessibility

Use visible labels on `Select` and `MultiSelectInput`. Their triggers expose combobox, listbox, expanded, selected, required, disabled, description, and error state.

Option labels must remain clear without icons or colors. If the surrounding
toolbar already names a `SelectChip`, use the native `"aria-label"` property
instead of repeating a visible label.

## Runtime

Triggers and selected values render in server HTML. Dropdown positioning, keyboard navigation, remote loading, selection, and clearing require hydrated Solid client code.

## Example

```tsx
const [status, setStatus] = createSignal("open");

<Select
  label="Status"
  placeholder="Choose a status"
  options={[
    { id: "open", label: "Open", icon: "ti ti-circle" },
    { id: "done", label: "Done", icon: "ti ti-check" },
  ]}
  value={status}
  onValueChange={setStatus}
  clearable
/>;
```
