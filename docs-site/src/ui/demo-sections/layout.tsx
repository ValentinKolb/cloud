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

const DiscussionProposalDemo = () => {
  const [composerOpen, setComposerOpen] = createSignal(false);
  const [draft, setDraft] = createSignal("");

  const closeComposer = () => {
    setDraft("");
    setComposerOpen(false);
  };

  return (
    <DemoCard
      id="discussion-proposal"
      chip={{ kind: "component", name: "Discussion", from: "@k2b/ui" }}
      description="A shared notes/comments rhythm without shared domain behavior: compact authorship, optional reply context, progressive item actions, and a small Markdown composer that expands only when needed."
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
      <div class="ui-discussion-proposal">
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

const DetailPanelGroupedDemo = () => {
  const [status, setStatus] = createSignal("needs-response");
  const [assignee, setAssignee] = createSignal("unassigned");

  return (
    <DemoCard
      id="detail-panel-grouped"
      chip={[
        { kind: "component", name: "DetailPanel", from: "@k2b/ui" },
        { kind: "component", name: "DescriptionList", from: "@k2b/ui" },
      ]}
      description="Entity groups merge related sections into one surface. A group-owned 1px gap separates its subsections, while app accent and semantic tones give identity, status, and outcomes distinct visual roles."
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
            <strong>Grouped request</strong>
            <span>Request state and customer context become two motivated surfaces.</span>
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
            <strong>Grouped note</strong>
            <span>Document navigation and collaboration become two stable contexts.</span>
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

const DetailPanelCompactCardsDemo = () => {
  const [status, setStatus] = createSignal("needs-response");
  const [assignee, setAssignee] = createSignal("unassigned");
  const [teamNote, setTeamNote] = createSignal("");

  return (
    <DemoCard
      id="detail-panel-compact-cards"
      chip={[
        { kind: "component", name: "DetailPanel", from: "@k2b/ui" },
        { kind: "component", name: "DescriptionList", from: "@k2b/ui" },
      ]}
      description="Compact cards: every top-level section uses the same surface rule. Space is saved through 8px card gaps, 12px padding, horizontal ledger rows, and inline empty states rather than selectively removing boxes."
      code={`<DetailPanel class="ui-detail-panel-compact">
  <DetailPanel.Header title="Urgent invoice review" subtitle="alex@example.com · 2 hours ago" />
  <DetailPanel.Body>
    <DetailPanel.Section title="Here now" class="ui-detail-panel-compact__card">…</DetailPanel.Section>
    <DetailPanel.Section title="Workflow" class="ui-detail-panel-compact__card">
      <DescriptionList layout="rows" size="sm" items={workflowItems} />
    </DetailPanel.Section>
    <DetailPanel.Section title="Contact" class="ui-detail-panel-compact__card">…</DetailPanel.Section>
    <DetailPanel.Section title="Team notes" class="ui-detail-panel-compact__card">…</DetailPanel.Section>
    <DetailPanel.Section title="Mail details" class="ui-detail-panel-compact__card" collapsible>…</DetailPanel.Section>
  </DetailPanel.Body>
</DetailPanel>`}
    >
      <div class="ui-detail-panel-patterns">
        <article class="ui-detail-panel-pattern">
          <header>
            <strong>Compact-card mail</strong>
            <span>Every section is a card; density comes from shared internal geometry.</span>
          </header>
          <div class="ui-detail-panel-pattern__frame">
            <DetailPanel class="ui-detail-panel-compact">
              <DetailPanel.Header
                leading={<Avatar name="Alex Smith" size="sm" />}
                title="Urgent invoice review"
                subtitle="alex@example.com · 2 hours ago"
                primaryActions={
                  <Toolbar label="Mail actions" wrap>
                    <Button variant="secondary" size="xs">
                      <i class="ti ti-message-reply" aria-hidden="true" /> Reply
                    </Button>
                    <Button variant="secondary" size="xs">
                      <i class="ti ti-clock" aria-hidden="true" /> Snooze
                    </Button>
                  </Toolbar>
                }
                actions={
                  <IconButton variant="ghost" size="xs" label="Close mail details">
                    <i class="ti ti-x" aria-hidden="true" />
                  </IconButton>
                }
              />
              <DetailPanel.Body>
                <DetailPanel.Section title="Here now" class="ui-detail-panel-compact__card">
                  <div class="ui-detail-panel-compact__presence">
                    <Avatar name="Valentin Kolb" size="xs" />
                    <span>Valentin Kolb</span>
                    <StatusBadge tone="neutral" label="Viewing" variant="text" icon="ti ti-eye" />
                  </div>
                </DetailPanel.Section>

                <DetailPanel.Section
                  title="Workflow"
                  class="ui-detail-panel-compact__card"
                  actions={
                    <IconButton variant="ghost" size="xs" label="Edit workflow">
                      <i class="ti ti-adjustments" aria-hidden="true" />
                    </IconButton>
                  }
                >
                  <DescriptionList
                    layout="rows"
                    size="sm"
                    items={[
                      {
                        term: "Tags",
                        description: <Tag color="var(--k2b-detail-panel-accent)">Invoice</Tag>,
                      },
                      {
                        term: "Assignee",
                        description: (
                          <SelectChip
                            aria-label="Mail assignee"
                            value={assignee}
                            onValueChange={setAssignee}
                            options={[
                              { value: "unassigned", label: "Unassigned", icon: "ti ti-user-question" },
                              { value: "valentin", label: "Valentin", icon: "ti ti-user" },
                            ]}
                          />
                        ),
                      },
                      {
                        term: "Status",
                        description: (
                          <SelectChip
                            aria-label="Mail status"
                            value={status}
                            onValueChange={setStatus}
                            options={[
                              { value: "needs-response", label: "Needs response", icon: "ti ti-message-reply" },
                              { value: "waiting", label: "Waiting", icon: "ti ti-hourglass" },
                              { value: "done", label: "Done", icon: "ti ti-circle-check" },
                            ]}
                          />
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
                      {
                        term: "Reminder",
                        description: "Not set",
                        action: (
                          <IconButton variant="ghost" size="xs" label="Set personal reminder">
                            <i class="ti ti-plus" aria-hidden="true" />
                          </IconButton>
                        ),
                      },
                    ]}
                  />
                </DetailPanel.Section>

                <DetailPanel.Section title="Contact" class="ui-detail-panel-compact__card">
                  <DetailPanel.Action
                    leading={<i class="ti ti-user" aria-hidden="true" />}
                    title="test1@docker-demo.de"
                    description="Create or link a contact"
                    trailing={<i class="ti ti-arrow-right" aria-hidden="true" />}
                  />
                </DetailPanel.Section>

                <DetailPanel.Section title="Team notes" class="ui-detail-panel-compact__card">
                  <p class="ui-detail-panel-compact__hint">No team notes yet. Add context for everyone with mailbox access.</p>
                  <div class="ui-detail-panel-compact__composer">
                    <TextInput
                      aria-label="Add team note"
                      placeholder="Add an internal note"
                      multiline
                      lines={2}
                      value={teamNote()}
                      onValueChange={setTeamNote}
                    />
                    <Button size="xs">
                      <i class="ti ti-send" aria-hidden="true" /> Comment
                    </Button>
                  </div>
                </DetailPanel.Section>

                <DetailPanel.Section title="Mail details" meta="4 fields" class="ui-detail-panel-compact__card" collapsible>
                  <DescriptionList
                    layout="rows"
                    size="sm"
                    items={[
                      { term: "Message ID", description: "8e1f…0816" },
                      { term: "Attachments", description: "1" },
                    ]}
                  />
                </DetailPanel.Section>
              </DetailPanel.Body>
            </DetailPanel>
          </div>
        </article>

        <article class="ui-detail-panel-pattern">
          <header>
            <strong>Compact-card note</strong>
            <span>Contents, collaborators, info, and versions use one identical section treatment.</span>
          </header>
          <div class="ui-detail-panel-pattern__frame">
            <DetailPanel class="ui-detail-panel-compact">
              <DetailPanel.Header
                leading={
                  <span class="ui-detail-panel-compact__note-icon" aria-hidden="true">
                    <i class="ti ti-notes" />
                  </span>
                }
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
                    <IconButton variant="ghost" size="xs" label="Open history">
                      <i class="ti ti-history" aria-hidden="true" />
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
                <DetailPanel.Section title="Contents" class="ui-detail-panel-compact__card">
                  <ol class="ui-detail-panel-compact__contents">
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

                <DetailPanel.Section title="Online" class="ui-detail-panel-compact__card">
                  <DescriptionList
                    layout="rows"
                    size="sm"
                    items={[
                      {
                        term: "Person",
                        description: (
                          <span class="ui-detail-panel-compact__person">
                            <Avatar name="Valentin Kolb" size="xs" />
                            Valentin Kolb
                          </span>
                        ),
                      },
                    ]}
                  />
                </DetailPanel.Section>

                <DetailPanel.Section title="Info" class="ui-detail-panel-compact__card">
                  <DescriptionList
                    layout="rows"
                    size="sm"
                    items={[
                      { term: "Created", description: "07 Jul 2026" },
                      { term: "Updated", description: "07 Jul 2026" },
                    ]}
                  />
                </DetailPanel.Section>

                <DetailPanel.Section title="Versions" meta="12" class="ui-detail-panel-compact__card" collapsible>
                  <DescriptionList
                    layout="rows"
                    size="sm"
                    items={[
                      { term: "Latest", description: "Today, 14:32" },
                      { term: "Author", description: "Valentin Kolb" },
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
      description="One dense ledger rhythm at two data extremes: a sparse contact stays intentional through one summary surface and compact actionable empty sections, while a rich request keeps editable facts, related context, and history scanable without a card per group."
      code={`<DetailPanel>
  <DetailPanel.Header
    leading={<Avatar name="Alex Smith" size="sm" />}
    title="Bug report"
    subtitle="Customer request"
    primaryActions={<Toolbar label="Request actions" wrap>…</Toolbar>}
    actions={<IconButton label="Close details">…</IconButton>}
  />
  <DetailPanel.Body>
    <DetailPanel.Summary title="Overview" actions={<Button variant="ghost" size="xs">Edit</Button>}>
      <DescriptionList
        layout="rows"
        size="sm"
        actionVisibility="progressive"
        items={overviewItems}
      />
    </DetailPanel.Summary>
    <DetailPanel.Section
      title="Organization"
      meta="0"
      actions={<Button variant="ghost" size="xs">Add member</Button>}
    >
      <DetailPanel.Action title="No relationships yet" trailing={<>…</>} />
    </DetailPanel.Section>
    <DetailPanel.Section title="History" collapsible>…</DetailPanel.Section>
  </DetailPanel.Body>
</DetailPanel>`}
    >
      <div class="ui-detail-panel-patterns">
        <article class="ui-detail-panel-pattern">
          <header>
            <strong>Sparse contact</strong>
            <span>One useful value still creates an intentional panel.</span>
          </header>
          <div class="ui-detail-panel-pattern__frame">
            <DetailPanel>
              <DetailPanel.Header
                leading={<Avatar name="Capability hardening smoke" size="sm" />}
                title="Capability hardening smoke"
                subtitle="Test Book · Contact"
                primaryActions={
                  <Toolbar label="Contact actions" wrap>
                    <Button variant="secondary" size="xs">
                      <i class="ti ti-mail" aria-hidden="true" /> Email
                    </Button>
                    <Button variant="secondary" size="xs">
                      <i class="ti ti-note" aria-hidden="true" /> Note
                    </Button>
                  </Toolbar>
                }
                actions={
                  <>
                    <IconButton variant="ghost" size="xs" label="Favorite contact">
                      <i class="ti ti-star" aria-hidden="true" />
                    </IconButton>
                    <IconButton variant="primary" size="xs" label="More contact actions">
                      <i class="ti ti-dots" aria-hidden="true" />
                    </IconButton>
                    <IconButton variant="ghost" size="xs" label="Close contact details">
                      <i class="ti ti-x" aria-hidden="true" />
                    </IconButton>
                  </>
                }
              />
              <DetailPanel.Body>
                <DetailPanel.Summary
                  title="Overview"
                  actions={
                    <Button variant="ghost" size="xs">
                      <i class="ti ti-pencil" aria-hidden="true" /> Edit
                    </Button>
                  }
                >
                  <DescriptionList
                    layout="rows"
                    size="sm"
                    actionVisibility="progressive"
                    items={[
                      {
                        term: "Book",
                        description: "Test Book",
                      },
                      {
                        term: "Email",
                        description: "capability-hardening-smoke@example.test",
                        action: (
                          <IconButton variant="ghost" size="xs" label="Send email">
                            <i class="ti ti-mail" aria-hidden="true" />
                          </IconButton>
                        ),
                      },
                      {
                        term: "Phone",
                        description: <span class="text-dimmed">Not added</span>,
                        action: (
                          <IconButton variant="ghost" size="xs" label="Add phone">
                            <i class="ti ti-plus" aria-hidden="true" />
                          </IconButton>
                        ),
                      },
                      {
                        term: "Company",
                        description: <span class="text-dimmed">Not added</span>,
                        action: (
                          <IconButton variant="ghost" size="xs" label="Add company">
                            <i class="ti ti-plus" aria-hidden="true" />
                          </IconButton>
                        ),
                      },
                      {
                        term: "Tags",
                        description: <Tag color="var(--k2b-detail-panel-accent, var(--k2b-accent-600))">Smoke test</Tag>,
                      },
                    ]}
                  />
                </DetailPanel.Summary>
                <DetailPanel.Section
                  title="Organization"
                  meta="0"
                  actions={
                    <Button variant="ghost" size="xs">
                      <i class="ti ti-plus" aria-hidden="true" /> Add member
                    </Button>
                  }
                >
                  <DetailPanel.Action title="No relationships yet" trailing={<i class="ti ti-arrow-right" aria-hidden="true" />} />
                </DetailPanel.Section>
                <DetailPanel.Section
                  title="Notes"
                  meta="0"
                  actions={
                    <Button variant="ghost" size="xs">
                      <i class="ti ti-plus" aria-hidden="true" /> Add note
                    </Button>
                  }
                >
                  <DetailPanel.Action
                    title="Keep decisions and context with this contact"
                    trailing={<i class="ti ti-arrow-right" aria-hidden="true" />}
                  />
                </DetailPanel.Section>
                <DetailPanel.Section title="More details" meta="3 groups" collapsible>
                  <DescriptionList
                    layout="rows"
                    size="sm"
                    items={[
                      { term: "Birthday", description: "Not added" },
                      { term: "Language", description: "Not added" },
                      { term: "Address", description: "Not added" },
                    ]}
                  />
                </DetailPanel.Section>
              </DetailPanel.Body>
            </DetailPanel>
          </div>
        </article>

        <article class="ui-detail-panel-pattern">
          <header>
            <strong>Rich request</strong>
            <span>Editable workflow facts stay anchored while related context remains open.</span>
          </header>
          <div class="ui-detail-panel-pattern__frame">
            <DetailPanel>
              <DetailPanel.Header
                leading={<Avatar name="Alex Smith" size="sm" />}
                title="Bug report"
                subtitle="Customer request · 5 minutes ago"
                primaryActions={
                  <Toolbar label="Request actions" wrap>
                    <Button variant="secondary" size="xs">
                      <i class="ti ti-message-reply" aria-hidden="true" /> Reply
                    </Button>
                    <Button variant="secondary" size="xs">
                      <i class="ti ti-note" aria-hidden="true" /> Add note
                    </Button>
                  </Toolbar>
                }
                actions={
                  <IconButton variant="ghost" size="xs" label="Close request details">
                    <i class="ti ti-x" aria-hidden="true" />
                  </IconButton>
                }
              />
              <DetailPanel.Body>
                <DetailPanel.Summary title="Request">
                  <DescriptionList
                    layout="rows"
                    size="sm"
                    actionVisibility="progressive"
                    items={[
                      {
                        term: "Status",
                        description: (
                          <SelectChip
                            aria-label="Request status"
                            value={status}
                            onValueChange={setStatus}
                            options={[
                              { value: "needs-response", label: "Needs response", icon: "ti ti-message-reply" },
                              { value: "investigating", label: "Investigating", icon: "ti ti-search" },
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
                      {
                        term: "Priority",
                        description: (
                          <SelectChip
                            aria-label="Request priority"
                            value={priority}
                            onValueChange={setPriority}
                            options={[
                              { value: "normal", label: "Normal", icon: "ti ti-minus" },
                              { value: "high", label: "High", icon: "ti ti-arrow-up" },
                            ]}
                          />
                        ),
                      },
                      {
                        term: "Labels",
                        description: <Tag color="#6366f1">Product feedback</Tag>,
                        action: (
                          <IconButton variant="ghost" size="xs" label="Add request label">
                            <i class="ti ti-plus" aria-hidden="true" />
                          </IconButton>
                        ),
                      },
                      {
                        term: "Thread tier",
                        description: "Growth",
                      },
                    ]}
                  />
                </DetailPanel.Summary>
                <DetailPanel.Section
                  title="Northstar Studio"
                  actions={
                    <IconButton variant="ghost" size="xs" label="Company actions">
                      <i class="ti ti-dots" aria-hidden="true" />
                    </IconButton>
                  }
                >
                  <DescriptionList
                    layout="rows"
                    size="sm"
                    actionVisibility="progressive"
                    items={[
                      { term: "Company tier", description: "Growth" },
                      {
                        term: "Slack channels",
                        description: "Not connected",
                        action: (
                          <Button variant="ghost" size="xs">
                            <i class="ti ti-plus" aria-hidden="true" /> Add channel
                          </Button>
                        ),
                      },
                      { term: "Domain", description: "northstar.example" },
                    ]}
                  />
                </DetailPanel.Section>
                <DetailPanel.Section
                  title="Alex Smith"
                  actions={
                    <IconButton variant="ghost" size="xs" label="Contact actions">
                      <i class="ti ti-dots" aria-hidden="true" />
                    </IconButton>
                  }
                >
                  <DescriptionList
                    layout="rows"
                    size="sm"
                    actionVisibility="progressive"
                    items={[
                      { term: "Email", description: "alex@northstar.example" },
                      {
                        term: "Groups",
                        description: <Tag color="#0f766e">Beta customers</Tag>,
                        action: (
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
                <DetailPanel.Section title="Diagnostics" meta="3 fields" collapsible>
                  <DescriptionList
                    layout="rows"
                    size="sm"
                    items={[
                      { term: "Source", description: "Email" },
                      { term: "Language", description: "English" },
                      { term: "Request ID", description: <code class="text-xs">req_81d3</code> },
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
      <DiscussionProposalDemo />
      <DetailPanelGroupedDemo />
      <DetailPanelCompactCardsDemo />
      <DetailPanelPatternsDemo />
      <DetailPanelDemo />
      <DetailPanelRecordDemo />
    </DemoGrid>
  ),
  discussion: () => (
    <DemoGrid columns="one">
      <DiscussionProposalDemo />
    </DemoGrid>
  ),
  "floating-window": () => (
    <DemoGrid columns="one">
      <FloatingDemo />
    </DemoGrid>
  ),
};

export default demos;
