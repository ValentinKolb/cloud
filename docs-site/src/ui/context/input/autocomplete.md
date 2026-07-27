# AutocompleteEditor

`AutocompleteEditor` is a controlled plain-text editor with synchronous or asynchronous completions. The parent owns the text and supplies the completion rules.

## Use AutocompleteEditor

Use it for mentions, formulas, query builders, commands, and other text where suggestions depend on the token at the caret.

Use `TextInput` for ordinary form text. Use `MarkdownEditor` when the document needs markdown editing and formatting behavior.

## Import

```tsx
import {
  AutocompleteEditor,
  type Completion,
  type SuggestContext,
  type Suggestion,
} from "@valentinkolb/cloud/ui";
```

## Value and submission

Pass the current text as an accessor and update it with `onInput`. `onChange` receives committed textarea changes.

Multiline mode is the default. In this mode, <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Enter</kbd> calls `onSubmit`. With `singleLine`, bare Enter submits and newlines are disabled.

## Completions

Each `Completion` has an optional trigger and a `suggest` function. The function receives the current query, surrounding text context, and an `AbortSignal`. It may return suggestions immediately or as a promise.

Set `dropdown: true` to show all matches. Without it, the active suggestion appears as a ghost preview. Tab accepts the active suggestion; dropdowns also support arrow keys and Enter.

Use `debounceMs` for remote lookups. A new query aborts the previous request. `allowAfterWord` permits triggers such as `(` directly after a function name.

`highlight` may return safe HTML for an overlay preview. Keep token styling width-neutral: color and background are safe; font weight, style, and letter spacing can desynchronize the overlay from the textarea.

## Accessibility

Pass `ariaLabel` when no external label identifies the editor. Use `ariaDescribedBy`, `ariaInvalid`, and `ariaRequired` to connect surrounding field help and validation.

The editor exposes combobox, listbox, active-option, and expanded state semantics. Suggestion labels and hints must make sense without color alone.

## Runtime

The editor requires hydrated Solid client code. Completion resolution, cancellation, caret positioning, keyboard navigation, and the optional overlay depend on browser APIs.

## Example

```tsx
const users = ["alice", "bob", "charlie"];
const [message, setMessage] = createSignal("");

const mentions: Completion = {
  trigger: "@",
  dropdown: true,
  suggest: (query) =>
    users
      .filter((user) => user.startsWith(query.toLowerCase()))
      .map((user) => ({ text: `@${user}`, hint: "user" })),
};

<AutocompleteEditor
  ariaLabel="Message"
  value={message}
  onInput={setMessage}
  lines={4}
  completions={[mentions]}
/>;
```
