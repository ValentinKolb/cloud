import {
  AppOverview,
  AppWorkspace,
  Avatar,
  Button,
  Chart,
  Checkbox,
  CheckboxCard,
  Combobox,
  ContextMenu,
  CopyButton,
  DataPanel,
  Dropdown,
  dialogCore,
  FilterChip,
  IconButton,
  LinkCard,
  MultiSelectInput,
  NoticeCard,
  NoticeGrid,
  NumberInput,
  PanelDialog,
  Placeholder,
  ProgressBar,
  panelDialogOptions,
  prompts,
  RemoveBtn,
  SegmentedControl,
  Select,
  SelectChip,
  SpotlightButton,
  StatCell,
  StatGrid,
  StatusBadge,
  Switch,
  TagsInput,
  TextInput,
  Tooltip,
  toast,
  Widget,
  WidgetHero,
  WidgetList,
  WidgetPills,
  WidgetStat,
  WidgetStatus,
} from "@k2b/ui";
import { createSignal, type JSX } from "solid-js";

const Section = (props: { id: string; title: string; children: JSX.Element }) => (
  <section
    id={props.id}
    style="scroll-margin-top:16px;border:1px solid var(--k2b-border);border-radius:var(--k2b-radius-surface);background:var(--k2b-surface);padding:16px"
  >
    <h2 style="margin:0 0 14px;font-size:14px">{props.title}</h2>
    {props.children}
  </section>
);

export default function Demo() {
  const [theme, setTheme] = createSignal<"light" | "dark">("light");
  const [confirmed, setConfirmed] = createSignal(false);
  const [view, setView] = createSignal<"table" | "cards">("table");
  const [name, setName] = createSignal("Ada");
  const [count, setCount] = createSignal<number | null>(3);
  const [enabled, setEnabled] = createSignal(true);
  const [accepted, setAccepted] = createSignal(false);
  const [role, setRole] = createSignal<"member" | "admin">("member");
  const [density, setDensity] = createSignal<"compact" | "comfortable">("comfortable");
  const [tags, setTags] = createSignal(["solid", "ssr"]);
  const [teams, setTeams] = createSignal(["platform"]);
  const [dialogTab, setDialogTab] = createSignal<"details" | "history">("details");
  const [filters, setFilters] = createSignal<string[]>(["open"]);
  const [actionMessage, setActionMessage] = createSignal("No action yet");
  const [removed, setRemoved] = createSignal(false);

  const confirmAction = async () => {
    const result = await prompts.confirm("The dialog is rendered in the scoped @k2b/ui portal root.", {
      title: "Scoped prompt",
      confirmText: "Confirm",
    });
    setConfirmed(Boolean(result));
  };

  const openForm = async () => {
    const result = await prompts.form({
      title: "Reusable form prompt",
      fields: {
        name: { type: "text", label: "Name", default: "Ada", required: true },
        tags: { type: "tags", label: "Tags", default: ["solid"], minTags: 1, required: true },
        pin: { type: "pin", label: "PIN", length: 4, required: true },
      },
    });
    if (result) toast.success(`Saved ${result.name} with ${result.tags.length} tags`);
  };

  const openSearch = async () => {
    const result = await prompts.search(
      ({ query, abortSignal }) => {
        if (abortSignal.aborted) return [];
        return [
          { label: "PanelDialog", desc: "Composable dialog layout", value: "panel-dialog" },
          { label: "Placeholder", desc: "Compact empty states", value: "placeholder" },
        ].filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));
      },
      {
        title: "Search components",
        placeholder: "Type a component name",
        minQueryLength: 1,
        debounceMs: 0,
      },
    );
    if (result) toast.success(`Selected ${result.label}`);
  };

  const openPanel = () =>
    dialogCore.open<void>(
      (close) => (
        <PanelDialog surface="floating">
          <PanelDialog.Header
            title="Reusable panel dialog"
            subtitle="Layout supplied by @k2b/ui, data supplied by the consumer."
            icon="ti ti-layout"
            close={() => close()}
          />
          <PanelDialog.Tabs
            value={dialogTab()}
            onValueChange={setDialogTab}
            options={[
              { value: "details", label: "Details", icon: "ti ti-info-circle" },
              { value: "history", label: "History", icon: "ti ti-history" },
            ]}
          />
          <PanelDialog.Body>
            <PanelDialog.Section title={dialogTab() === "details" ? "Package boundary" : "Recent activity"}>
              {dialogTab() === "details"
                ? "This dialog has no knowledge of Cloud routes, permissions, or stores."
                : "The active tab is controlled by the consuming application."}
            </PanelDialog.Section>
          </PanelDialog.Body>
          <PanelDialog.Footer>
            <Button
              variant="secondary"
              onClick={async () => {
                if (await prompts.confirm("The panel remains mounted underneath this prompt.", { title: "Nested prompt" })) {
                  toast.success("Nested prompt confirmed.");
                }
              }}
            >
              Open nested prompt
            </Button>
            <Button variant="secondary" onClick={() => close()}>
              Close
            </Button>
          </PanelDialog.Footer>
        </PanelDialog>
      ),
      panelDialogOptions,
    );

  return (
    <div
      class="k2b-ui"
      data-theme={theme()}
      style="--k2b-accent-50:#f5f3ff;--k2b-accent-100:#ede9fe;--k2b-accent-300:#c4b5fd;--k2b-accent-400:#a78bfa;--k2b-accent-500:#8b5cf6;--k2b-accent-600:#7c3aed;--k2b-accent-700:#6d28d9;--k2b-accent-900:#4c1d95;--k2b-accent-950:#2e1065;height:calc(100dvh - 45px);padding:16px"
    >
      <AppWorkspace>
        <AppWorkspace.Sidebar>
          <AppWorkspace.SidebarHeader title="@k2b/ui" subtitle="Standalone SSR fixture" icon={false} />
          <AppWorkspace.SidebarBody>
            <AppWorkspace.SidebarSection title="Foundation">
              <AppWorkspace.SidebarItem href="#actions" navigation="document" icon="ti ti-pointer">
                Actions
              </AppWorkspace.SidebarItem>
              <AppWorkspace.SidebarItem href="#inputs" navigation="document" icon="ti ti-forms">
                Inputs
              </AppWorkspace.SidebarItem>
              <AppWorkspace.SidebarItem href="#surfaces" navigation="document" icon="ti ti-box">
                Surfaces
              </AppWorkspace.SidebarItem>
              <AppWorkspace.SidebarItem href="#content" navigation="document" icon="ti ti-chart-line">
                Content
              </AppWorkspace.SidebarItem>
              <AppWorkspace.SidebarItem href="#composition" navigation="document" icon="ti ti-layout-dashboard">
                Composition
              </AppWorkspace.SidebarItem>
              <AppWorkspace.SidebarItem href="#widgets" navigation="document" icon="ti ti-box-multiple">
                Widgets
              </AppWorkspace.SidebarItem>
            </AppWorkspace.SidebarSection>
          </AppWorkspace.SidebarBody>
        </AppWorkspace.Sidebar>

        <AppWorkspace.Content>
          <AppWorkspace.Main>
            <div style="display:flex;flex-direction:column;gap:16px;padding:20px">
              <header style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px">
                <div>
                  <h1 style="margin:0;font-size:20px">Independent package consumer</h1>
                  <p style="margin:4px 0 0;color:var(--k2b-text-muted);font-size:13px">
                    Solid components, scoped CSS, custom accent stack, and no Cloud import.
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setTheme(theme() === "light" ? "dark" : "light")}>
                  <i class="ti ti-sun-moon" aria-hidden="true" />
                  Toggle theme
                </Button>
              </header>

              <Section id="actions" title="Actions">
                <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">
                  <Button onClick={confirmAction}>Open prompt</Button>
                  <Button variant="secondary" onClick={openForm}>
                    Open form
                  </Button>
                  <Button variant="secondary" onClick={openSearch}>
                    Open search
                  </Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="ghost">Ghost</Button>
                  <Button variant="danger">Delete</Button>
                  <Button variant="success">Publish</Button>
                  <Button loading loadingLabel="Saving">
                    Save
                  </Button>
                  <Tooltip content="A keyboard-accessible tooltip">
                    <IconButton label="Settings" variant="secondary">
                      <i class="ti ti-settings" aria-hidden="true" />
                    </IconButton>
                  </Tooltip>
                  <CopyButton value="bun add @k2b/ui" variant="secondary" />
                  <Dropdown
                    label="Project actions"
                    openOnHover
                    trigger={<Button variant="secondary">Menu</Button>}
                    elements={[
                      { label: "Rename", icon: "ti ti-pencil", action: () => setActionMessage("Renamed") },
                      {
                        sectionLabel: "Danger zone",
                        items: [{ label: "Archive", icon: "ti ti-archive", variant: "danger", action: () => setActionMessage("Archived") }],
                      },
                    ]}
                  />
                  <FilterChip
                    label="State"
                    icon="ti ti-filter"
                    value={filters()}
                    onChange={setFilters}
                    options={[
                      {
                        label: "State",
                        options: [
                          { value: "open", label: "Open" },
                          { value: "closed", label: "Closed" },
                        ],
                      },
                      {
                        label: "Flags",
                        multiple: true,
                        options: [
                          { value: "urgent", label: "Urgent", color: "#ef4444" },
                          { value: "owned", label: "Owned" },
                        ],
                      },
                    ]}
                  />
                  <SpotlightButton onClick={openSearch} variant="chip" />
                  <RemoveBtn
                    ariaLabel="Remove example"
                    disabled={removed()}
                    onClick={() => {
                      setRemoved(true);
                      setActionMessage("Removed");
                    }}
                  />
                  <ContextMenu
                    label="Example context actions"
                    items={[
                      { id: "duplicate", label: "Duplicate", icon: "ti ti-copy", onSelect: () => setActionMessage("Duplicated") },
                      { id: "delete", label: "Delete", danger: true, onSelect: () => setActionMessage("Deleted") },
                    ]}
                  >
                    <span style="display:inline-flex;min-height:32px;align-items:center;padding:0 10px;border:1px dashed var(--k2b-border);border-radius:var(--k2b-radius-control);font-size:12px">
                      Right-click me
                    </span>
                  </ContextMenu>
                  <Button variant="secondary" onClick={() => toast.success("The package owns this scoped toast.")}>
                    Show toast
                  </Button>
                  <Button variant="secondary" onClick={openPanel}>
                    Open panel
                  </Button>
                  <SegmentedControl
                    label="Layout"
                    value={view()}
                    onValueChange={setView}
                    options={[
                      { value: "table", label: "Table" },
                      { value: "cards", label: "Cards" },
                    ]}
                  />
                </div>
                <p id="action-result" style="margin:10px 0 0;color:var(--k2b-text-muted);font-size:12px">
                  {actionMessage()} · filters: {filters().join(", ") || "none"}
                </p>
              </Section>

              <Section id="inputs" title="Inputs">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px">
                  <TextInput
                    label="Display name"
                    description={`Current value: ${name() || "empty"}`}
                    value={name()}
                    onValueChange={setName}
                    icon="ti ti-user"
                    clearable
                  />
                  <TextInput label="Email" value="not-an-email" error="Enter a valid email address." type="email" />
                  <NumberInput label="Seats" value={count()} onValueChange={setCount} min={1} max={20} />
                  <Select
                    label="Role"
                    value={role()}
                    onValueChange={(value) => value && setRole(value)}
                    searchable
                    options={[
                      { value: "member", label: "Member" },
                      { value: "admin", label: "Administrator" },
                    ]}
                  />
                  <Checkbox
                    label="Accept updates"
                    description="Receive the monthly product note."
                    checked={accepted()}
                    onCheckedChange={setAccepted}
                  />
                  <Switch
                    label="Automation"
                    description={enabled() ? "Enabled" : "Disabled"}
                    checked={enabled()}
                    onCheckedChange={setEnabled}
                  />
                  <CheckboxCard
                    label="Early access"
                    description="Enable preview components for this project."
                    icon="ti ti-flask"
                    checked={accepted()}
                    onCheckedChange={setAccepted}
                  />
                  <Combobox
                    label="Add collaborator"
                    placeholder="Search people…"
                    options={[
                      { value: "ada", label: "Ada Lovelace", description: "Engineering", icon: "ti ti-user" },
                      { value: "grace", label: "Grace Hopper", description: "Research", icon: "ti ti-user" },
                    ]}
                    onSelect={(option) => setActionMessage(`Selected ${option.label}`)}
                  />
                  <TagsInput label="Tags" values={tags()} onValuesChange={setTags} placeholder="Add tag" />
                  <MultiSelectInput
                    label="Teams"
                    values={teams()}
                    onValuesChange={setTeams}
                    options={[
                      { value: "platform", label: "Platform", description: "Runtime and infrastructure" },
                      { value: "design", label: "Design", description: "Product system" },
                    ]}
                  />
                  <SelectChip
                    label="Display density"
                    value={density()}
                    onValueChange={setDensity}
                    options={[
                      { value: "compact", label: "Compact" },
                      { value: "comfortable", label: "Comfortable" },
                    ]}
                  />
                </div>
              </Section>

              <Section id="surfaces" title="Surfaces">
                <div style="display:flex;flex-direction:column;gap:14px">
                  <div style="display:flex;flex-wrap:wrap;gap:6px">
                    <StatusBadge dot>Draft</StatusBadge>
                    <StatusBadge tone="info" icon="ti ti-info-circle">
                      Processing
                    </StatusBadge>
                    <StatusBadge tone="success" icon="ti ti-check">
                      Healthy
                    </StatusBadge>
                    <StatusBadge tone="warning">Needs review</StatusBadge>
                    <StatusBadge tone="danger">Failed</StatusBadge>
                  </div>
                  <ProgressBar label="Migration readiness" value={42} tone="info" />
                  <NoticeGrid>
                    <NoticeCard title="Generic by design" icon="ti ti-components" tone="success">
                      No Cloud services, routes, permissions, or application state.
                    </NoticeCard>
                    <NoticeCard title="Package boundary" icon="ti ti-package" tone="info" action={<Button variant="ghost">Inspect</Button>}>
                      The fixture consumes @k2b/ui like an external SSR project.
                    </NoticeCard>
                  </NoticeGrid>
                  <Placeholder
                    variant="panel"
                    title={confirmed() ? "Prompt confirmed" : "No selection yet"}
                    description="This state uses only @k2b/ui semantic tokens."
                  />
                </div>
              </Section>

              <Section id="content" title="Content / Chart">
                <Chart
                  kind="line"
                  label="Example request volume"
                  style="height:15rem"
                  series={[
                    {
                      label: "Requests",
                      data: [
                        { x: 1, y: 12 },
                        { x: 2, y: 19 },
                        { x: 3, y: 14 },
                        { x: 4, y: 27 },
                      ],
                    },
                  ]}
                />
              </Section>

              <Section id="composition" title="Application composition">
                <AppOverview title="Operations" subtitle="A generic overview shell" icon="ti ti-activity">
                  <AppOverview.Main title="Runtime" description="Useful structure without product assumptions.">
                    <DataPanel
                      title="Services"
                      subtitle="Three monitored services"
                      actions={
                        <StatusBadge tone="success" dot>
                          Healthy
                        </StatusBadge>
                      }
                    >
                      <StatGrid columns={3}>
                        <StatCell label="Requests" value="12.4k" sub="last 24 hours" tone="info" trend={[8, 11, 9, 14, 12]} />
                        <StatCell label="Success" value="99.8%" sub="within SLO" tone="success" />
                        <StatCell label="Latency" value="84ms" sub="p95" tone="warning" />
                      </StatGrid>
                    </DataPanel>
                  </AppOverview.Main>
                  <AppOverview.Aside title="People" description="Generic identity surfaces">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                      <Avatar name="Ada Lovelace" />
                      <span style="font-size:12px">Ada Lovelace</span>
                    </div>
                    <LinkCard
                      href="#widgets"
                      title="Open dashboard"
                      description="Composable widget family"
                      icon="ti ti-layout-dashboard"
                      tone="info"
                    />
                  </AppOverview.Aside>
                </AppOverview>
              </Section>

              <Section id="widgets" title="Dashboard widgets">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px">
                  <Widget title="Platform health" subtitle="Last checked just now" icon="ti ti-heartbeat" size="compact">
                    <WidgetStatus
                      title="All systems operational"
                      description="No active incidents"
                      icon="ti ti-circle-check"
                      tone="success"
                    />
                    <WidgetPills
                      items={[
                        { label: "Apps", value: 12, tone: "info" },
                        { label: "Checks", value: 48, tone: "success" },
                      ]}
                    />
                  </Widget>
                  <Widget title="Requests" subtitle="Last 24 hours" icon="ti ti-chart-line" size="compact">
                    <WidgetStat
                      label="Total"
                      value="12,420"
                      description="Across all services"
                      tone="info"
                      accent={{ text: "+8.2%", icon: "ti ti-trending-up", tone: "success" }}
                    />
                  </Widget>
                  <Widget title="Activity" subtitle="Most recent" icon="ti ti-list" size="compact">
                    <WidgetHero title="2 actions need review" subtitle="Oldest item is 18 minutes old" icon="ti ti-bolt" tone="warning" />
                    <WidgetList
                      items={[
                        { label: "Deployment completed", description: "API", meta: "2m", icon: "ti ti-check", tone: "success" },
                        { label: "Configuration changed", description: "Worker", meta: "9m", icon: "ti ti-settings", tone: "info" },
                      ]}
                    />
                  </Widget>
                </div>
              </Section>
            </div>
          </AppWorkspace.Main>
        </AppWorkspace.Content>
      </AppWorkspace>
    </div>
  );
}
