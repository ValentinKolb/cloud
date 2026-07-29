import {
  AppOverview,
  AppWorkspace,
  Button,
  createPanesValue,
  DataPanel,
  FloatingWindow,
  Pagination,
  PanelDialog,
  PanelHeader,
  Panes,
  SettingsField,
  SettingsModal,
  SettingsPanelFooter,
  SettingsSaveBar,
  TextInput,
} from "@k2b/ui";
import { createSignal, Show } from "solid-js";
import { DemoCard } from "../DemoCard";
import { DemoGrid, type DemoSection } from "./types";

const WorkspaceDemo = () => {
  const [activeView, setActiveView] = createSignal<"items" | "activity">("items");
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
        <AppWorkspace.SidebarHeader title="Inventory" subtitle="12 items" icon="ti ti-box" />
        <AppWorkspace.SidebarDesktop>
          <AppWorkspace.SidebarBody>
            <AppWorkspace.SidebarItem active={activeView() === "items"} onClick={() => setActiveView("items")}>
              <AppWorkspace.SidebarItemIcon icon="ti ti-list" />
              <AppWorkspace.SidebarItemLabel>Items</AppWorkspace.SidebarItemLabel>
              <AppWorkspace.SidebarItemMeta>12</AppWorkspace.SidebarItemMeta>
            </AppWorkspace.SidebarItem>
            <AppWorkspace.SidebarItem active={activeView() === "activity"} onClick={() => setActiveView("activity")}>
              <AppWorkspace.SidebarItemIcon icon="ti ti-history" />
              <AppWorkspace.SidebarItemLabel>Activity</AppWorkspace.SidebarItemLabel>
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarBody>
        </AppWorkspace.SidebarDesktop>
        <AppWorkspace.SidebarMobile>
          <AppWorkspace.SidebarMobileItems>
            <AppWorkspace.SidebarItem active={activeView() === "items"} icon="ti ti-list" onClick={() => setActiveView("items")}>
              Items
            </AppWorkspace.SidebarItem>
            <AppWorkspace.SidebarItem
              active={activeView() === "activity"}
              icon="ti ti-history"
              onClick={() => setActiveView("activity")}
            >
              Activity
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarMobileItems>
        </AppWorkspace.SidebarMobile>
      </AppWorkspace.Sidebar>
      <AppWorkspace.Content>
        <AppWorkspace.Main mobilePane="main">
          <div class="ui-demo-pane">
            <div class="ui-workspace-demo__body">
              <strong>{activeView() === "items" ? "Inventory items" : "Recent activity"}</strong>
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
const [paneOpen, setPaneOpen] = createSignal(false);
const [detailOpen, setDetailOpen] = createSignal(true);
const [drawerOpen, setDrawerOpen] = createSignal(true);

<AppWorkspace layoutState={layout} onLayoutChange={setLayout}>
  <AppWorkspace.Sidebar collapsible>…</AppWorkspace.Sidebar>
  <AppWorkspace.Content>
    <AppWorkspace.Main>
      <AppWorkspace.MainPane id="main-2" label="Main 2" open={paneOpen()}>…</AppWorkspace.MainPane>
      …
    </AppWorkspace.Main>
    <AppWorkspace.Detail id="record" open={detailOpen()}>…</AppWorkspace.Detail>
  </AppWorkspace.Content>
  <AppWorkspace.BottomDrawer id="events" open={drawerOpen()}>…</AppWorkspace.BottomDrawer>
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
    <DemoCard id="panes" chip={{ kind: "component", name: "Panes", from: "@k2b/ui" }} description="A controlled, serializable tree of tabs and splits with resize, reorder, move, split, and close behavior." code={`const [layout, setLayout] = createSignal(createPanesValue(["source", "preview"]));
<Panes.Root value={layout()} onChange={setLayout}>
  <Panes.Element id="source" title="Source">…</Panes.Element>
  <Panes.Element id="preview" title="Preview">…</Panes.Element>
</Panes.Root>`}>
      <div class="ui-panes-demo">
        <Panes.Root value={value()} onChange={setValue} label="Editor panes">
          <Panes.Element id="source" title="Source" icon="ti ti-code"><div class="ui-pane-body" data-tone="blue"><span>Source</span></div></Panes.Element>
          <Panes.Element id="preview" title="Preview" icon="ti ti-eye"><div class="ui-pane-body" data-tone="violet"><span>Preview</span></div></Panes.Element>
          <Panes.Element id="data" title="Data" icon="ti ti-database"><div class="ui-pane-body" data-tone="emerald"><span>Data</span></div></Panes.Element>
        </Panes.Root>
      </div>
    </DemoCard>
  );
};

const OverviewDemo = () => (
  <DemoCard id="overview" chip={{ kind: "component", name: "AppOverview", from: "@k2b/ui" }} description="An application landing page with a required identity icon, a strong main task, and a quieter supporting panel." code={`<AppOverview title="Projects" subtitle="Your work" icon="ti ti-folders">
  <AppOverview.Main title="Recent">…</AppOverview.Main>
  <AppOverview.Aside title="Status">…</AppOverview.Aside>
</AppOverview>`}>
    <AppOverview title="Projects" subtitle="Portable application overview" icon="ti ti-folders">
      <AppOverview.Main title="Recent work" description="Updated today">
        <AppOverview.EmptyState title="No recent projects" description="Open a project to see it here." icon="ti ti-folder-off"><Button size="sm">New project</Button></AppOverview.EmptyState>
      </AppOverview.Main>
      <AppOverview.Aside title="Workspace status"><p>Everything is ready.</p></AppOverview.Aside>
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
    code={`<DataPanel title="Deployments" subtitle="2 active" actions={<Button>New</Button>}>
  <DeploymentRows />
</DataPanel>

<PanelHeader title="Runtime" subtitle="Healthy" actions={<Button>Restart</Button>} />`}
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
        actions={<Button size="sm" variant="secondary">Restart</Button>}
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
    <DemoCard id="settings-modal" chip={[
      { kind: "component", name: "SettingsModal", from: "@k2b/ui" },
      { kind: "component", name: "SettingsField", from: "@k2b/ui" },
      { kind: "component", name: "SettingsSaveBar", from: "@k2b/ui" },
      { kind: "component", name: "SettingsPanelFooter", from: "@k2b/ui" },
    ]} description="Compound settings tabs plus field, sticky-save, and panel-footer helpers, without a persistence backend." code={`<SettingsModal title="Settings" activeTab={active()} onTabChange={setActive}>
  <SettingsModal.Tab id="general" title="General" icon="ti ti-adjustments">
    <SettingsField
      label="Endpoint"
      description="Public service URL"
      error={() => undefined}
      changed={changed}
    >
      …
    </SettingsField>
  </SettingsModal.Tab>
</SettingsModal>`}>
      <div class="ui-settings-demo">
        <SettingsModal title="Application settings" activeTab={active()} onTabChange={setActive}>
          <SettingsModal.Tab id="general" title="General" icon="ti ti-adjustments">
            <SettingsField
              label="Endpoint"
              description="Public service URL"
              error={() => undefined}
              changed={changed}
            >
            <TextInput aria-label="Endpoint" value={endpoint()} onValueChange={setEndpoint} />
            </SettingsField>
          </SettingsModal.Tab>
          <SettingsModal.Tab
            id="security"
            title="Security"
            icon="ti ti-lock"
            description="Authentication controls"
          >
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

const PanelDemo = () => {
  const [tab, setTab] = createSignal("general");
  return (
    <DemoCard id="panel-dialog" chip={{ kind: "component", name: "PanelDialog", from: "@k2b/ui" }} description="A composable contained or floating frame for complex editors. The host chooses how it opens." code={`<PanelDialog>
  <PanelDialog.Header title="Edit project" />
  <PanelDialog.Body>…</PanelDialog.Body>
  <PanelDialog.Footer>…</PanelDialog.Footer>
</PanelDialog>`}>
      <PanelDialog surface="contained">
        <PanelDialog.Header title="Edit project" subtitle="General settings" icon="ti ti-settings" />
        <PanelDialog.Tabs value={tab()} onValueChange={setTab} options={[{ value: "general", label: "General" }, { value: "access", label: "Access" }]} />
        <PanelDialog.Body>
          <PanelDialog.Section title="Profile" subtitle="Visible to collaborators" icon="ti ti-user">
            <TextInput label="Name" value="Launch plan" />
          </PanelDialog.Section>
        </PanelDialog.Body>
        <PanelDialog.Footer><div class="ui-demo-row"><Button variant="secondary">Cancel</Button><Button>Save</Button></div></PanelDialog.Footer>
      </PanelDialog>
    </DemoCard>
  );
};

const FloatingDemo = () => {
  const [open, setOpen] = createSignal(false);
  let scope: HTMLDivElement | undefined;
  return (
    <DemoCard id="floating-window" chip={{ kind: "component", name: "FloatingWindow", from: "@k2b/ui" }} description="A movable, resizable utility window that fits the viewport, uses an explicit portal scope, and becomes an inset surface on mobile." code={`<FloatingWindow
  title="Inspector"
  resolveScope={() => appShell}
  onClose={() => setOpen(false)}
>
  …
</FloatingWindow>`}>
      <div ref={scope}>
        <Button variant="secondary" onClick={() => setOpen(true)}>Open inspector</Button>
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

const PaginationDemo = () => (
  <DemoCard id="pagination" chip={{ kind: "component", name: "Pagination", from: "@k2b/ui" }} description="Server-friendly URL pagination with compact page windows and native navigation semantics." code={`<Pagination currentPage={4} totalPages={12} baseUrl="?page=" />`}>
    <Pagination currentPage={4} totalPages={12} baseUrl="?page=" />
  </DemoCard>
);

const demos: DemoSection = {
  workspace: () => <DemoGrid columns="one"><WorkspaceDemo /></DemoGrid>,
  panes: () => <DemoGrid columns="one"><PanesDemo /></DemoGrid>,
  overview: () => <DemoGrid columns="one"><OverviewDemo /><DataPanelDemo /></DemoGrid>,
  "settings-modal": () => <DemoGrid columns="one"><SettingsDemo /></DemoGrid>,
  "panel-dialog": () => <DemoGrid columns="one"><PanelDemo /></DemoGrid>,
  "floating-window": () => <DemoGrid columns="one"><FloatingDemo /></DemoGrid>,
  pagination: () => <DemoGrid columns="one"><PaginationDemo /></DemoGrid>,
};

export default demos;
