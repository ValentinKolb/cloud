# SettingsModal

`SettingsModal` is the tabbed shell for resource settings. It owns the category rail, active panel, keyboard tab behavior, and scrolling frame.

The application owns loading, form state, validation, persistence, and close decisions.

## Use SettingsModal

Use it when one resource has several settings categories.

Use `PanelDialog` for one complex editor with grouped fields. Use `prompts.form` for a small prompt with only a few fields.

## Import

```tsx
import {
  prompts,
  SettingsField,
  SettingsModal,
  SettingsPanelFooter,
  SettingsSaveBar,
} from "@valentinkolb/cloud/ui";
```

## Open the settings surface

Open `SettingsModal` in a bare prompt dialog. Wrap it in `dialog-fixed-frame` so tabs with different content heights do not resize the dialog.

Open the shell before loading remote data. Fetch one typed settings context inside it and keep loading and error fallbacks in the same fixed frame.

`title` is the accessible name of the settings region. It is not a visible banner. The compatibility properties `subtitle` and `icon` are deprecated.

The active tab can be uncontrolled with `defaultTab` or controlled with `activeTab` and `onTabChange`.

## Form helpers

`SettingsField` displays one field label, description, error, and explicit unsaved state. The input remains responsible for its own label and accessibility properties.

Use `SettingsSaveBar` for a page form. Use `SettingsPanelFooter` inside `PanelDialog.Footer`.

Both save helpers receive reactive `changeCount` and `loading` accessors. The application implements discard and save.

## Accessibility

The category rail is a tab list. Arrow keys move between tabs. Home and End move to the first and last tab.

Each tab needs a unique `id` and a concise title. Use `tone="danger"` only for destructive settings.

## Runtime

The first active panel renders on the server. Tab selection, close controls, and form helpers require hydrated Solid code.

Do not add settings data to the workspace SSR payload only to open a dialog later.

## Example

```tsx
await prompts.dialog<void>(
  (close) => (
    <div class="dialog-fixed-frame flex min-h-0 flex-col overflow-hidden">
      <SettingsModal title="Notebook settings" onClose={close}>
        <SettingsModal.Tab
          id="general"
          title="General"
          description="Name and metadata"
          icon="ti ti-settings"
        >
          <GeneralSettings />
        </SettingsModal.Tab>
        <SettingsModal.Tab
          id="danger"
          title="Danger"
          description="Delete this notebook"
          icon="ti ti-alert-triangle"
          tone="danger"
        >
          <DeleteNotebook />
        </SettingsModal.Tab>
      </SettingsModal>
    </div>
  ),
  { surface: "bare", header: false, size: "large" },
);
```
