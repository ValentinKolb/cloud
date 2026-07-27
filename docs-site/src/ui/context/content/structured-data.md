# StructuredDataPreview

`StructuredDataPreview` presents one small JSON-like value as key-value rows or formatted JSON. The caller owns the data and decides which fields are safe to expose.

## Use StructuredDataPreview

Use it for metadata, labels, dimensions, request details, and compact payloads.

Use `DataTable` for a record set. Use `CodeDisplay` when raw JSON is the primary artifact rather than an alternate view.

## Import

```tsx
import {
  StructuredDataPreview,
  type StructuredDataPreviewProps,
} from "@valentinkolb/cloud/ui";
```

## Data and modes

`data` accepts any JSON-like value. Objects become key-value rows, arrays use their indexes as keys, and primitive values appear under `value`.

The initial mode is `formatted`. Set `defaultMode="raw"` when JSON structure matters more than scanning individual fields. Readers can switch between both modes.

`maxRows` limits the formatted view and reports how many rows are hidden. It is a presentation limit, not pagination or data minimization. Remove secrets and restricted fields before passing the value.

Use `empty` to replace the default **No data.** message. Set `copy={false}` when copying the raw value is inappropriate.

## Accessibility

Keys and values are visible text. Nested values are serialized instead of communicated only through color or shape.

Give the preview a nearby heading, or use `title`, so the value has context. A hidden-row count must not hide information required to complete the task.

## Runtime

The selected initial mode and its content render on the server. Switching modes and copying raw JSON require hydration.

The component does not fetch, redact, validate, or persist data.

## Example

```tsx
<StructuredDataPreview
  title="Delivery metadata"
  data={{
    channel: "email",
    attempt: 2,
    labels: {
      environment: "production",
      queue: "transactional",
    },
  }}
  maxRows={6}
/>
```
