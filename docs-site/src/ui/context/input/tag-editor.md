# Tag editing

`Tag`, `TagEditor`, and `MultiSelectInput` separate presentation, entity management, and assignment.

## Use tag editing

Use `TagEditor` for managed tag entities with stable ids. Use `MultiSelectInput` to assign existing ids. Keep `TagsInput` for a freeform comma-separated string list.

## Import

```tsx
import { MultiSelectInput, Tag, TagEditor, type TagEditorItem } from "@k2b/ui";
```

## Ownership

`Tag` owns compact passive and selected presentation. Set `selected` when the
surrounding control represents the current value; the selected treatment uses
a stronger surface and replaces an optional icon with a check, so it does not
depend on color alone. `Tag` remains presentation-only: the surrounding link or
button owns `href`, activation, `aria-current`, or `aria-pressed`.

`TagEditor` is controlled and backend-free. It owns create/edit/delete interaction, busy state, focus, and inline errors. The application owns persistence, authorization, uniqueness, confirmation, toasts, sorting, and reconciliation. A rejected async callback keeps the editor open. A missing callback hides that capability.

`MultiSelectInput` accepts `renderOption` and `renderValue` for richer labels while retaining the package-owned selection and removal semantics.

## Accessibility

Edit and delete buttons name the affected tag. Forms use the common field contract and announce errors. Do not rely on tag color alone; keep a readable name.

## Runtime

Interactive editing and selection require hydration. The initial list and tags render on the server.

## Example

```tsx
<Tag color="#2563eb" icon="ti ti-point" selected size="lg">
  Platform
</Tag>

<TagEditor
  items={tags()}
  onCreate={createTag}
  onUpdate={updateTag}
  onDelete={async (tag) => {
    if (await confirmDelete(tag)) await deleteTag(tag);
  }}
/>

<MultiSelectInput
  label="Assigned tags"
  value={tagIds}
  onValueChange={setTagIds}
  options={tags().map((tag) => ({ value: tag.id, label: tag.name, color: tag.color }))}
/>
```
