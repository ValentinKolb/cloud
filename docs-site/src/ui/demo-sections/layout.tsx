import {
  AppOverview,
  AppWorkspace,
  Avatar,
  Button,
  createPanesValue,
  DataPanel,
  DescriptionList,
  DetailPanel,
  Discussion,
  FloatingWindow,
  IconButton,
  MarkdownEditor,
  MarkdownView,
  Pagination,
  PanelDialog,
  PanelHeader,
  Panes,
  Select,
  SelectChip,
  SettingsCollection,
  SettingsField,
  SettingsGroup,
  SettingsModal,
  SettingsPage,
  SettingsPanelFooter,
  SettingsSection,
  StatusBadge,
  Tag,
  TextInput,
  Toolbar,
} from "@k2b/ui";
import { createSignal, Show } from "solid-js";
import { DemoCard } from "../DemoCard";
import { DemoGrid, type DemoSection } from "./types";

const WorkspaceDemo = () => {
  const [activeView, setActiveView] = createSignal("available");
  const [expandedNavigation, setExpandedNavigation] = createSignal<readonly string[]>(["items", "tags"]);
  const [paneOpen, setPaneOpen] = createSignal(false);
  const [detailOpen, setDetailOpen] = createSignal(true);
  const [drawerOpen, setDrawerOpen] = createSignal(true);
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
  const togglePane = () => setPaneOpen((open) => !open);
  const toggleDetail = () => setDetailOpen((open) => !open);
  const workspace = (collapsed: boolean) => (
    <AppWorkspace
      layoutState={() => ({ version: 2, sidebarWidth: 208, sidebarCollapsed: collapsed })}
      onLayoutChange={(state) => setSidebarCollapsed(Boolean(state.sidebarCollapsed))}
    >
      <AppWorkspace.Sidebar collapsible>
        <AppWorkspace.SidebarMobileTrigger label="Inventory" />
        <AppWorkspace.SidebarDesktop>
          <AppWorkspace.SidebarBody>
            <AppWorkspace.SidebarSection title="Status">
              <AppWorkspace.SidebarItem>
                <AppWorkspace.SidebarItemIcon icon="ti ti-message" />
                <AppWorkspace.SidebarItemLabel>Processing issue</AppWorkspace.SidebarItemLabel>
                <AppWorkspace.SidebarItemMeta>
                  <span class="inline-flex items-center" title="Processing failed">
                    <i class="ti ti-alert-circle text-red-500" aria-hidden="true" />
                    <span class="sr-only">Processing failed</span>
                  </span>
                </AppWorkspace.SidebarItemMeta>
                <AppWorkspace.SidebarItemAction icon="ti ti-settings" label="Issue settings" visibility="hover" />
              </AppWorkspace.SidebarItem>
            </AppWorkspace.SidebarSection>
            <AppWorkspace.NavTree
              ariaLabel="Inventory navigation"
              selectedId={activeView()}
              expandedIds={expandedNavigation()}
              onSelectedIdChange={setActiveView}
              onExpandedIdsChange={setExpandedNavigation}
            >
              <AppWorkspace.NavTree.Item id="items" label="Items" icon="ti ti-folder" expandedIcon="ti ti-folder-open" meta={12}>
                <AppWorkspace.NavTree.Item
                  id="available"
                  label="Available"
                  icon="ti ti-circle-check"
                  meta={8}
                  actions={
                    <AppWorkspace.SidebarItemActions visibility="hover">
                      <IconButton size="xs" label="Pin available items">
                        <i class="ti ti-pin" />
                      </IconButton>
                      <IconButton size="xs" label="Available item actions">
                        <i class="ti ti-dots" />
                      </IconButton>
                    </AppWorkspace.SidebarItemActions>
                  }
                />
                <AppWorkspace.NavTree.Item id="maintenance" label="Maintenance" icon="ti ti-tool" meta={4} />
              </AppWorkspace.NavTree.Item>
              <AppWorkspace.NavTree.Item id="activity" label="Activity" icon="ti ti-history" />
              <AppWorkspace.NavTree.Item id="tags" label="Tags" icon="ti ti-tags">
                <AppWorkspace.NavTree.Item id="ready" label="Ready" icon="ti ti-tag" meta={8} />
                <AppWorkspace.NavTree.Item id="repair" label="Repair" icon="ti ti-tag" meta={4} />
              </AppWorkspace.NavTree.Item>
            </AppWorkspace.NavTree>
          </AppWorkspace.SidebarBody>
          <AppWorkspace.SidebarFooter>
            <AppWorkspace.SidebarItem icon="ti ti-settings">Settings</AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarFooter>
        </AppWorkspace.SidebarDesktop>
        <AppWorkspace.SidebarMobile>
          <AppWorkspace.SidebarMobileItems>
            <AppWorkspace.SidebarItem active={activeView() === "available"} icon="ti ti-list" onClick={() => setActiveView("available")}>
              Items
            </AppWorkspace.SidebarItem>
            <AppWorkspace.SidebarItem active={activeView() === "activity"} icon="ti ti-history" onClick={() => setActiveView("activity")}>
              Activity
            </AppWorkspace.SidebarItem>
            <AppWorkspace.SidebarItem icon="ti ti-settings">Settings</AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarMobileItems>
        </AppWorkspace.SidebarMobile>
      </AppWorkspace.Sidebar>
      <AppWorkspace.Content>
        <AppWorkspace.Main mobilePane="main">
          <div class="ui-demo-pane">
            <div class="ui-workspace-demo__body">
              <strong>{activeView() === "activity" ? "Recent activity" : `Inventory · ${activeView()}`}</strong>
              <span>Main 1</span>
              <div class="ui-workspace-demo__actions">
                <Button size="sm" variant="secondary" onClick={() => setSidebarCollapsed(!collapsed)}>
                  {collapsed ? "Expand navigation" : "Collapse navigation"}
                </Button>
                <Button size="sm" variant="secondary" onClick={togglePane}>
                  {paneOpen() ? "Hide Main 2" : "Show Main 2"}
                </Button>
                <Button size="sm" variant="secondary" onClick={toggleDetail}>
                  {detailOpen() ? "Hide detail" : "Show detail"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setDrawerOpen((open) => !open)}>
                  {drawerOpen() ? "Hide events" : "Show events"}
                </Button>
              </div>
            </div>
          </div>
          <AppWorkspace.MainPane id="main-2" label="Main 2" open={paneOpen()}>
            <div class="ui-demo-pane">Main 2</div>
          </AppWorkspace.MainPane>
        </AppWorkspace.Main>
        <AppWorkspace.Detail id="record" open={detailOpen()} width="sm">
          <div class="ui-demo-pane">Selected item</div>
        </AppWorkspace.Detail>
      </AppWorkspace.Content>
      <AppWorkspace.BottomDrawer id="events" open={drawerOpen()} height="sm">
        <div class="ui-demo-pane">Recent events</div>
      </AppWorkspace.BottomDrawer>
    </AppWorkspace>
  );

  return (
    <DemoCard
      id="workspace"
      chip={{ kind: "component", name: "AppWorkspace", from: "@k2b/ui" }}
      description="A portable application frame with responsive navigation, peer panes, contextual detail, a bottom drawer, and pointer and keyboard resizing."
      code={`const [layout, setLayout] = createSignal<AppWorkspaceLayoutState>({ version: 2, sidebarWidth: 208 });
const [active, setActive] = createSignal("available");
const [expanded, setExpanded] = createSignal(["items"]);
const [paneOpen, setPaneOpen] = createSignal(false);
const [detailOpen, setDetailOpen] = createSignal(true);
const [drawerOpen, setDrawerOpen] = createSignal(true);

<AppWorkspace layoutState={layout} onLayoutChange={setLayout}>
  <AppWorkspace.Sidebar collapsible>
    <AppWorkspace.NavTree
      ariaLabel="Inventory navigation"
      selectedId={active()}
      expandedIds={expanded()}
      onSelectedIdChange={setActive}
      onExpandedIdsChange={setExpanded}
    >
      <AppWorkspace.NavTree.Item id="items" label="Items" icon="ti ti-folder" expandedIcon="ti ti-folder-open">
        <AppWorkspace.NavTree.Item id="available" label="Available" meta={8} />
        <AppWorkspace.NavTree.Item id="maintenance" label="Maintenance" meta={4} />
      </AppWorkspace.NavTree.Item>
      <AppWorkspace.NavTree.Item id="activity" label="Activity" icon="ti ti-history" />
    </AppWorkspace.NavTree>
  </AppWorkspace.Sidebar>
  <AppWorkspace.Content>
    <AppWorkspace.Main>
      <AppWorkspace.MainPane id="main-2" label="Main 2" open={paneOpen()}>…</AppWorkspace.MainPane>
      …
    </AppWorkspace.Main>
    <AppWorkspace.Detail id="record" open={detailOpen()} width="sm">…</AppWorkspace.Detail>
  </AppWorkspace.Content>
  <AppWorkspace.BottomDrawer id="events" open={drawerOpen()} height="sm">…</AppWorkspace.BottomDrawer>
</AppWorkspace>`}
    >
      <div class="ui-workspace-demo">
        <Show when={sidebarCollapsed()} fallback={workspace(false)}>
          {workspace(true)}
        </Show>
      </div>
    </DemoCard>
  );
};

const PanesDemo = () => {
  const [value, setValue] = createSignal(createPanesValue(["source", "preview", "data"]));
  return (
    <DemoCard
      id="panes"
      chip={{ kind: "component", name: "Panes", from: "@k2b/ui" }}
      description="A controlled, serializable tree of tabs and splits with resize, reorder, move, split, and close behavior."
      code={`const [layout, setLayout] = createSignal(createPanesValue(["source", "preview", "data"]));
<Panes.Root value={layout()} onValueChange={setLayout} label="Editor panes">
  <Panes.Element id="source" title="Source" icon="ti ti-code">…</Panes.Element>
  <Panes.Element id="preview" title="Preview" icon="ti ti-eye">…</Panes.Element>
  <Panes.Element id="data" title="Data" icon="ti ti-database">…</Panes.Element>
</Panes.Root>`}
    >
      <div class="ui-panes-demo">
        <Panes.Root value={value()} onValueChange={setValue} label="Editor panes">
          <Panes.Element id="source" title="Source" icon="ti ti-code">
            <div class="ui-pane-body" data-tone="blue">
              <span>Source</span>
            </div>
          </Panes.Element>
          <Panes.Element id="preview" title="Preview" icon="ti ti-eye">
            <div class="ui-pane-body" data-tone="violet">
              <span>Preview</span>
            </div>
          </Panes.Element>
          <Panes.Element id="data" title="Data" icon="ti ti-database">
            <div class="ui-pane-body" data-tone="emerald">
              <span>Data</span>
            </div>
          </Panes.Element>
        </Panes.Root>
      </div>
    </DemoCard>
  );
};

const OverviewDemo = () => (
  <DemoCard
    id="overview"
    chip={{ kind: "component", name: "AppOverview", from: "@k2b/ui" }}
    description="An application landing page with a required identity icon, a strong main task, and a quieter supporting panel."
    code={`<AppOverview title="Projects" subtitle="Portable application overview" icon="ti ti-folders">
  <AppOverview.Main title="Recent work" description="Updated today">
    <AppOverview.EmptyState title="No recent projects" description="Open a project to see it here." icon="ti ti-folder-off">
      <Button size="sm">New project</Button>
    </AppOverview.EmptyState>
  </AppOverview.Main>
  <AppOverview.Aside title="Workspace status">…</AppOverview.Aside>
</AppOverview>`}
  >
    <AppOverview title="Projects" subtitle="Portable application overview" icon="ti ti-folders">
      <AppOverview.Main title="Recent work" description="Updated today">
        <AppOverview.EmptyState title="No recent projects" description="Open a project to see it here." icon="ti ti-folder-off">
          <Button size="sm">New project</Button>
        </AppOverview.EmptyState>
      </AppOverview.Main>
      <AppOverview.Aside title="Workspace status">
        <p>Everything is ready.</p>
      </AppOverview.Aside>
    </AppOverview>
  </DemoCard>
);

const DataPanelDemo = () => (
  <DemoCard
    id="data-panel"
    chip={[
      { kind: "component", name: "DataPanel", from: "@k2b/ui" },
      { kind: "component", name: "PanelHeader", from: "@k2b/ui" },
    ]}
    description="DataPanel frames records and their load states; PanelHeader supplies the reusable title, subtitle, and action row without adding another surface."
    code={`<DataPanel title="Deployments" subtitle="2 active" actions={<Button size="sm">New deployment</Button>} footer="Showing the latest deployments">
  <DeploymentRows />
</DataPanel>

<PanelHeader title="Runtime" subtitle="Healthy" actions={<Button size="sm" variant="secondary">Restart</Button>} />`}
  >
    <DataPanel
      title="Deployments"
      subtitle="2 active"
      actions={<Button size="sm">New deployment</Button>}
      footer="Showing the latest deployments"
    >
      <div class="ui-demo-pane">Deployment rows</div>
    </DataPanel>
    <div class="ui-demo-pane">
      <PanelHeader
        title="Runtime"
        subtitle="Healthy"
        actions={
          <Button size="sm" variant="secondary">
            Restart
          </Button>
        }
      />
    </div>
  </DemoCard>
);

const SettingsDemo = () => {
  const [active, setActive] = createSignal("preferences");
  const [savedPreferences, setSavedPreferences] = createSignal({ readingFormat: "automatic", composeFormat: "rich", undoSend: "10" });
  const [readingFormat, setReadingFormat] = createSignal(savedPreferences().readingFormat);
  const [composeFormat, setComposeFormat] = createSignal(savedPreferences().composeFormat);
  const [undoSend, setUndoSend] = createSignal(savedPreferences().undoSend);
  const changeCount = () => {
    const saved = savedPreferences();
    return (
      Number(readingFormat() !== saved.readingFormat) +
      Number(composeFormat() !== saved.composeFormat) +
      Number(undoSend() !== saved.undoSend)
    );
  };
  const loading = () => false;
  const discard = () => {
    const saved = savedPreferences();
    setReadingFormat(saved.readingFormat);
    setComposeFormat(saved.composeFormat);
    setUndoSend(saved.undoSend);
  };
  const save = () => setSavedPreferences({ readingFormat: readingFormat(), composeFormat: composeFormat(), undoSend: undoSend() });
  return (
    <DemoCard
      id="settings-modal"
      chip={[
        { kind: "component", name: "SettingsModal", from: "@k2b/ui" },
        { kind: "component", name: "SettingsGroup", from: "@k2b/ui" },
        { kind: "component", name: "SettingsCollection", from: "@k2b/ui" },
        { kind: "component", name: "SettingsField", from: "@k2b/ui" },
        { kind: "component", name: "SettingsPanelFooter", from: "@k2b/ui" },
      ]}
      description="Grouped category navigation, flat form groups, compact entity collections, empty states, item status and actions, and a panel-owned save footer."
      code={`<SettingsModal title="Mailbox settings" activeTab={active()} onTabChange={setActive}>
  <SettingsModal.Group title="Personal">
    <SettingsModal.Tab id="preferences" title="Preferences" icon="ti ti-adjustments" description="Defaults for this browser.">
      <SettingsGroup title="Reading" description="Choose how messages are displayed.">
        <SettingsField label="Message format" description="Choose the preferred representation for incoming messages." error={() => undefined} changed={() => readingFormat() !== savedPreferences().readingFormat}>
          <Select aria-label="Message format" value={readingFormat()} onValueChange={(value) => value && setReadingFormat(value)} options={[{ value: "automatic", label: "Automatic — Recommended" }, { value: "html", label: "HTML" }, { value: "plain", label: "Plain text" }]} />
        </SettingsField>
      </SettingsGroup>
      <SettingsGroup title="Writing" description="Defaults for new messages and replies.">
        <SettingsField label="Compose format" description="Used when you open the composer." error={() => undefined} changed={() => composeFormat() !== savedPreferences().composeFormat}>
          <Select aria-label="Compose format" value={composeFormat()} onValueChange={(value) => value && setComposeFormat(value)} options={[{ value: "rich", label: "Rich text" }, { value: "plain", label: "Plain text" }]} />
        </SettingsField>
        <SettingsField label="Undo send" description="Delay delivery so a message can still be recalled." error={() => undefined} changed={() => undoSend() !== savedPreferences().undoSend}>
          <Select aria-label="Undo send" value={undoSend()} onValueChange={(value) => value && setUndoSend(value)} options={[{ value: "0", label: "Off" }, { value: "5", label: "5 seconds" }, { value: "10", label: "10 seconds" }, { value: "30", label: "30 seconds" }]} />
        </SettingsField>
      </SettingsGroup>
      <SettingsModal.Footer>
        <SettingsPanelFooter changeCount={changeCount} loading={loading} onDiscard={discard} onSave={save} />
      </SettingsModal.Footer>
    </SettingsModal.Tab>
  </SettingsModal.Group>
  <SettingsModal.Group title="Mailbox">
    <SettingsModal.Tab id="organization" title="Organization" icon="ti ti-tags" description="Reusable views and shared vocabulary.">
      <SettingsCollection title="Saved views" description="Reusable filters shown in navigation." empty="No saved views yet.">
        <SettingsCollection.Action><Button size="xs">New view</Button></SettingsCollection.Action>
        <SettingsCollection.Item title="Open conversations" description="Private view · 3 filters" icon={<i class="ti ti-filter" />}>
          <SettingsCollection.Item.Status><StatusBadge tone="neutral" label="Private" variant="text" /></SettingsCollection.Item.Status>
          <SettingsCollection.Item.Actions><IconButton size="xs" label="Edit Open conversations"><i class="ti ti-pencil" /></IconButton></SettingsCollection.Item.Actions>
        </SettingsCollection.Item>
      </SettingsCollection>
      <SettingsCollection title="Conversation tags" description="Shared across views and automations." empty="No tags yet.">
        <SettingsCollection.Action><Button size="xs" variant="secondary">Add tag</Button></SettingsCollection.Action>
      </SettingsCollection>
    </SettingsModal.Tab>
    <SettingsModal.Tab id="delivery" title="Delivery" icon="ti ti-send" description="Accounts and sender identities.">
      <SettingsCollection title="Connected accounts" empty="No account connected.">
        <SettingsCollection.Item title="support@example.test" description="IMAP and SMTP" icon={<i class="ti ti-mail" />}>
          <SettingsCollection.Item.Status><StatusBadge tone="ok" label="Connected" /></SettingsCollection.Item.Status>
          <SettingsCollection.Item.Actions><Button size="xs" variant="ghost">Manage</Button></SettingsCollection.Item.Actions>
        </SettingsCollection.Item>
      </SettingsCollection>
    </SettingsModal.Tab>
  </SettingsModal.Group>
  <SettingsModal.Group title="Lifecycle">
    <SettingsModal.Tab id="danger" title="Danger zone" icon="ti ti-alert-triangle" tone="danger">
      <SettingsGroup title="Disable mailbox" description="Stop new mail without deleting retained messages.">
        <SettingsGroup.Action><Button size="sm" variant="danger">Disable mailbox</Button></SettingsGroup.Action>
      </SettingsGroup>
    </SettingsModal.Tab>
  </SettingsModal.Group>
</SettingsModal>`}
    >
      <div class="ui-settings-demo">
        <SettingsModal title="Mailbox settings" activeTab={active()} onTabChange={setActive}>
          <SettingsModal.Group title="Personal">
            <SettingsModal.Tab id="preferences" title="Preferences" icon="ti ti-adjustments" description="Defaults for this browser.">
              <SettingsGroup title="Reading" description="Choose how messages are displayed.">
                <SettingsField
                  label="Message format"
                  description="Choose the preferred representation for incoming messages."
                  error={() => undefined}
                  changed={() => readingFormat() !== savedPreferences().readingFormat}
                >
                  <Select
                    aria-label="Message format"
                    value={readingFormat()}
                    onValueChange={(value) => value && setReadingFormat(value)}
                    options={[
                      { value: "automatic", label: "Automatic — Recommended" },
                      { value: "html", label: "HTML" },
                      { value: "plain", label: "Plain text" },
                    ]}
                  />
                </SettingsField>
              </SettingsGroup>
              <SettingsGroup title="Writing" description="Defaults for new messages and replies.">
                <SettingsField
                  label="Compose format"
                  description="Used when you open the composer."
                  error={() => undefined}
                  changed={() => composeFormat() !== savedPreferences().composeFormat}
                >
                  <Select
                    aria-label="Compose format"
                    value={composeFormat()}
                    onValueChange={(value) => value && setComposeFormat(value)}
                    options={[
                      { value: "rich", label: "Rich text" },
                      { value: "plain", label: "Plain text" },
                    ]}
                  />
                </SettingsField>
                <SettingsField
                  label="Undo send"
                  description="Delay delivery so a message can still be recalled."
                  error={() => undefined}
                  changed={() => undoSend() !== savedPreferences().undoSend}
                >
                  <Select
                    aria-label="Undo send"
                    value={undoSend()}
                    onValueChange={(value) => value && setUndoSend(value)}
                    options={[
                      { value: "0", label: "Off" },
                      { value: "5", label: "5 seconds" },
                      { value: "10", label: "10 seconds" },
                      { value: "30", label: "30 seconds" },
                    ]}
                  />
                </SettingsField>
              </SettingsGroup>
              <SettingsModal.Footer>
                <SettingsPanelFooter changeCount={changeCount} loading={loading} onDiscard={discard} onSave={save} />
              </SettingsModal.Footer>
            </SettingsModal.Tab>
          </SettingsModal.Group>
          <SettingsModal.Group title="Mailbox">
            <SettingsModal.Tab id="organization" title="Organization" icon="ti ti-tags" description="Reusable views and shared vocabulary.">
              <SettingsCollection title="Saved views" description="Reusable filters shown in navigation." empty="No saved views yet.">
                <SettingsCollection.Action>
                  <Button size="xs">New view</Button>
                </SettingsCollection.Action>
                <SettingsCollection.Item
                  title="Open conversations"
                  description="Private view · 3 filters"
                  icon={<i class="ti ti-filter" />}
                >
                  <SettingsCollection.Item.Status>
                    <StatusBadge tone="neutral" label="Private" variant="text" />
                  </SettingsCollection.Item.Status>
                  <SettingsCollection.Item.Actions>
                    <IconButton size="xs" label="Edit Open conversations">
                      <i class="ti ti-pencil" />
                    </IconButton>
                  </SettingsCollection.Item.Actions>
                </SettingsCollection.Item>
              </SettingsCollection>
              <SettingsCollection title="Conversation tags" description="Shared across views and automations." empty="No tags yet.">
                <SettingsCollection.Action>
                  <Button size="xs" variant="secondary">
                    Add tag
                  </Button>
                </SettingsCollection.Action>
              </SettingsCollection>
            </SettingsModal.Tab>
            <SettingsModal.Tab id="delivery" title="Delivery" icon="ti ti-send" description="Accounts and sender identities.">
              <SettingsCollection title="Connected accounts" empty="No account connected.">
                <SettingsCollection.Item title="support@example.test" description="IMAP and SMTP" icon={<i class="ti ti-mail" />}>
                  <SettingsCollection.Item.Status>
                    <StatusBadge tone="ok" label="Connected" />
                  </SettingsCollection.Item.Status>
                  <SettingsCollection.Item.Actions>
                    <Button size="xs" variant="ghost">
                      Manage
                    </Button>
                  </SettingsCollection.Item.Actions>
                </SettingsCollection.Item>
              </SettingsCollection>
            </SettingsModal.Tab>
          </SettingsModal.Group>
          <SettingsModal.Group title="Lifecycle">
            <SettingsModal.Tab id="danger" title="Danger zone" icon="ti ti-alert-triangle" tone="danger">
              <SettingsGroup title="Disable mailbox" description="Stop new mail without deleting retained messages.">
                <SettingsGroup.Action>
                  <Button size="sm" variant="danger">
                    Disable mailbox
                  </Button>
                </SettingsGroup.Action>
              </SettingsGroup>
            </SettingsModal.Tab>
          </SettingsModal.Group>
        </SettingsModal>
      </div>
    </DemoCard>
  );
};

const SettingsPageDemo = () => {
  const [endpoint, setEndpoint] = createSignal("https://example.test");
  const changed = () => endpoint() !== "https://example.test";
  return (
    <DemoCard
      id="settings-page"
      chip={[
        { kind: "component", name: "SettingsPage", from: "@k2b/ui" },
        { kind: "component", name: "SettingsSection", from: "@k2b/ui" },
      ]}
      description="A flat full-page settings shell with accessible paper sections, one heading, a scrolling body, optional actions, and a fixed save footer."
      code={`<SettingsPage
  title="Project settings"
  subtitle="Identity and defaults"
  icon="ti ti-settings"
  actions={<Button size="sm" variant="secondary">Test connection</Button>}
  footer={
    <SettingsPanelFooter
      changeCount={() => (changed() ? 1 : 0)}
      loading={() => false}
      onDiscard={discard}
      onSave={save}
    />
  }
>
  <SettingsSection title="Identity" subtitle="Public service details" icon="ti ti-id">
    <SettingsField label="Endpoint" description="Public service URL" error={() => undefined} changed={changed}>
      <TextInput value={endpoint()} onValueChange={setEndpoint} />
    </SettingsField>
  </SettingsSection>
</SettingsPage>`}
    >
      <div style="height: 22rem">
        <SettingsPage
          title="Project settings"
          subtitle="Identity and defaults"
          icon="ti ti-settings"
          actions={
            <Button size="sm" variant="secondary">
              Test connection
            </Button>
          }
          footer={
            <SettingsPanelFooter
              changeCount={() => (changed() ? 1 : 0)}
              loading={() => false}
              onDiscard={() => setEndpoint("https://example.test")}
              onSave={() => {}}
            />
          }
        >
          <SettingsSection title="Identity" subtitle="Public service details" icon="ti ti-id">
            <SettingsField label="Endpoint" description="Public service URL" error={() => undefined} changed={changed}>
              <TextInput value={endpoint()} onValueChange={setEndpoint} />
            </SettingsField>
          </SettingsSection>
        </SettingsPage>
      </div>
    </DemoCard>
  );
};

const PanelDemo = () => {
  const [tab, setTab] = createSignal("general");
  return (
    <DemoCard
      id="panel-dialog"
      chip={{ kind: "component", name: "PanelDialog", from: "@k2b/ui" }}
      description="A composable contained or floating frame for complex editors. The host chooses how it opens."
      code={`<PanelDialog surface="contained">
  <PanelDialog.Header title="Edit project" subtitle="General settings" icon="ti ti-settings" />
  <PanelDialog.Tabs value={tab()} onValueChange={setTab} options={tabOptions} />
  <PanelDialog.Body>
    <PanelDialog.Section title="Profile" subtitle="Visible to collaborators" icon="ti ti-user">
      <TextInput label="Name" value="Launch plan" />
    </PanelDialog.Section>
  </PanelDialog.Body>
  <PanelDialog.Footer>
    <Button variant="secondary">Cancel</Button>
    <Button>Save</Button>
  </PanelDialog.Footer>
</PanelDialog>`}
    >
      <PanelDialog surface="contained">
        <PanelDialog.Header title="Edit project" subtitle="General settings" icon="ti ti-settings" />
        <PanelDialog.Tabs
          value={tab()}
          onValueChange={setTab}
          options={[
            { value: "general", label: "General" },
            { value: "access", label: "Access" },
          ]}
        />
        <PanelDialog.Body>
          <PanelDialog.Section title="Profile" subtitle="Visible to collaborators" icon="ti ti-user">
            <TextInput label="Name" value="Launch plan" />
          </PanelDialog.Section>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <div class="ui-demo-row">
            <Button variant="secondary">Cancel</Button>
            <Button>Save</Button>
          </div>
        </PanelDialog.Footer>
      </PanelDialog>
    </DemoCard>
  );
};

const DiscussionDemo = () => {
  const [composerOpen, setComposerOpen] = createSignal(false);
  const [draft, setDraft] = createSignal("");

  const closeComposer = () => {
    setDraft("");
    setComposerOpen(false);
  };

  return (
    <DemoCard
      id="discussion"
      chip={{ kind: "component", name: "Discussion", from: "@k2b/ui" }}
      description="Compact notes and comments with Markdown composition, clear content hierarchy, optional reply context, and progressive item actions."
      code={`const [draft, setDraft] = createSignal("");

<Discussion label="Notes" count={3}>
  <Discussion.Composer
    onSubmit={postNote}
    actions={<><Button>Cancel</Button><Button>Post note</Button></>}
  >
    <MarkdownEditor value={draft()} onValueChange={setDraft} noToolbar showStats={false} />
  </Discussion.Composer>
  <Discussion.List>
    <Discussion.Item
      author="Mara Klein"
      avatar={<Avatar name="Mara Klein" size="xs" />}
      timestamp={<time dateTime="2026-08-09T15:42:00Z">18 min ago</time>}
      actions={<IconButton label="Note actions">…</IconButton>}
    >
      <MarkdownView markdown="Purchase order requested from the customer." />
    </Discussion.Item>
    <Discussion.Item author="Valentin Kolb" timestamp={…} replyContext="Reply to Mara Klein">
      <MarkdownView markdown="I will follow up before the payment deadline." />
    </Discussion.Item>
  </Discussion.List>
</Discussion>`}
    >
      <div class="ui-discussion-showcase">
        <Discussion
          label="Notes"
          icon="ti ti-note"
          count="3 notes"
          actions={
            <Show when={!composerOpen()}>
              <Button variant="ghost" size="xs" onClick={() => setComposerOpen(true)}>
                <i class="ti ti-plus" aria-hidden="true" /> Add note
              </Button>
            </Show>
          }
        >
          <Show when={composerOpen()}>
            <Discussion.Composer
              onSubmit={(event) => {
                event.preventDefault();
                if (!draft().trim()) return;
                closeComposer();
              }}
              actions={
                <>
                  <Button type="button" variant="ghost" size="xs" onClick={closeComposer}>
                    Cancel
                  </Button>
                  <Button type="submit" size="xs" disabled={!draft().trim()}>
                    <i class="ti ti-send" aria-hidden="true" /> Post note
                  </Button>
                </>
              }
            >
              <MarkdownEditor
                value={draft}
                onValueChange={setDraft}
                onSubmit={() => {
                  if (draft().trim()) closeComposer();
                }}
                aria-label="Add internal note"
                placeholder="Add context for everyone with access…"
                lines={3}
                noToolbar
                showStats={false}
              />
            </Discussion.Composer>
          </Show>

          <Discussion.List>
            <Discussion.Item
              avatar={<Avatar name="Mara Klein" size="xs" />}
              author="Mara Klein"
              timestamp={<time dateTime="2026-08-09T15:42:00Z">18 min ago</time>}
              actions={
                <>
                  <IconButton variant="ghost" size="xs" label="Reply to Mara Klein">
                    <i class="ti ti-arrow-back-up" aria-hidden="true" />
                  </IconButton>
                  <IconButton variant="ghost" size="xs" label="Mara Klein note actions">
                    <i class="ti ti-dots" aria-hidden="true" />
                  </IconButton>
                </>
              }
            >
              <MarkdownView
                markdown="Purchase order requested from the customer. I added the reference to the invoice record."
                smallHeadings
              />
            </Discussion.Item>

            <Discussion.Item
              avatar={<Avatar name="Valentin Kolb" size="xs" />}
              author="Valentin Kolb"
              timestamp={<time dateTime="2026-08-09T15:56:00Z">4 min ago</time>}
              meta="edited"
              actions={
                <IconButton variant="ghost" size="xs" label="Valentin Kolb note actions">
                  <i class="ti ti-dots" aria-hidden="true" />
                </IconButton>
              }
              replyContext={
                <>
                  <i class="ti ti-arrow-back-up" aria-hidden="true" /> Reply to Mara Klein
                </>
              }
            >
              <MarkdownView markdown="I will follow up before the payment deadline." smallHeadings />
            </Discussion.Item>

            <Discussion.Item
              avatar={<Avatar name="Alex Smith" size="xs" />}
              author="Alex Smith"
              timestamp={<time dateTime="2026-08-09T15:58:00Z">2 min ago</time>}
              actions={
                <IconButton variant="ghost" size="xs" label="Alex Smith note actions">
                  <i class="ti ti-dots" aria-hidden="true" />
                </IconButton>
              }
            >
              <MarkdownView markdown="The customer confirmed that the billing address is correct." smallHeadings />
            </Discussion.Item>
          </Discussion.List>
        </Discussion>
      </div>
    </DemoCard>
  );
};

const DetailPanelDemo = () => {
  const [status, setStatus] = createSignal("needs-response");
  const [assignee, setAssignee] = createSignal("unassigned");

  return (
    <DemoCard
      id="detail-panel"
      chip={[
        { kind: "component", name: "DetailPanel", from: "@k2b/ui" },
        { kind: "component", name: "DescriptionList", from: "@k2b/ui" },
      ]}
      description="Two production-shaped inspectors demonstrate the final contract: related sections share clear white surfaces, compact rows keep dense data scannable, and restrained icon tones preserve identity and state."
      code={`<DetailPanel.Group label="Customer context">
  <DetailPanel.Section title="Company" icon="ti ti-building" tone="accent">
    <DescriptionList layout="rows" size="sm" items={companyItems} />
  </DetailPanel.Section>
  <DetailPanel.Section title="Contact" icon="ti ti-user" tone="warning">…</DetailPanel.Section>
  <DetailPanel.Section title="Recent threads" icon="ti ti-history" tone="success">…</DetailPanel.Section>
</DetailPanel.Group>`}
    >
      <div class="ui-detail-panel-patterns">
        <article class="ui-detail-panel-pattern">
          <header>
            <strong>Customer request</strong>
            <span>Request state and customer context form clear, related surfaces.</span>
          </header>
          <div class="ui-detail-panel-pattern__frame">
            <DetailPanel class="ui-detail-panel-grouped">
              <DetailPanel.Header
                title="Bug report"
                subtitle="No preview · 5 minutes ago"
                actions={
                  <IconButton variant="ghost" size="xs" label="Close request details">
                    <i class="ti ti-x" aria-hidden="true" />
                  </IconButton>
                }
              />
              <DetailPanel.Body>
                <DetailPanel.Group label="Request context">
                  <DetailPanel.Section title="Workflow" icon="ti ti-route" tone="accent">
                    <DescriptionList
                      layout="rows"
                      size="sm"
                      items={[
                        {
                          term: "Status",
                          description: (
                            <SelectChip
                              aria-label="Request status"
                              value={status}
                              onValueChange={setStatus}
                              options={[
                                { value: "needs-response", label: "Needs first response", icon: "ti ti-sparkles" },
                                { value: "investigating", label: "Investigating", icon: "ti ti-loader" },
                                { value: "waiting", label: "Waiting for customer", icon: "ti ti-clock" },
                                { value: "done", label: "Done", icon: "ti ti-circle-check" },
                              ]}
                            />
                          ),
                        },
                        {
                          term: "Assignee",
                          description: (
                            <SelectChip
                              aria-label="Request assignee"
                              value={assignee}
                              onValueChange={setAssignee}
                              options={[
                                { value: "unassigned", label: "Unassigned", icon: "ti ti-user-question" },
                                { value: "valentin", label: "Valentin", icon: "ti ti-user" },
                              ]}
                            />
                          ),
                        },
                        { term: "Priority", description: "Normal" },
                        { term: "Labels", description: <Tag color="var(--k2b-detail-panel-accent)">Bug</Tag> },
                        { term: "Thread tier", description: "Growth" },
                      ]}
                    />
                  </DetailPanel.Section>

                  <DetailPanel.Section title="Links" icon="ti ti-link" tone="neutral" meta="0">
                    <div class="ui-detail-panel-grouped__empty-actions">
                      <Button variant="ghost" size="xs">
                        <i class="ti ti-message-circle" aria-hidden="true" /> Discussions
                      </Button>
                      <Button variant="ghost" size="xs">
                        <i class="ti ti-link-plus" aria-hidden="true" /> Thread links
                      </Button>
                    </div>
                  </DetailPanel.Section>
                </DetailPanel.Group>

                <DetailPanel.Group label="Customer context">
                  <DetailPanel.Section
                    title="content-mobbin"
                    icon="ti ti-building"
                    tone="accent"
                    actions={
                      <IconButton variant="ghost" size="xs" label="Company actions">
                        <i class="ti ti-dots" aria-hidden="true" />
                      </IconButton>
                    }
                  >
                    <DescriptionList
                      layout="rows"
                      size="sm"
                      items={[
                        { term: "Company tier", description: "Growth" },
                        { term: "Slack channels", description: "Not connected" },
                        { term: "Domain", description: "content-mobbin.com" },
                      ]}
                    />
                  </DetailPanel.Section>

                  <DetailPanel.Section
                    title="alexsmith"
                    icon="ti ti-user"
                    tone="warning"
                    actions={
                      <IconButton variant="ghost" size="xs" label="Contact actions">
                        <i class="ti ti-dots" aria-hidden="true" />
                      </IconButton>
                    }
                  >
                    <DescriptionList
                      layout="rows"
                      size="sm"
                      items={[
                        { term: "Email", description: "alexsmith@content-mobbin.com" },
                        { term: "Groups", description: "Not assigned" },
                      ]}
                    />
                  </DetailPanel.Section>

                  <DetailPanel.Section title="Recent threads" icon="ti ti-history" tone="success">
                    <div class="ui-detail-panel-grouped__threads">
                      {[
                        ["Bug report", "1h ago"],
                        ["Account recovery", "3h ago"],
                        ["Invoice question", "Yesterday"],
                      ].map(([title, time]) => (
                        <button type="button">
                          <i class="ti ti-circle-check" aria-hidden="true" />
                          <span>{title}</span>
                          <time>{time}</time>
                        </button>
                      ))}
                    </div>
                  </DetailPanel.Section>
                </DetailPanel.Group>

                <DetailPanel.Group label="Subscription context">
                  <DetailPanel.Section
                    title="Subscription plan details"
                    icon="ti ti-alert-triangle"
                    tone="danger"
                    actions={
                      <IconButton variant="ghost" size="xs" label="Retry subscription sync">
                        <i class="ti ti-refresh" aria-hidden="true" />
                      </IconButton>
                    }
                  />
                </DetailPanel.Group>
              </DetailPanel.Body>
            </DetailPanel>
          </div>
        </article>

        <article class="ui-detail-panel-pattern">
          <header>
            <strong>Collaborative note</strong>
            <span>Document navigation and collaboration remain distinct but consistent.</span>
          </header>
          <div class="ui-detail-panel-pattern__frame">
            <DetailPanel class="ui-detail-panel-grouped">
              <DetailPanel.Header
                icon="ti ti-notes"
                title="Welcome!"
                subtitle="Collaborative note"
                primaryActions={
                  <Toolbar label="Note actions">
                    <IconButton variant="ghost" size="xs" label="Open markdown">
                      <i class="ti ti-markdown" aria-hidden="true" />
                    </IconButton>
                    <IconButton variant="ghost" size="xs" label="Copy note">
                      <i class="ti ti-copy" aria-hidden="true" />
                    </IconButton>
                    <IconButton variant="ghost" size="xs" label="Download note">
                      <i class="ti ti-download" aria-hidden="true" />
                    </IconButton>
                  </Toolbar>
                }
                actions={
                  <IconButton variant="ghost" size="xs" label="Close note details">
                    <i class="ti ti-x" aria-hidden="true" />
                  </IconButton>
                }
              />
              <DetailPanel.Body>
                <DetailPanel.Group label="Document context">
                  <DetailPanel.Section title="Contents" icon="ti ti-list-tree" tone="accent">
                    <ol class="ui-detail-panel-grouped__contents">
                      {[
                        ["H1", "Welcome!"],
                        ["H2", "Text Formatting"],
                        ["H2", "Headings"],
                        ["H2", "Lists"],
                        ["H2", "Links & Images"],
                        ["H2", "Code Blocks"],
                        ["H2", "Tables"],
                      ].map(([level, label]) => (
                        <li>
                          <span>{level}</span>
                          <button type="button">{label}</button>
                        </li>
                      ))}
                    </ol>
                  </DetailPanel.Section>
                </DetailPanel.Group>

                <DetailPanel.Group label="Collaboration context">
                  <DetailPanel.Section title="Online · 1" icon="ti ti-users" tone="success">
                    <div class="ui-detail-panel-grouped__person">
                      <Avatar name="Valentin Kolb" size="xs" />
                      <span>Valentin Kolb</span>
                    </div>
                  </DetailPanel.Section>

                  <DetailPanel.Section title="Info" icon="ti ti-info-circle" tone="neutral">
                    <DescriptionList
                      layout="rows"
                      size="sm"
                      items={[
                        { term: "Created", description: "07 Jul 2026" },
                        { term: "Updated", description: "07 Jul 2026" },
                      ]}
                    />
                  </DetailPanel.Section>

                  <DetailPanel.Section title="Versions" icon="ti ti-history" tone="warning" meta="12" />
                </DetailPanel.Group>
              </DetailPanel.Body>
            </DetailPanel>
          </div>
        </article>
      </div>
    </DemoCard>
  );
};

const FloatingDemo = () => {
  const [open, setOpen] = createSignal(false);
  let scope: HTMLDivElement | undefined;
  return (
    <DemoCard
      id="floating-window"
      chip={{ kind: "component", name: "FloatingWindow", from: "@k2b/ui" }}
      description="A movable, resizable utility window that fits the viewport, uses an explicit portal scope, and becomes an inset surface on mobile."
      code={`const [open, setOpen] = createSignal(false);

<div ref={appShell}>
  <Button variant="secondary" onClick={() => setOpen(true)}>Open inspector</Button>
  <Show when={open()}>
    <FloatingWindow
      title="Inspector"
      icon="ti ti-adjustments"
      initialWidth={520}
      initialHeight={380}
      resolveScope={() => appShell}
      onClose={() => setOpen(false)}
    >
      …
    </FloatingWindow>
  </Show>
</div>`}
    >
      <div ref={scope}>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open inspector
        </Button>
        <Show when={open()}>
          <FloatingWindow
            title="Inspector"
            icon="ti ti-adjustments"
            onClose={() => setOpen(false)}
            initialWidth={520}
            initialHeight={380}
            resolveScope={() => scope}
          >
            <div class="ui-demo-pane">Portable floating content</div>
          </FloatingWindow>
        </Show>
      </div>
    </DemoCard>
  );
};

export const PaginationDemo = () => (
  <DemoCard
    id="pagination"
    chip={{ kind: "component", name: "Pagination", from: "@k2b/ui" }}
    description="Server-friendly URL pagination with compact page windows and native navigation semantics."
    code={`<Pagination currentPage={4} totalPages={12} baseUrl="?page=" />`}
  >
    <Pagination currentPage={4} totalPages={12} baseUrl="?page=" />
  </DemoCard>
);

const demos: DemoSection = {
  workspace: () => (
    <DemoGrid columns="one">
      <WorkspaceDemo />
    </DemoGrid>
  ),
  panes: () => (
    <DemoGrid columns="one">
      <PanesDemo />
    </DemoGrid>
  ),
  overview: () => (
    <DemoGrid columns="one">
      <OverviewDemo />
      <DataPanelDemo />
    </DemoGrid>
  ),
  "settings-modal": () => (
    <DemoGrid columns="one">
      <SettingsPageDemo />
      <SettingsDemo />
    </DemoGrid>
  ),
  "panel-dialog": () => (
    <DemoGrid columns="one">
      <PanelDemo />
    </DemoGrid>
  ),
  "detail-panel": () => (
    <DemoGrid columns="one">
      <DetailPanelDemo />
    </DemoGrid>
  ),
  discussion: () => (
    <DemoGrid columns="one">
      <DiscussionDemo />
    </DemoGrid>
  ),
  "floating-window": () => (
    <DemoGrid columns="one">
      <FloatingDemo />
    </DemoGrid>
  ),
};

export default demos;
