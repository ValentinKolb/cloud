import {
  AppOverview,
  AppWorkspace,
  Avatar,
  Button,
  createPanesValue,
  DataPanel,
  DescriptionList,
  DetailPanel,
  FloatingWindow,
  IconButton,
  Pagination,
  PanelDialog,
  PanelHeader,
  Panes,
  SelectChip,
  SettingsField,
  SettingsModal,
  SettingsPage,
  SettingsPanelFooter,
  SettingsSaveBar,
  SettingsSection,
  StatusBadge,
  Tag,
  TextInput,
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
  const [active, setActive] = createSignal("general");
  const [endpoint, setEndpoint] = createSignal("https://example.test");
  const changed = () => endpoint() !== "https://example.test";
  const loading = () => false;
  return (
    <DemoCard
      id="settings-modal"
      chip={[
        { kind: "component", name: "SettingsModal", from: "@k2b/ui" },
        { kind: "component", name: "SettingsField", from: "@k2b/ui" },
        { kind: "component", name: "SettingsSaveBar", from: "@k2b/ui" },
        { kind: "component", name: "SettingsPanelFooter", from: "@k2b/ui" },
      ]}
      description="Compound settings tabs plus field, sticky-save, and panel-footer helpers, without a persistence backend."
      code={`<SettingsModal title="Application settings" activeTab={active()} onTabChange={setActive}>
  <SettingsModal.Tab id="general" title="General" icon="ti ti-adjustments">
    <SettingsField label="Endpoint" description="Public service URL" error={() => undefined} changed={changed}>
      <TextInput aria-label="Endpoint" value={endpoint()} onValueChange={setEndpoint} />
    </SettingsField>
  </SettingsModal.Tab>
  <SettingsModal.Tab id="security" title="Security" icon="ti ti-lock" description="Authentication controls">
    Security settings
  </SettingsModal.Tab>
</SettingsModal>

<SettingsSaveBar changeCount={changeCount} loading={loading} onDiscard={discard} onSave={save} />
<SettingsPanelFooter changeCount={changeCount} loading={loading} onDiscard={discard} onSave={save} />`}
    >
      <div class="ui-settings-demo">
        <SettingsModal title="Application settings" activeTab={active()} onTabChange={setActive}>
          <SettingsModal.Tab id="general" title="General" icon="ti ti-adjustments">
            <SettingsField label="Endpoint" description="Public service URL" error={() => undefined} changed={changed}>
              <TextInput aria-label="Endpoint" value={endpoint()} onValueChange={setEndpoint} />
            </SettingsField>
          </SettingsModal.Tab>
          <SettingsModal.Tab id="security" title="Security" icon="ti ti-lock" description="Authentication controls">
            <p>Security settings</p>
          </SettingsModal.Tab>
        </SettingsModal>
        <SettingsSaveBar
          changeCount={() => (changed() ? 1 : 0)}
          loading={loading}
          onDiscard={() => setEndpoint("https://example.test")}
          onSave={() => {}}
        />
        <div class="ui-demo-row">
          <SettingsPanelFooter
            changeCount={() => (changed() ? 1 : 0)}
            loading={loading}
            onDiscard={() => setEndpoint("https://example.test")}
            onSave={() => {}}
          />
        </div>
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

const DetailPanelDemo = () => {
  const [assignee, setAssignee] = createSignal("valentin");
  const [status, setStatus] = createSignal("needs-action");
  const [note, setNote] = createSignal("");

  return (
    <DemoCard
      id="detail-panel"
      chip={[
        { kind: "component", name: "DetailPanel", from: "@k2b/ui" },
        { kind: "component", name: "DescriptionList", from: "@k2b/ui" },
      ]}
      description="A quiet contextual inspector: one compact identity row, one scroll owner, flat sections, compact properties, and native progressive disclosure."
      code={`const [assignee, setAssignee] = createSignal("valentin");
const [status, setStatus] = createSignal("needs-action");
const [note, setNote] = createSignal("");

<AppWorkspace resizable={false}>
  <AppWorkspace.Content>
    <AppWorkspace.Main>…</AppWorkspace.Main>
    <AppWorkspace.Detail id="conversation" open width="md" resizable={false}>
      <DetailPanel>
        <DetailPanel.Header
          title="Urgent invoice review"
          subtitle="alex@example.com · 2 hours ago"
          actions={<IconButton variant="ghost" size="sm" label="Close details"><i class="ti ti-x" aria-hidden="true" /></IconButton>}
        />
        <DetailPanel.Body scrollPreserveKey="conversation-detail">
          <DetailPanel.Section title="Workflow">
            <DescriptionList layout="rows" size="sm" items={workflowItems} />
          </DetailPanel.Section>
          <DetailPanel.Section title="Here now">…</DetailPanel.Section>
          <DetailPanel.Section title="Contact">
            <DescriptionList layout="rows" size="sm" items={contactItems} />
          </DetailPanel.Section>
          <DetailPanel.Section title="Attachments">
            <DetailPanel.Action
              href="/files/invoice-0816.pdf"
              download="invoice-0816.pdf"
              leading={<i class="ti ti-file-type-pdf" aria-hidden="true" />}
              title="invoice-0816.pdf"
              trailing={<i class="ti ti-download" aria-hidden="true" />}
            />
          </DetailPanel.Section>
          <DetailPanel.Section title="Team notes">
            {comments.map((comment) => <Comment {...comment} />)}
            <TextInput
              aria-label="Add team note"
              placeholder="Add an internal note"
              multiline
              lines={2}
              value={note()}
              onValueChange={setNote}
            />
            <Button type="button" size="xs">Comment</Button>
          </DetailPanel.Section>
          <DetailPanel.Section title="Technical details" collapsible>
            <DescriptionList layout="rows" size="sm" items={technicalItems} />
          </DetailPanel.Section>
        </DetailPanel.Body>
      </DetailPanel>
    </AppWorkspace.Detail>
  </AppWorkspace.Content>
</AppWorkspace>`}
    >
      <div class="ui-detail-panel-demo">
        <AppWorkspace resizable={false}>
          <AppWorkspace.Content>
            <AppWorkspace.Main>
              <article class="ui-detail-panel-demo__message">
                <div class="ui-detail-panel-demo__message-header">
                  <Avatar name="Alex Smith" size="sm" />
                  <div>
                    <strong>Alex Smith</strong>
                    <span>alex@example.com</span>
                  </div>
                </div>
                <h3>Urgent invoice review</h3>
                <p>Could you confirm the purchase order for invoice INV-2026-0816?</p>
                <p>The payment is due tomorrow, so I would appreciate a short update.</p>
              </article>
            </AppWorkspace.Main>
            <AppWorkspace.Detail id="conversation" open width="md" resizable={false}>
              <DetailPanel>
                <DetailPanel.Header
                  title="Urgent invoice review"
                  subtitle="alex@example.com · 2 hours ago"
                  actions={
                    <IconButton variant="ghost" size="sm" label="Close conversation details">
                      <i class="ti ti-x" aria-hidden="true" />
                    </IconButton>
                  }
                />
                <DetailPanel.Body scrollPreserveKey="conversation-detail">
                  <DetailPanel.Section title="Workflow">
                    <DescriptionList
                      layout="rows"
                      size="sm"
                      items={[
                        {
                          term: "Assignee",
                          description: (
                            <SelectChip
                              aria-label="Assignee"
                              value={assignee}
                              onValueChange={setAssignee}
                              options={[
                                { value: "valentin", label: "Valentin", icon: "ti ti-user" },
                                { value: "support", label: "Support team", icon: "ti ti-users" },
                              ]}
                            />
                          ),
                        },
                        {
                          term: "Status",
                          description: (
                            <SelectChip
                              aria-label="Status"
                              value={status}
                              onValueChange={setStatus}
                              options={[
                                { value: "needs-action", label: "Needs action", icon: "ti ti-message-reply" },
                                { value: "waiting", label: "Waiting", icon: "ti ti-hourglass" },
                                { value: "done", label: "Done", icon: "ti ti-circle-check" },
                              ]}
                            />
                          ),
                        },
                        {
                          term: "Tags",
                          description: (
                            <span class="flex flex-wrap gap-1">
                              <Tag color="#3b82f6">Invoice</Tag>
                              <Tag color="#f59e0b">Urgent</Tag>
                            </span>
                          ),
                        },
                        {
                          term: "Snooze",
                          description: (
                            <Button variant="ghost" size="xs">
                              <i class="ti ti-calendar" aria-hidden="true" /> Tomorrow
                            </Button>
                          ),
                        },
                      ]}
                    />
                  </DetailPanel.Section>

                  <DetailPanel.Section title="Here now">
                    <div class="flex items-center gap-2">
                      <Avatar name="Valentin Kolb" size="xs" />
                      <span class="min-w-0 flex-1 truncate text-sm">Valentin Kolb</span>
                      <StatusBadge tone="neutral" label="Viewing" icon="ti ti-eye" variant="text" />
                    </div>
                  </DetailPanel.Section>

                  <DetailPanel.Section title="Contact">
                    <DescriptionList
                      layout="rows"
                      size="sm"
                      items={[
                        { term: "From", description: "alex@example.com" },
                        { term: "Company", description: "Northstar Studio" },
                        { term: "Last contact", description: "12 days ago" },
                      ]}
                    />
                  </DetailPanel.Section>

                  <DetailPanel.Section title="Attachments">
                    <DetailPanel.Action
                      href="/files/invoice-0816.pdf"
                      download="invoice-0816.pdf"
                      leading={<i class="ti ti-file-type-pdf" aria-hidden="true" />}
                      title="invoice-0816.pdf"
                      trailing={<i class="ti ti-download" aria-hidden="true" />}
                    />
                  </DetailPanel.Section>

                  <DetailPanel.Section title="Team notes">
                    <div class="ui-detail-panel-demo__comments">
                      <article class="ui-detail-panel-demo__comment">
                        <Avatar name="Mara Klein" size="xs" />
                        <div>
                          <strong>Mara Klein</strong>
                          <time>18 min ago</time>
                          <p>Purchase order requested from the customer.</p>
                        </div>
                      </article>
                      <article class="ui-detail-panel-demo__comment">
                        <Avatar name="Valentin Kolb" size="xs" />
                        <div>
                          <strong>Valentin Kolb</strong>
                          <time>4 min ago</time>
                          <p>I will follow up before the payment deadline.</p>
                        </div>
                      </article>
                    </div>
                    <div class="ui-detail-panel-demo__composer">
                      <TextInput
                        aria-label="Add team note"
                        placeholder="Add an internal note"
                        multiline
                        lines={2}
                        value={note()}
                        onValueChange={setNote}
                      />
                      <Button type="button" size="xs">
                        Comment
                      </Button>
                    </div>
                  </DetailPanel.Section>

                  <DetailPanel.Section title="Technical details" collapsible>
                    <DescriptionList
                      layout="rows"
                      size="sm"
                      items={[
                        { term: "Messages", description: "3" },
                        { term: "Attachments", description: "1" },
                        { term: "Message ID", description: <code class="text-xs">8e1f…0816</code> },
                      ]}
                    />
                  </DetailPanel.Section>
                </DetailPanel.Body>
              </DetailPanel>
            </AppWorkspace.Detail>
          </AppWorkspace.Content>
        </AppWorkspace>
      </div>
    </DemoCard>
  );
};

const DetailPanelRecordDemo = () => (
  <DemoCard
    id="detail-panel-record"
    chip={{ kind: "component", name: "DetailPanel", from: "@k2b/ui" }}
    description="The same structure accepts Grids-style dynamic values, long content, actions, and history without a record-specific panel variant."
    code={`<DetailPanel>
  <DetailPanel.Header
    title="Studio shelf"
    subtitle="Locations · version 2 · 12345678"
    meta={<StatusBadge tone="ok" label="Active" />}
    actions={<IconButton variant="ghost" size="sm" label="Edit record"><i class="ti ti-pencil" aria-hidden="true" /></IconButton>}
  />
  <DetailPanel.Body scrollPreserveKey="record-detail">
    <DetailPanel.Section title="Fields">
      <DescriptionList layout="rows" size="sm" items={fieldItems} />
    </DetailPanel.Section>
    <DetailPanel.Section title="Description">…</DetailPanel.Section>
    <DetailPanel.Section title="Files">
      <DetailPanel.Action
        href="/files/condition-report.pdf"
        download="condition-report.pdf"
        leading={<i class="ti ti-file-type-pdf" aria-hidden="true" />}
        title="condition-report.pdf"
        trailing={<i class="ti ti-download" aria-hidden="true" />}
      />
    </DetailPanel.Section>
    <DetailPanel.Section title="Related records">
      <DetailPanel.Action
        href="/app/grids/locations/records/st-02"
        leading={<i class="ti ti-building-warehouse" aria-hidden="true" />}
        title="Studio"
        description="Room · ST-02"
        trailing={<i class="ti ti-chevron-right" aria-hidden="true" />}
      />
    </DetailPanel.Section>
    <DetailPanel.Section title="Comments">…</DetailPanel.Section>
    <DetailPanel.Section title="History" collapsible defaultOpen>…</DetailPanel.Section>
  </DetailPanel.Body>
</DetailPanel>`}
  >
    <div class="ui-detail-panel-standalone">
      <DetailPanel>
        <DetailPanel.Header
          title="Studio shelf"
          subtitle="Locations · version 2 · 12345678"
          meta={<StatusBadge tone="ok" label="Active" />}
          actions={
            <IconButton variant="ghost" size="sm" label="Edit record">
              <i class="ti ti-pencil" aria-hidden="true" />
            </IconButton>
          }
        />
        <DetailPanel.Body scrollPreserveKey="record-detail">
          <DetailPanel.Section title="Fields">
            <DescriptionList
              layout="rows"
              size="sm"
              items={[
                { term: "Room", description: "Studio" },
                { term: "Quantity", description: <span class="tabular-nums">18</span> },
                { term: "Category", description: <Tag color="#10b981">Storage</Tag> },
                { term: "Condition", description: <StatusBadge tone="ok" label="Ready" variant="text" /> },
                { term: "Owner", description: "Collection team" },
                { term: "Updated", description: "Yesterday" },
              ]}
            />
          </DetailPanel.Section>
          <DetailPanel.Section title="Description">
            <p class="ui-detail-panel-demo__description">Adjustable shelving used for framed works awaiting photography.</p>
          </DetailPanel.Section>
          <DetailPanel.Section title="Files">
            <div class="flex flex-col gap-1">
              <DetailPanel.Action
                href="/files/condition-report.pdf"
                download="condition-report.pdf"
                leading={<i class="ti ti-file-type-pdf" aria-hidden="true" />}
                title="condition-report.pdf"
                trailing={<i class="ti ti-download" aria-hidden="true" />}
              />
              <DetailPanel.Action
                href="/files/shelf-overview.jpg"
                download="shelf-overview.jpg"
                leading={<i class="ti ti-photo" aria-hidden="true" />}
                title="shelf-overview.jpg"
                trailing={<i class="ti ti-download" aria-hidden="true" />}
              />
            </div>
          </DetailPanel.Section>
          <DetailPanel.Section title="Related records">
            <div class="flex flex-col gap-1">
              <DetailPanel.Action
                href="/app/grids/locations/records/st-02"
                leading={<i class="ti ti-building-warehouse" aria-hidden="true" />}
                title="Studio"
                description="Room · ST-02"
                trailing={<i class="ti ti-chevron-right" aria-hidden="true" />}
              />
              <DetailPanel.Action
                href="/app/grids/collections/records/framed-works"
                leading={<i class="ti ti-box" aria-hidden="true" />}
                title="Framed works"
                description="Collection · 18 items"
                trailing={<i class="ti ti-chevron-right" aria-hidden="true" />}
              />
            </div>
          </DetailPanel.Section>
          <DetailPanel.Section title="Comments">
            <div class="ui-detail-panel-demo__comments">
              <article class="ui-detail-panel-demo__comment">
                <Avatar name="Ada Meyer" size="xs" />
                <div>
                  <strong>Ada Meyer</strong>
                  <time>Yesterday</time>
                  <p>Count verified after the latest studio move.</p>
                </div>
              </article>
              <article class="ui-detail-panel-demo__comment">
                <Avatar name="Nora Lang" size="xs" />
                <div>
                  <strong>Nora Lang</strong>
                  <time>3 days ago</time>
                  <p>Added the current condition report and overview photo.</p>
                </div>
              </article>
            </div>
          </DetailPanel.Section>
          <DetailPanel.Section title="History" collapsible defaultOpen>
            <ol class="ui-detail-panel-demo__history">
              <li>
                <span>
                  <strong>Quantity changed</strong>
                  <small>16 to 18 · Ada</small>
                </span>
                <time>Yesterday</time>
              </li>
              <li>
                <span>
                  <strong>File added</strong>
                  <small>condition-report.pdf · Nora</small>
                </span>
                <time>3 days ago</time>
              </li>
              <li>
                <span>
                  <strong>Record created</strong>
                  <small>Imported from inventory</small>
                </span>
                <time>12 Jun</time>
              </li>
            </ol>
          </DetailPanel.Section>
        </DetailPanel.Body>
      </DetailPanel>
    </div>
  </DemoCard>
);

const DetailPanelPatternsDemo = () => {
  const [status, setStatus] = createSignal("needs-response");
  const [assignee, setAssignee] = createSignal("unassigned");
  const [priority, setPriority] = createSignal("normal");

  return (
    <DemoCard
      id="detail-panel-patterns"
      chip={[
        { kind: "component", name: "DetailPanel", from: "@k2b/ui" },
        { kind: "component", name: "DescriptionList", from: "@k2b/ui" },
      ]}
      description="Three compositional directions: editable facts for fast triage, connected entity context, and an operational state with one clear recovery path. The panel grammar stays consistent while each section fits its use case."
      code={`const [status, setStatus] = createSignal("needs-response");

<DetailPanel.Section title="Request">
  <DescriptionList
    layout="rows"
    size="sm"
    items={[{
      term: "Status",
      description: <SelectChip aria-label="Request status" value={status} onValueChange={setStatus} options={statusOptions} />,
    }]}
  />
</DetailPanel.Section>

<DetailPanel.Section
  title={<span class="ui-detail-panel-pattern__entity-title"><Avatar name="Northstar Studio" size="xs" /><span>Northstar Studio</span></span>}
  actions={<IconButton variant="ghost" size="xs" label="Company actions"><i class="ti ti-dots" aria-hidden="true" /></IconButton>}
>
  <DescriptionList layout="rows" size="sm" items={companyItems} />
</DetailPanel.Section>
<DetailPanel.Section title="Recent threads">
  <DetailPanel.Action
    href="/threads/bug-report"
    leading={<i class="ti ti-circle-check" aria-hidden="true" />}
    title="Bug report"
    description="5 minutes ago"
    trailing={<i class="ti ti-chevron-right" aria-hidden="true" />}
  />
</DetailPanel.Section>

<DetailPanel.Section
  title="Subscription plan"
  actions={<IconButton variant="ghost" size="xs" label="Retry plan sync"><i class="ti ti-refresh" aria-hidden="true" /></IconButton>}
>
  <div class="ui-detail-panel-pattern__recovery">
    <span class="ui-detail-panel-pattern__error"><i class="ti ti-alert-triangle" aria-hidden="true" /> An unknown error occurred.</span>
    <Button variant="secondary" size="xs">Read docs</Button>
  </div>
</DetailPanel.Section>`}
    >
      <div class="ui-detail-panel-patterns">
        <article class="ui-detail-panel-pattern">
          <header>
            <strong>Editable facts</strong>
            <span>Best for fast triage and frequent changes.</span>
          </header>
          <div class="ui-detail-panel-pattern__frame">
            <DetailPanel>
              <DetailPanel.Header title="Bug report" subtitle="No preview" />
              <DetailPanel.Body scrollPreserveKey="pattern-editable-facts">
                <DetailPanel.Section title="Request">
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
                              { value: "investigating", label: "Investigating", icon: "ti ti-route" },
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
                              { value: "unassigned", label: "Unassigned", icon: "ti ti-user-circle" },
                              { value: "valentin", label: "Valentin", icon: "ti ti-user" },
                            ]}
                          />
                        ),
                      },
                      {
                        term: "Priority",
                        description: (
                          <SelectChip
                            aria-label="Request priority"
                            value={priority}
                            onValueChange={setPriority}
                            options={[
                              { value: "normal", label: "Normal", icon: "ti ti-equal" },
                              { value: "high", label: "High", icon: "ti ti-arrow-up" },
                            ]}
                          />
                        ),
                      },
                      {
                        term: "Labels",
                        description: (
                          <Button variant="ghost" size="xs">
                            <i class="ti ti-plus" aria-hidden="true" /> Add labels
                          </Button>
                        ),
                      },
                      {
                        term: "Thread tier",
                        description: <StatusBadge tone="neutral" label="Premium support" icon="ti ti-diamond" />,
                      },
                    ]}
                  />
                </DetailPanel.Section>
                <DetailPanel.Section title="Links (1)" collapsible defaultOpen>
                  <DetailPanel.Action
                    type="button"
                    leading={<i class="ti ti-brand-slack" aria-hidden="true" />}
                    title="Discussion in #website-revamp"
                    description="Just now"
                    trailing={<i class="ti ti-chevron-right" aria-hidden="true" />}
                  />
                </DetailPanel.Section>
              </DetailPanel.Body>
            </DetailPanel>
          </div>
        </article>

        <article class="ui-detail-panel-pattern">
          <header>
            <strong>Connected context</strong>
            <span>Best when related entities explain the selected item.</span>
          </header>
          <div class="ui-detail-panel-pattern__frame">
            <DetailPanel>
              <DetailPanel.Header title="Bug report" subtitle="Customer context" />
              <DetailPanel.Body scrollPreserveKey="pattern-connected-context">
                <DetailPanel.Section
                  title={
                    <span class="ui-detail-panel-pattern__entity-title">
                      <Avatar name="Northstar Studio" size="xs" />
                      <span>Northstar Studio</span>
                    </span>
                  }
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
                      {
                        term: "Slack channels",
                        description: (
                          <Button variant="ghost" size="xs">
                            <i class="ti ti-plus" aria-hidden="true" /> Add channel
                          </Button>
                        ),
                      },
                      { term: "Domain", description: <a href="https://northstar.example">northstar.example</a> },
                    ]}
                  />
                </DetailPanel.Section>
                <DetailPanel.Section
                  title={
                    <span class="ui-detail-panel-pattern__entity-title">
                      <Avatar name="Alex Smith" size="xs" />
                      <span>Alex Smith</span>
                    </span>
                  }
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
                      { term: "Email", description: "alex@northstar.example" },
                      {
                        term: "Groups",
                        description: (
                          <Button variant="ghost" size="xs">
                            <i class="ti ti-plus" aria-hidden="true" /> Add group
                          </Button>
                        ),
                      },
                    ]}
                  />
                </DetailPanel.Section>
                <DetailPanel.Section title="Recent threads">
                  <div class="flex flex-col gap-1">
                    <DetailPanel.Action
                      href="/threads/bug-report"
                      leading={<i class="ti ti-circle-check" aria-hidden="true" />}
                      title="Bug report"
                      description="5 minutes ago"
                      trailing={<i class="ti ti-chevron-right" aria-hidden="true" />}
                    />
                    <DetailPanel.Action
                      href="/threads/account-recovery"
                      leading={<i class="ti ti-circle-check" aria-hidden="true" />}
                      title="Account recovery"
                      description="1 hour ago"
                      trailing={<i class="ti ti-chevron-right" aria-hidden="true" />}
                    />
                  </div>
                </DetailPanel.Section>
              </DetailPanel.Body>
            </DetailPanel>
          </div>
        </article>

        <article class="ui-detail-panel-pattern">
          <header>
            <strong>Operational state</strong>
            <span>Best for failures that need one obvious next step.</span>
          </header>
          <div class="ui-detail-panel-pattern__frame">
            <DetailPanel>
              <DetailPanel.Header
                title="Account"
                subtitle="Billing and plan context"
                meta={<StatusBadge tone="error" label="Sync failed" variant="text" />}
              />
              <DetailPanel.Body scrollPreserveKey="pattern-operational-state">
                <DetailPanel.Section
                  title="Subscription plan"
                  actions={
                    <IconButton variant="ghost" size="xs" label="Retry plan sync">
                      <i class="ti ti-refresh" aria-hidden="true" />
                    </IconButton>
                  }
                >
                  <div class="ui-detail-panel-pattern__recovery">
                    <span class="ui-detail-panel-pattern__error">
                      <i class="ti ti-alert-triangle" aria-hidden="true" />
                      An unknown error occurred.
                    </span>
                    <Button variant="secondary" size="xs">
                      Read docs
                    </Button>
                  </div>
                </DetailPanel.Section>
                <DetailPanel.Section title="Last successful sync">
                  <DescriptionList
                    layout="rows"
                    size="sm"
                    items={[
                      { term: "Plan", description: "Business" },
                      { term: "Seats", description: "18 of 25" },
                      { term: "Updated", description: "Yesterday, 16:42" },
                    ]}
                  />
                </DetailPanel.Section>
                <DetailPanel.Section title="Diagnostics" collapsible>
                  <DescriptionList
                    layout="rows"
                    size="sm"
                    items={[
                      { term: "Provider", description: "Stripe" },
                      { term: "Attempt", description: "3 of 3" },
                      { term: "Code", description: <code class="text-xs">plan_sync_failed</code> },
                    ]}
                  />
                </DetailPanel.Section>
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
      <DetailPanelRecordDemo />
      <DetailPanelPatternsDemo />
    </DemoGrid>
  ),
  "floating-window": () => (
    <DemoGrid columns="one">
      <FloatingDemo />
    </DemoGrid>
  ),
};

export default demos;
