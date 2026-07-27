# Toast

`toast` shows transient feedback in a responsive stack. The application supplies the message and decides whether the result is informational, successful, or failed.

## Use toast

Use a toast after a non-blocking action when the user can continue without responding.

Use `prompts` when work must pause for acknowledgement or a decision. Keep failures visible in the page when they prevent the user from completing the current task.

## Import

```ts
import {
  toast,
  type ToastHandle,
  type ToastOptions,
} from "@valentinkolb/cloud/ui";
```

## Show a toast

```ts
toast("Settings were updated");
toast.success("File uploaded");
toast.error("Upload failed");
```

The first argument is the description. The default titles are `Info`, `Success`, and `Error`.

## Properties

| Property | Type | Default | Purpose |
| --- | --- | --- | --- |
| `variant` | `"default" \| "success" \| "error"` | `"default"` | Selects the semantic treatment. |
| `title` | `string` | variant title | Overrides the title. |
| `duration` | `number` | `3000` | Sets auto-dismiss time in milliseconds. `0` creates a sticky toast. |
| `iconClass` | `string` | variant icon | Overrides the Tabler icon class. |
| `action` | `{ label: string; href: string } \| null` | none | Adds or removes a navigation link. |

At most five toasts remain visible. Adding another dismisses the oldest.

## Update or dismiss

Every call returns a handle:

```ts
const upload = toast("0%", {
  title: "Uploading",
  duration: 0,
});

upload.update("50%");
upload.update("Upload complete", {
  variant: "success",
  title: "Done",
  duration: 2_000,
});

upload.dismiss();
```

`update` always replaces the description. Only option keys that are present replace existing options. Updating resets the auto-dismiss timer.

Use `toast.dismissAll()` when navigation or a major context change would make existing messages stale.

## Actions

Toast actions are links. Use them to open a destination related to the completed operation.

Do not place a destructive action in a toast. Ask for confirmation before the operation.

## Accessibility

Toast content uses a polite, atomic status live region. A visible close button is always present. Auto-dismiss pauses while the toast is hovered or contains keyboard focus.

Messages must identify the affected operation. Avoid “Success” as the description because the title already states the variant.

## Runtime

`toast` is a browser API. Calls made without `document`, including during SSR, return a no-op handle.

The toast rail uses the browser top layer when available so feedback remains visible above dialogs. A toast displayed over a modal is read-only until the modal closes because the browser makes content outside the modal inert.

## Example

```ts
toast.success("Item moved", {
  title: "Moved to Archive",
  action: {
    label: "Open Archive",
    href: "/app/files/archive",
  },
  duration: 8_000,
});
```
