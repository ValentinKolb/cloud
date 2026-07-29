# SettingsModal

`SettingsModal` is a portable tabbed settings surface. It owns category
navigation, keyboard behavior, and the active panel. The application owns
loading, form state, validation, persistence, and the surrounding dialog or
page.

## Use SettingsModal

Use it when one resource has several settings categories. Use `PanelDialog`
for one complex editor and `prompts.form` for a small prompt.

## Import

```tsx
import {
  readSettingsError,
  sameSettingValue,
  SettingsField,
  SettingsModal,
  SettingsPanelFooter,
  SettingsSaveBar,
  TextInput,
} from "@k2b/ui";
```

## Compose controlled tabs

Compose categories with `SettingsModal.Tab`. Each tab needs a stable `id`,
title, and children. `activeTab` and `onTabChange` make selection controlled;
use `defaultTab` for local selection. An optional `onClose` adds a close action
without deciding how the surrounding surface is opened.

`subtitle` and `icon` remain accepted on `SettingsModal` for source
compatibility, but category titles, descriptions, and icons provide the visible
context.

## Compose form state

`SettingsField` groups a label, required description, reactive error accessor,
optional reactive dirty accessor, and a control.

`SettingsSaveBar` uses reactive `changeCount` and `loading` accessors. It
appears only while the count is greater than zero and disables its actions
while loading.

`SettingsPanelFooter` provides the same status and actions for a surrounding
panel footer. It remains visible with `No unsaved changes`, disables both
actions until a change exists, and accepts `saveClass="btn-primary"` or
`saveClass="btn-ai"`.

`sameSettingValue` performs the JSON-based, order-sensitive comparison used by
settings forms. `readSettingsError(response, fallback)` reads the shared
`message` and per-field `errors` response shape. These helpers do not perform a
request or select a persistence backend.

## Accessibility

The category rail is a tab list. Arrow keys move between tabs; Home and End
move to the first and last tab. Every tab needs a stable `id` and concise
title. Use `tone="danger"` only for destructive settings.

Errors render as alerts, and the dirty state includes an explicit `Unsaved`
label rather than relying on color.

## Runtime

The active panel renders on the server. Tab selection, close controls, form
callbacks, and saving require hydrated Solid code.

## Example

```tsx
const [active, setActive] = createSignal("general");
const [endpoint, setEndpoint] = createSignal("https://example.test");
const [initialEndpoint, setInitialEndpoint] = createSignal(endpoint());
const [loading, setLoading] = createSignal(false);
const changed = () => !sameSettingValue(endpoint(), initialEndpoint());

<SettingsModal
  title="Application settings"
  activeTab={active()}
  onTabChange={setActive}
>
  <SettingsModal.Tab
    id="general"
    title="General"
    icon="ti ti-settings"
  >
    <SettingsField
      label="Endpoint"
      description="Public service URL"
      error={() => errors().endpoint}
      changed={changed}
    >
      <TextInput
        value={endpoint()}
        onValueChange={setEndpoint}
      />
    </SettingsField>
  </SettingsModal.Tab>

  <SettingsModal.Tab
    id="danger"
    title="Danger"
    icon="ti ti-alert-triangle"
    tone="danger"
  >
    <p>Destructive settings</p>
  </SettingsModal.Tab>
</SettingsModal>

<SettingsSaveBar
  changeCount={() => (changed() ? 1 : 0)}
  loading={loading}
  onDiscard={() => setEndpoint(initialEndpoint())}
  onSave={async () => {
    setLoading(true);
    await saveEndpoint(endpoint());
    setInitialEndpoint(endpoint());
    setLoading(false);
  }}
/>;
```
