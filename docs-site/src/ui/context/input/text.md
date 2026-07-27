# TextInput

`TextInput` is the standard labeled text field for Cloud forms. The parent owns the value, validation, persistence, and form submission.

## Use TextInput

Use it for short text, search terms, email addresses, URLs, telephone numbers, passwords, and small multiline fields.

Use `MarkdownEditor` for a standalone document editor. Use `AutocompleteEditor` when completion behavior is the main interaction rather than ordinary form input.

## Import

```tsx
import { TextInput } from "@valentinkolb/cloud/ui";
```

## Value and events

Pass the current value as an accessor. `onInput` receives every edit. `onChange` receives the committed string, normally when the field loses focus.

`clearable` adds a clear button to a single-line field. Without `onClear`, clearing emits an empty string through both `onInput` and `onChange`.

## Input modes

- `type` supports text, search, email, URL, and telephone input.
- `multiline` renders a plain textarea.
- `markdown` renders the shared `MarkdownEditor` and implies multiline input.
- `password` adds a show or hide control.
- `variant="ai"` changes the field treatment and default icon. It does not add AI behavior.
- `monospace`, `prefix`, and `suffix` adapt the field to code-like values and short units.

In plain multiline mode, Enter calls `onSubmit` and Shift+Enter inserts a newline. In markdown mode, <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Enter</kbd> calls `onSubmit`; bare Enter stays available for writing.

## Field state

`label`, `description`, `required`, and the reactive `error` accessor form one field. `disabled` disables the input and its controls.

Outside markdown mode, browser hints pass through via `autocomplete`, `spellcheck`, `autocapitalize`, and `maxLength`. `inputMode` applies to the single-line input.

## Accessibility

Prefer a visible `label`. When the surrounding layout cannot render one, pass `ariaLabel`; a placeholder is not a persistent label.

Descriptions and errors are connected to the input. The error message is announced as a live alert. Clear and password controls have accessible names.

## Runtime

The field renders in server HTML. Editing, clearing, password visibility, markdown behavior, and callbacks require hydrated Solid client code.

## Example

```tsx
const [query, setQuery] = createSignal("");

<TextInput
  type="search"
  label="Search projects"
  description="Search by name or owner."
  icon="ti ti-search"
  value={query}
  onInput={setQuery}
  clearable
/>;
```
