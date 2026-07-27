# TagsInput

`TagsInput` edits a controlled list of short text values. The parent owns the tags, validation, and persistence.

## Use TagsInput

Use it when people enter a small set of free-form labels.

Use a select component when values must come from a fixed catalogue.

## Import

```tsx
import { TagsInput } from "@valentinkolb/cloud/ui";
```

## State and input

Pass the current `string[]` as a Solid accessor through `value`. `onChange` receives the complete next array.

The editor accepts comma-separated text. It commits on blur or Enter, trims and collapses whitespace, removes empty entries, and removes exact duplicates.

Relevant properties are `label`, `description`, `placeholder`, `icon`, `activeIcon`, `value`, `onChange`, `error`, `required`, and `disabled`.

## Accessibility

Provide `label` for a visible field name. Without one, the placeholder becomes the accessible name.

Descriptions and reactive errors are connected to the editable field. Added and removed tags are announced through a polite live region.

## Runtime

`TagsInput` uses a content-editable field and must run in hydrated Solid client code.

## Example

```tsx
const [tags, setTags] = createSignal(["backend", "ui"]);

<TagsInput
  label="Labels"
  placeholder="Add tags separated by commas"
  value={tags}
  onChange={setTags}
/>;
```
