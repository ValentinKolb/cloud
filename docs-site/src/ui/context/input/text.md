# TextInput

`TextInput` is the standard labeled text field for portable application forms.
The parent owns the value, validation, persistence, and form submission.

## Use TextInput

Use it for short text, search terms, email addresses, URLs, telephone numbers, passwords, and small multiline fields.

Use `MarkdownEditor` for a standalone document editor. Use `AutocompleteEditor` when completion behavior is the main interaction rather than ordinary form input.

## Import

```tsx
import { TextInput } from "@k2b/ui";
```

## Value and events

Pass `value` directly or as a Solid accessor. `onValueChange` receives every
edit. `onValueCommit` receives the committed string, normally when the field
loses focus.

`clearable` adds a clear button to a single-line field. Without `onClear`,
clearing emits an empty string through both value callbacks.

## Input modes

- `type` supports text, search, email, URL, and telephone input.
- `multiline` renders a plain textarea.
- `markdown` renders the shared `MarkdownEditor` and implies multiline input.
- `password` adds a show or hide control.
- `variant="ai"` changes the field treatment and default icon. It does not add AI behavior.
- `monospace`, `prefix`, and `suffix` adapt the field to code-like values and short units.

In plain multiline mode, Enter calls `onSubmit` and Shift+Enter inserts a newline. In markdown mode, <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Enter</kbd> calls `onSubmit`; bare Enter stays available for writing.

## Field state

`label`, `description`, `required`, and `error` form one field. `disabled`
disables the input and its controls.

The complete visible input shell keeps the text cursor across leading icons,
affixes, and padding. Clear and password controls retain their action cursor.

`spellcheck` and `maxLength` pass through in every mode, including markdown. `autocomplete` and `autocapitalize` reach the native input and textarea only, not the markdown editor. `inputMode` applies to the single-line input.

Browser autofill remains enabled for native single-line inputs. While the
browser reports an autofilled value, `TextInput` extends one semantic surface
across the input, leading icon, affixes, and clear or password control. Editing
the value returns the field to its regular visual state.

## Accessibility

Prefer a visible `label`. When the surrounding layout cannot render one, pass
`"aria-label"`; a placeholder is not a persistent label.

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
  onValueChange={setQuery}
  clearable
/>;
```
