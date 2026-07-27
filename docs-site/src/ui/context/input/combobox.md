# Combobox

`Combobox` searches remote options and immediately hands the selected item to the parent. It clears after each selection and does not own a selected value.

## Use Combobox

Use it for repeated add actions such as adding members, resources, or references.

Use `Select` when one selected value must remain visible. Use `MultiSelectInput` when the field itself owns a visible list of selections.

## Import

```tsx
import {
  Combobox,
  type ComboboxOption,
  type ComboboxProps,
} from "@valentinkolb/cloud/ui";
```

## Search and selection

`fetchData(query, signal)` runs with an empty query when the field opens, then after a 200 ms debounce while the user types. A new query or closed popover aborts the previous request.

Each result has `id`, `label`, and optional `description` and `icon`. Icon values omit the leading `ti ` prefix, for example `ti-user`.

`onSelect` receives the complete option. The component then clears the query, closes the result list, and returns focus to the input so another item can be added.

Loading keeps the previous results visible. A failed lookup replaces the list with its error and a retry action.

## Accessibility

The input exposes combobox and expanded state, and the results use listbox and option semantics with keyboard navigation.

The current API has no separate `label` or `ariaLabel` property. Use it only in a surface where the search task is clear from persistent surrounding text; do not treat the placeholder as lasting instructions. Prefer `Select` when the field needs the normal labeled form contract.

## Runtime

`Combobox` requires hydrated Solid client code. It uses browser focus, Popover API, CSS anchor positioning, request cancellation, and keyboard events.

## Example

```tsx
const people = [
  { id: "user-1", label: "Alice", description: "Design" },
  { id: "user-2", label: "Bob", description: "Engineering" },
];
const [memberIds, setMemberIds] = createSignal<string[]>([]);

<Combobox
  placeholder="Search people"
  fetchData={async (query) =>
    people.filter((person) =>
      person.label.toLowerCase().includes(query.toLowerCase())
    )
  }
  onSelect={(person) =>
    setMemberIds((current) =>
      current.includes(person.id) ? current : [...current, person.id]
    )
  }
/>;
```
