# Settings

`SettingsPage` is the flat shell for a dedicated settings route. It owns one
page heading, a scrolling content region, optional header actions, and an
optional fixed footer. It deliberately adds no outer card or dialog frame.

`SettingsModal` is a portable tabbed settings surface. It owns category
navigation, keyboard behavior, and the active panel. The application owns
loading, form state, validation, persistence, and the surrounding dialog or
page.

## Use SettingsModal

Use `SettingsPage` for a full settings route. Use `SettingsModal` when one
resource has several settings categories. Use `PanelDialog` for an actual
dialog or complex embedded editor and `prompts.form` for a small prompt.

## Import

```tsx
import {
  readSettingsError,
  sameSettingValue,
  SettingsField,
  SettingsModal,
  SettingsPage,
  SettingsPanelFooter,
  SettingsSaveBar,
  SettingsSection,
  TextInput,
} from "@k2b/ui";
```

## Compose a full settings page

Keep the page flat: place section cards directly in `SettingsPage`, and put
save state in `footer`. Do not wrap a dedicated route in `PanelDialog` merely
to create another outer surface.

```tsx
<SettingsPage
  title="Project settings"
  subtitle="Identity and defaults"
  icon="ti ti-settings"
  actions={<Button variant="secondary">Test connection</Button>}
  footer={<SettingsPanelFooter {...saveState} />}
>
  <SettingsSection title="Identity" icon="ti ti-id">
    <SettingsField {...fieldProps}>…</SettingsField>
  </SettingsSection>
</SettingsPage>
```

`SettingsSection` is the page-level paper surface for a coherent settings
group. It provides one accessible section heading, optional actions, and the
same compact rhythm as Cloud admin data panels. Keep `PanelDialog.Section`
inside dialogs; it intentionally has a different containment contract.

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
actions until a change exists, and accepts `saveClass="btn-primary"` when the
host needs the Cloud primary-action utility.

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
