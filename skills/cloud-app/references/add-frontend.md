# Additional Frontend Notes

## `Layout.Help`

Use `Layout.Help` from `@valentinkolb/cloud/ssr/islands` inside an app island to add app-specific tabs to the global help dialog. The platform always adds the Shortcuts tab; apps only register their own content.

```tsx
import { Layout } from "@valentinkolb/cloud/ssr/islands";

export default function AppHelp() {
  return (
    <Layout.Help
      id="files-help"
      title="Files"
      icon="ti ti-folder"
      description="Upload, share, and manage files."
      order={100}
    >
      <p class="text-sm text-dimmed">Short, app-specific help content.</p>
    </Layout.Help>
  );
}
```

Render the registrar once on the app page. It returns `null`, owns no app state, and unregisters on cleanup. Keep large app help in app-owned components; the global shell only handles tabs, the bare modal, shortcuts, and last-tab persistence.

## `CodeDisplay`

Use `CodeDisplay` from `@valentinkolb/cloud/ui` for copyable examples in help pages, docs panels, and UI demos. It provides a shared shell, icon-only copy action, optional line numbers, and small dependency-free highlighting.

```tsx
<CodeDisplay
  title="Named table"
  language="markdown"
  code={`@ideas
| Idea | Status |
|---|---|
| Build demo | active |`}
  copy
  lineNumbers
/>
```

Supported `language` values are `ts`, `tsx`, `js`, `jsx`, `script`, `markdown`, `md`, and `text`. Use `text` for examples that should only be escaped, not highlighted. Keep the component for display-only snippets; editable code belongs in an editor component.

## `CheckboxCard`

Use `CheckboxCard` from `@valentinkolb/cloud/ui` when checkbox options need more scanable context than a plain inline checkbox: option title, optional description, and optional icon or color dot.

```tsx
import { CheckboxCard } from "@valentinkolb/cloud/ui";

<CheckboxCard
  label="Notify assignee"
  description="Send an email when this status is selected."
  icon="ti ti-bell"
  value={() => notifyAssignee()}
  onChange={setNotifyAssignee}
/>
```

Use `color="#3b82f6"` instead of `icon` for select-like options with configured colors. Keep the card for explicit option lists; dense boolean settings should stay with the regular checkbox or switch input.

## `SettingsModal`

Use `SettingsModal` from `@valentinkolb/cloud/ui` for app settings dialogs that need a shared header, tab navigation, and one active content panel.

```tsx
<SettingsModal title="Notebook settings" subtitle={notebook.name} icon={notebook.icon} onClose={close}>
  <SettingsModal.Tab
    id="general"
    icon="ti ti-id"
    title="General"
    description="Name, icon, description, and start page."
  >
    <GeneralSettings />
  </SettingsModal.Tab>
</SettingsModal>
```

The component owns only layout and active-tab state. Keep saving, dirty state, permissions, and mutations in the app. Use `tone="danger"` for destructive sections.

## `AppOverview`

Use `AppOverview` from `@valentinkolb/cloud/ui` for app start pages that show a consistent header plus a main content area and a create/templates side panel.

```tsx
<AppOverview title="Notebooks" subtitle="Collaborative notes and scripts." icon="ti ti-note">
  <AppOverview.Main title="Your notebooks" description="3 notebooks" toolbar={<TextInput type="search" />}>
    <NotebookCards />
  </AppOverview.Main>

  <AppOverview.Aside title="Create" description="Choose a starter, or start blank.">
    <TemplateButtons />
  </AppOverview.Aside>
</AppOverview>
```

The component is only a visual shell. Keep search state, URL params, API calls, mutations, cards, and template behavior in the consuming app. Use `AppOverview.EmptyState` for matching empty/search-empty panels.

## `AppWorkspace`

Use `AppWorkspace` from `@valentinkolb/cloud/ui` for full-height app screens with a left sidebar, main work area, and optional right detail panel. Prefer the compound components over hand-written sidebar/detail classes.

```tsx
<AppWorkspace>
  <AppWorkspace.Sidebar>
    <AppWorkspace.SidebarHeader title="Files" icon="ti ti-folders" />
    <AppWorkspace.SidebarMobile>
      <AppWorkspace.SidebarMobileItems>
        <AppWorkspace.SidebarItem href="/app/files/search" icon="ti ti-search" active>
          Search
        </AppWorkspace.SidebarItem>
      </AppWorkspace.SidebarMobileItems>
    </AppWorkspace.SidebarMobile>
    <AppWorkspace.SidebarDesktop>
      <AppWorkspace.SidebarSection title="Navigation">
        <AppWorkspace.SidebarItem href="/app/files/search" icon="ti ti-search" active>
          Search
        </AppWorkspace.SidebarItem>
      </AppWorkspace.SidebarSection>
      <AppWorkspace.SidebarBody>{/* tree or long nav */}</AppWorkspace.SidebarBody>
      <AppWorkspace.SidebarFooter>{/* pinned actions */}</AppWorkspace.SidebarFooter>
    </AppWorkspace.SidebarDesktop>
  </AppWorkspace.Sidebar>

  <AppWorkspace.Main>{/* app content */}</AppWorkspace.Main>

  <AppWorkspace.Detail open={hasSelection} width="md">
    {/* app-specific detail content using detail-section */}
  </AppWorkspace.Detail>
</AppWorkspace>
```

`SidebarItem` owns active, mobile, icon, meta, and tone styling. Keep detail close behavior and URL/event state in the app; `AppWorkspace.Detail` is only the shell.
