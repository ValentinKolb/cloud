import {
  AppWorkspace,
  Button,
  Chart,
  Checkbox,
  CopyButton,
  IconButton,
  NoticeCard,
  NoticeGrid,
  NumberInput,
  Placeholder,
  ProgressBar,
  prompts,
  SegmentedControl,
  Select,
  StatusBadge,
  Switch,
  TextInput,
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

  const confirmAction = async () => {
    const result = await prompts.confirm("The dialog is rendered in the scoped @k2b/ui portal root.", {
      title: "Scoped prompt",
      confirmText: "Confirm",
    });
    setConfirmed(result);
  };

  return (
    <div
      class="k2b-ui"
      data-theme={theme()}
      style="--k2b-accent-500:#8b5cf6;--k2b-accent-600:#7c3aed;--k2b-accent-700:#6d28d9;height:calc(100dvh - 45px);padding:16px"
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
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="ghost">Ghost</Button>
                  <Button variant="danger">Delete</Button>
                  <Button variant="success">Publish</Button>
                  <Button loading loadingLabel="Saving">
                    Save
                  </Button>
                  <IconButton label="Settings" variant="secondary">
                    <i class="ti ti-settings" aria-hidden="true" />
                  </IconButton>
                  <CopyButton value="bun add @k2b/ui" variant="secondary" />
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
                    onValueChange={setRole}
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
            </div>
          </AppWorkspace.Main>
        </AppWorkspace.Content>
      </AppWorkspace>
    </div>
  );
}
