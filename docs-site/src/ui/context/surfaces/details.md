# Description list

`DescriptionList` presents exact key-value information with native description-list semantics.

## Use DescriptionList

Use it for metadata, summaries, and compact detail panels. In `layout="rows"`, a
value may contain one compact control such as a status or assignee picker when
that control has its own accessible name. Use a normal form layout for broader
editing, and do not use the component for arbitrary card layouts.

## Import

```tsx
import { Button, DescriptionList } from "@k2b/ui";
```

## Layout

`columns` controls the wide-screen grid and collapses to one column on narrow screens. Set `layout="rows"` for a compact inspector-style label/value list. An item may provide one short action directly related to its value.

## Accessibility

The component renders real `dl`, `dt`, and `dd` elements. Terms must be concise, descriptions must remain meaningful without visual position, and icon-only actions need labels.

## Runtime

Description lists are server-renderable and need no client JavaScript unless an item action is interactive.

## Example

```tsx
<DescriptionList
  columns={2}
  items={[
    { term: "Owner", description: "Platform team" },
    { term: "Region", description: "Europe West" },
    { term: "Repository", description: "cloud", action: <Button size="xs">Open</Button> },
  ]}
/>
```
