# PanelDialog

`PanelDialog` is the layout shell for a complex editor. It keeps the header and footer fixed while the body scrolls.

It does not open a dialog, own form state, validate fields, or save data.

## Use PanelDialog

Use it for editors with several related field groups or a stable action footer.

Use `prompts.form` for a small form. Use `prompts.dialog` for a simple picker. Use `SettingsModal` for tabbed resource settings.

## Import

```tsx
import {
  dialogCore,
  PanelDialog,
  panelDialogOptions,
  TextInput,
} from "@valentinkolb/cloud/ui";
```

## Choose the dialog frame

Open the shell with `dialogCore.open`.

- `panelDialogOptions` fits one contained editor to its content.
- `panelDialogFixedOptions` keeps a stable height while tabs or progressive sections change.
- `panelDialogWorkspaceOptions` provides a large work area.

`surface="contained"` is the default modal treatment. `surface="floating"` makes the header, footer, and each section separate paper surfaces for settings-style pages.

Use `PanelDialog.Section` for meaningful field groups. Keep the primary save action in `PanelDialog.Footer`.

Use `PanelDialog.Tabs` only for local views within the editor. Its `value` is an accessor and the application updates it through `onChange`.

## Close ownership

Pass the dialog's `close` callback to `PanelDialog.Header`.

If the editor can be dirty, call `confirmDiscardIfDirty` before closing. The application decides what counts as dirty.

`dialogCore` owns the backdrop, focus handling, and Escape behavior. Do not create a second dialog frame around `PanelDialog`.

## Accessibility

Give the header and every section a clear title and icon. Header actions need their own accessible names.

Tabs use pressed buttons inside a labelled group. Pass `ariaLabel` when the default `Dialog tabs` does not describe the choices.

## Runtime

`PanelDialog` can render layout on the server, but dialogs, tabs, close controls, and form mutations require hydrated client code.

## Example

```tsx
await dialogCore.open<void>(
  (close) => (
    <PanelDialog>
      <PanelDialog.Header
        title="Edit item"
        icon="ti ti-pencil"
        close={close}
      />
      <PanelDialog.Body scrollPreserveKey="item-editor">
        <PanelDialog.Section
          title="Basics"
          icon="ti ti-id"
        >
          <TextInput label="Title" value={title} onInput={setTitle} />
        </PanelDialog.Section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <button class="btn-secondary btn-sm" onClick={close}>Cancel</button>
        <button class="btn-primary btn-sm" onClick={save}>Save</button>
      </PanelDialog.Footer>
    </PanelDialog>
  ),
  panelDialogOptions,
);
```
