# MarkdownEditor

`MarkdownEditor` is the standalone editor behind markdown-enabled Cloud inputs. It owns editing behavior and visual highlighting. The parent owns the document value, validation, persistence, and submission flow.

## Use MarkdownEditor

Use it for composers, notes, document bodies, and other editing surfaces that do not need `TextInput` form chrome.

Use `TextInput` with markdown mode when the editor belongs to a labeled form field with help text and validation messaging.

## Import

```tsx
import {
  MarkdownEditor,
  type MarkdownEditorProps,
} from "@valentinkolb/cloud/ui";
```

## Value and events

Pass a Solid accessor to `value`. `onInput` runs after every edit and is the normal controlled-state path.

`onChange` runs when the underlying textarea commits its change, normally on blur. `onSubmit` runs only for <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Enter</kbd>. Bare Enter always inserts or continues a line.

## Core properties

| Property | Type | Default | Purpose |
| --- | --- | --- | --- |
| `value` | `() => string \| null \| undefined` | empty | Supplies the current document. |
| `onInput` | `(value: string) => void` | none | Receives every edit. |
| `onChange` | `(value: string) => void` | none | Receives committed textarea changes. |
| `onSubmit` | `() => void` | none | Handles Ctrl/Cmd+Enter. |
| `placeholder` | `string` | none | Labels an empty editor visually. |
| `disabled` | `boolean` | `false` | Disables editing and toolbar actions. |
| `lines` | `number` | component default | Sets the approximate visible height. |
| `maxLength` | `number` | none | Applies the native textarea limit. |
| `spellcheck` | `boolean` | `true` | Controls browser spellcheck. |
| `noToolbar` | `boolean` | `false` | Hides the toolbar without disabling shortcuts. |
| `showStats` | `boolean` | `true` | Shows line, word, and character counts. |
| `variant` | `"default" \| "paper"` | `"default"` | Matches the editor surface to its parent. |
| `fill` | `boolean` | `false` | Fills the available parent height instead of using `lines`. |

Native form and accessibility properties include `name`, `id`, `ariaLabel`, `ariaDescribedBy`, `ariaInvalid`, and `ariaRequired`.

## Save controls

Pass `onSave` to add a save action and enable <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>S</kbd>.

`saveDisabled` and `saving` are reactive accessors. `toolbarTrailing` adds related controls beside the save action.

Persistence remains outside the component. Debounce or queue writes in the owning application.

## Completions

`abbreviations` provides fixed short-to-long expansions. `completions` supports synchronous or asynchronous suggestions, optional trigger characters, dropdown suggestions, and ghost previews.

When both are present, abbreviations run first and the explicit completion definitions are appended.

Completions do not expand inside inline code or fenced code blocks.

## Editing behavior

The editor keeps a native textarea as the input surface. A synchronized presentation layer provides markdown highlighting without replacing browser selection, composition, or undo behavior.

It includes formatting shortcuts, list continuation, smart URL paste, IME-safe input, and synchronized scrolling.

## Accessibility

Provide `ariaLabel` when no visible label points to the editor. Use `ariaDescribedBy` for help or error text and `ariaInvalid` for invalid state.

The toolbar uses one tab stop and arrow-key navigation. Formatting buttons expose their active state. The presentation layer is hidden from assistive technology.

## Runtime

`MarkdownEditor` is interactive and must run in hydrated Solid client code. The surrounding page can remain server rendered.

## Example

```tsx
const [body, setBody] = createSignal("");

<MarkdownEditor
  ariaLabel="Note"
  value={body}
  onInput={setBody}
  lines={10}
  placeholder="Write a note…"
/>;
```
