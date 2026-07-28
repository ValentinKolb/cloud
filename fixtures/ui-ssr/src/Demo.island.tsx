import {
  AppOverview,
  Avatar,
  Button,
  Checkbox,
  ColorInput,
  CodeDisplay,
  DatePicker,
  LinkCard,
  MarkdownView,
  NoticeCard,
  NoticeGrid,
  Pagination,
  PinInput,
  ProgressBar,
  RangePicker,
  Select,
  SettingsModal,
  Slider,
  StatCell,
  StatGrid,
  StatusBadge,
  StructuredDataPreview,
  Switch,
  Widget,
  WidgetHero,
  WidgetList,
  WidgetPills,
  WidgetStat,
  WidgetStatus,
  prompts,
  toast,
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
  const [enabled, setEnabled] = createSignal(true);
  const [accepted, setAccepted] = createSignal(false);
  const [role, setRole] = createSignal("member");
  const [date, setDate] = createSignal<string | null>("2026-07-28");
  const [pin, setPin] = createSignal("123");
  const [balance, setBalance] = createSignal(20);
  const [color, setColor] = createSignal("#2563eb");
  const [transparent, setTransparent] = createSignal(false);

  const confirmAction = async () => {
    if (await prompts.confirm("This dialog is rendered by @k2b/ui.", { title: "Portable prompt" })) {
      toast.success("Confirmed");
    }
  };

  return (
    <div class="k2b-ui" data-theme={theme()}>
      <div style="min-height:100vh;background:var(--k2b-app-background);color:var(--k2b-text);padding:24px">
        <header style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 auto 20px;max-width:1120px">
          <div>
            <p style="margin:0;color:var(--k2b-text-muted);font-size:12px">@k2b/ui standalone fixture</p>
            <h1 style="margin:3px 0 0;font-size:24px">Certified package surface</h1>
          </div>
          <Button variant="secondary" onClick={() => setTheme(theme() === "light" ? "dark" : "light")}>
            <i class={theme() === "light" ? "ti ti-moon" : "ti ti-sun"} aria-hidden="true" />
            Toggle theme
          </Button>
        </header>

        <main style="display:grid;gap:16px;margin:0 auto;max-width:1120px">
          <Section id="inputs" title="Inputs">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px">
              <Select
                label="Role"
                value={role()}
                onValueChange={(value) => value && setRole(value)}
                options={[
                  { value: "member", label: "Member" },
                  { value: "admin", label: "Administrator" },
                ]}
              />
              <DatePicker label="Release date" value={date()} onValueChange={setDate} clearable />
              <PinInput label="Access code" value={pin()} onValueChange={setPin} length={6} />
              <Slider label="Balance" value={balance()} onValueChange={setBalance} min={-100} max={100} center defaultValue={0} />
              <ColorInput
                label="Accent"
                value={color()}
                onValueChange={setColor}
                transparent
                isTransparent={transparent()}
                onTransparentChange={setTransparent}
              />
              <div style="display:grid;gap:10px;align-content:start">
                <Checkbox label="Accept updates" checked={accepted()} onCheckedChange={setAccepted} />
                <Switch label="Automation" checked={enabled()} onCheckedChange={setEnabled} />
              </div>
            </div>
          </Section>

          <Section id="surfaces" title="Surfaces and feedback">
            <div style="display:grid;gap:14px">
              <div style="display:flex;flex-wrap:wrap;gap:6px">
                <StatusBadge label="Healthy" tone="success" />
                <StatusBadge label="Running" tone="running" variant="dot" />
                <StatusBadge label="Needs review" tone="warning" variant="text" />
                <StatusBadge label="Failed" tone="danger" />
              </div>
              <ProgressBar label="Migration readiness" value={68} showValue />
              <NoticeGrid>
                <NoticeCard title="Generic by design" tone="success">
                  No Cloud services, routes, permissions, or application state.
                </NoticeCard>
                <NoticeCard title="Prompt kernel" tone="info" action={<Button onClick={confirmAction}>Open prompt</Button>}>
                  Dialogs remain scoped to the package root.
                </NoticeCard>
              </NoticeGrid>
            </div>
          </Section>

          <Section id="content" title="Content">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">
              <CodeDisplay title="Query" language="sql" code={"select service, latency\nfrom telemetry\nwhere healthy = true;"} />
              <StructuredDataPreview
                title="Payload"
                data={{ service: "gateway", healthy: true, latency: { p95: 84, unit: "ms" } }}
              />
              <MarkdownView html="<h3>Trusted Markdown</h3><p>Rendered HTML stays a deliberate consumer boundary.</p>" smallHeadings />
              <div style="display:grid;gap:12px;align-content:start">
                <RangePicker
                  value="24h"
                  options={[
                    { value: "1h", href: "?window=1h" },
                    { value: "24h", href: "?window=24h" },
                    { value: "7d", href: "?window=7d" },
                  ]}
                />
                <Pagination currentPage={3} totalPages={8} href={(page) => `?page=${page}`} />
              </div>
            </div>
          </Section>

          <Section id="composition" title="Composition">
            <AppOverview title="Operations" subtitle="Cloud-neutral structure" icon="ti ti-activity">
              <AppOverview.Main title="Runtime">
                <StatGrid columns={3}>
                  <StatCell label="Requests" value="12.4k" sub="last 24 hours" tone="info" trend={[8, 11, 9, 14, 12]} />
                  <StatCell label="Success" value="99.8%" sub="within SLO" tone="success" />
                  <StatCell label="Latency" value="84ms" sub="p95" tone="warning" />
                </StatGrid>
              </AppOverview.Main>
              <AppOverview.Aside title="People">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                  <Avatar name="Ada Lovelace" />
                  <span style="font-size:12px">Ada Lovelace</span>
                </div>
                <LinkCard href="#widgets" title="Open widgets" description="Composable dashboard blocks" icon="ti ti-layout-dashboard" />
              </AppOverview.Aside>
            </AppOverview>
          </Section>

          <Section id="settings" title="Settings">
            <SettingsModal
              title="Application settings"
              tabs={[
                { id: "general", title: "General", icon: "ti ti-settings", content: <p>General package settings.</p> },
                {
                  id: "security",
                  title: "Security",
                  description: "Destructive options stay clearly separated.",
                  icon: "ti ti-lock",
                  tone: "danger",
                  content: <Button variant="danger">Delete local fixture data</Button>,
                },
              ]}
            />
          </Section>

          <Section id="widgets" title="Widgets">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">
              <Widget title="Platform health" meta="just now" icon="ti ti-heartbeat" size="compact">
                <WidgetStatus title="Operational" message="All checks passed" tone="success" grow />
                <WidgetPills pills={[{ label: "Apps", value: 23 }, { label: "Routes", value: 102, tone: "info" }]} />
              </Widget>
              <Widget title="Requests" icon="ti ti-chart-bar" size="compact">
                <WidgetStat label="Last hour" value="12.4k" sub="99.8% successful" grow />
              </Widget>
              <Widget title="Deployments" href="?view=deployments" size="compact">
                <WidgetList
                  grow
                  items={[
                    { label: "gateway", sub: "healthy", icon: "ti ti-rocket", iconTone: "success", meta: "now" },
                    { label: "worker", sub: "healthy", icon: "ti ti-rocket", iconTone: "success", meta: "2m" },
                  ]}
                />
              </Widget>
              <Widget title="Empty state" size="compact">
                <WidgetHero title="All clear" subtitle="No pending work" icon="ti ti-circle-check" tone="success" />
              </Widget>
            </div>
          </Section>
        </main>
      </div>
    </div>
  );
}
