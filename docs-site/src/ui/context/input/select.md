# Select inputs

`Select`, `MultiSelectInput`, and `SelectChip` cover three different selection
tasks. The parent owns every selected value.

## Use select inputs

Choose from the state transition, not from the desired visual shape:

| Task                                        | Component          | Value contract                 |
| ------------------------------------------- | ------------------ | ------------------------------ |
| Choose one value in a form                  | `Select`           | one controlled value or `null` |
| Choose several values                       | `MultiSelectInput` | one controlled ID array        |
| Choose one compact toolbar value            | `SelectChip`       | one controlled value           |
| Filter a result set                         | `FilterChip`       | controlled filter state        |
| Find an item, perform an action, then clear | `Combobox`         | selected item callback         |
| Run a secondary action or open a link       | `Dropdown`         | no field value                 |

Do not rebuild select rows inside `Dropdown.element`. That loses the shared
field, listbox or radio semantics and makes alignment and keyboard behavior the
consumer's responsibility. See [Dropdown and ContextMenu](../actions/menus) for
action menus and composite custom content.

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
Each selection closes the menu before reporting through both value callbacks,
so a consumer update cannot leave stale option content visible. Its options use
`{ value, label }`, and their values may be strings or numbers. Optional
`icon`, `image`, and `description` metadata supports compact rich choices such
as model or environment selectors; use `menuWidth` only when their copy needs
more than the default `10rem`.

Selection popovers dismiss synchronously. Do not add a generic host-level
`[popover]` display or overlay transition around them; `@k2b/ui` explicitly
keeps interactive choice surfaces immediate.

Keep it for compact toolbars. It supports the same field label, description,
reactive error, required, and disabled state, but has no clear state.

```tsx
const [permission, setPermission] = createSignal("read");

<SelectChip
  aria-label="Permission"
  value={permission}
  onValueChange={setPermission}
  options={[
    { value: "read", label: "View", icon: "ti ti-eye" },
    { value: "write", label: "Edit", icon: "ti ti-pencil" },
    { value: "admin", label: "Manage", icon: "ti ti-shield" },
  ]}
/>;
```

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
