import {
  Avatar,
  Button,
  Calendar,
  DataPanel,
  LinkCard,
  NoticeCard,
  NotFoundState,
  PanelHeader,
  Placeholder,
  ProgressBar,
  RangePicker,
  StatCell,
  StatGrid,
  StatusBadge,
} from "@k2b/ui";
import { createSignal, type JSX } from "solid-js";
import { DemoCard } from "../DemoCard";
import { DemoGrid, type DemoSection } from "./types";

const violetTheme = {
  "--k2b-accent-50": "#f5f3ff",
  "--k2b-accent-100": "#ede9fe",
  "--k2b-accent-200": "#ddd6fe",
  "--k2b-accent-300": "#c4b5fd",
  "--k2b-accent-400": "#a78bfa",
  "--k2b-accent-500": "#8b5cf6",
  "--k2b-accent-600": "#7c3aed",
  "--k2b-accent-700": "#6d28d9",
  "--k2b-accent-800": "#5b21b6",
  "--k2b-accent-900": "#4c1d95",
  "--k2b-accent-950": "#2e1065",
} as JSX.CSSProperties;

const ThemeDemo = () => {
  const [violet, setViolet] = createSignal(false);

  return (
    <DemoCard
      id="theme"
      chip={[
        { kind: "asset", name: "styles.css", from: "@k2b/ui/styles.css" },
        { kind: "asset", name: "plex.css", from: "@k2b/ui/fonts/plex.css" },
        { kind: "asset", name: "tabler.css", from: "@k2b/ui/icons/tabler.css" },
      ]}
      description="Switch the local accent stack. The nested .k2b-ui scope updates its semantic tokens and components without changing the surrounding page."
      code={`import "@k2b/ui/styles.css";
import "@k2b/ui/fonts/plex.css";
import "@k2b/ui/icons/tabler.css";

const [violet, setViolet] = createSignal(false);

<section
  class="k2b-ui"
  style={violet() ? {
    "--k2b-accent-500": "#8b5cf6",
    "--k2b-accent-600": "#7c3aed",
    "--k2b-accent-700": "#6d28d9",
  } : undefined}
>
  <Button onClick={() => setViolet((value) => !value)}>
    Switch accent
  </Button>
</section>`}
    >
      <div class="k2b-ui ui-theme-demo" style={violet() ? violetTheme : undefined}>
        <div class="ui-theme-demo__swatches">
          <div data-token="action"><span>Action solid</span><code>--k2b-action-solid</code></div>
          <div data-token="surface"><span>Surface</span><code>--k2b-surface</code></div>
          <div data-token="text"><span>Text</span><code>--k2b-text</code></div>
        </div>
        <div class="ui-theme-demo__actions" role="group" aria-label="Accent theme">
          <Button
            variant={violet() ? "secondary" : "primary"}
            aria-pressed={!violet()}
            onClick={() => setViolet(false)}
          >
            Default blue
          </Button>
          <Button
            variant={violet() ? "primary" : "secondary"}
            aria-pressed={violet()}
            onClick={() => setViolet(true)}
          >
            Violet
          </Button>
          <Button variant="ghost">
            <i class="ti ti-palette" aria-hidden="true" />
            Themed icon
          </Button>
        </div>
      </div>
    </DemoCard>
  );
};

const EmptyDemo = () => (
  <DemoCard
    id="empty-states"
    chip={[
      { kind: "component", name: "Placeholder", from: "@k2b/ui" },
      { kind: "component", name: "NotFoundState", from: "@k2b/ui" },
    ]}
    description="Compact and panel placeholders expose empty, polite-loading, and alert semantics; NotFoundState handles a route-level dead end."
    code={`import { NotFoundState, Placeholder } from "@k2b/ui";

<Placeholder title="No projects" description="Create the first project." />
<Placeholder state="loading" variant="panel" title="Loading projects" />
<Placeholder state="error" title="Projects unavailable" />
<NotFoundState code="404" title="Project not found" action={{ label: "All projects", href: "/projects" }} />`}
  >
    <div class="ui-demo-form-grid">
      <Placeholder
        surface="paper"
        title="No projects"
        description="Create the first project."
        icon="ti ti-folder-off"
        action={<Button size="sm">New project</Button>}
      />
      <Placeholder surface="paper" state="loading" variant="panel" title="Loading projects" description="Fetching the latest projects." />
      <Placeholder surface="paper" state="error" align="left" title="Projects unavailable" description="Reload the page to try again." />
      <NotFoundState
        code="404"
        title="Project not found"
        description="It may have been moved."
        action={{ label: "All projects", href: "#empty-states" }}
      />
    </div>
  </DemoCard>
);

const CardsDemo = () => (
  <DemoCard
    id="cards"
    chip={[
      { kind: "component", name: "LinkCard", from: "@k2b/ui" },
      { kind: "component", name: "Avatar", from: "@k2b/ui" },
    ]}
    description="LinkCard uses an explicit color and Avatar accepts a portable image URL or text fallback."
    code={`import { Avatar, LinkCard } from "@k2b/ui";

<LinkCard href="/runtime" title="Runtime" description="Open details" icon="ti ti-server" color="cyan" />
<Avatar name="Ada Lovelace" src="/avatars/ada.webp" size="lg" />`}
  >
    <div class="ui-demo-form-grid">
      <LinkCard href="#cards" title="Runtime" description="Open runtime details" icon="ti ti-server" color="cyan" />
      <div class="ui-demo-row">
        <Avatar name="Ada Lovelace" src="/assets/logo.svg" size="lg" />
        <Avatar name="Grace Hopper" fallback="GH" size="md" />
      </div>
    </div>
  </DemoCard>
);

const ProgressDemo = () => (
  <DemoCard
    id="progress"
    chip={{ kind: "component", name: "ProgressBar", from: "@k2b/ui" }}
    description="Determinate progress in semantic tones and three compact sizes."
    code={`<ProgressBar value={72.4} label="Upload progress" tone="success" showValue />`}
  >
    <div class="ui-demo-form-grid">
      <ProgressBar value={72.4} label="Upload progress" tone="success" showValue />
      <ProgressBar value={38} label="Indexing" showValue size="sm" />
      <ProgressBar value={16} label="Storage limit" tone="danger" showValue size="xs" />
    </div>
  </DemoCard>
);

const StatsDemo = () => (
  <DemoCard
    id="stats"
    chip={[
      { kind: "component", name: "StatGrid", from: "@k2b/ui" },
      { kind: "component", name: "StatCell", from: "@k2b/ui" },
    ]}
    description="The default grid uses the six-column responsive ladder. Cells can link, show contextual accents, and render compact trends."
    code={`import { StatCell, StatGrid } from "@k2b/ui";

<StatGrid title="Runtime" action={{ label: "Observability", href: "./observability" }}>
  <StatCell label="Requests" value="42k" sub="last hour" trend={[12, 18, 16, 24, 42]} />
  <StatCell label="Latency" value="83 ms" sub="p95" href="./observability" valueClass="app-latency-warning" />
  <StatCell label="Errors" value={12} accent={{ tone: "red", icon: "ti ti-alert-circle", text: "inspect", href: "./observability" }} />
</StatGrid>`}
  >
    <StatGrid columns={3} title="Runtime" action={{ label: "Observability", href: "./observability" }}>
      <StatCell label="Requests" value="42k" sub="last hour" trend={[12, 18, 16, 24, 42]} />
      <StatCell label="Latency" value="83 ms" sub="p95" href="./observability" valueClass="ui-stat-attention" />
      <StatCell
        label="Errors"
        value={12}
        sub="last hour"
        accent={{ tone: "red", icon: "ti ti-alert-circle", text: "inspect", href: "./observability" }}
      />
    </StatGrid>
  </DemoCard>
);

const OperationalDemo = () => {
  const notices = [
    { tone: "warn" as const, title: "Delayed source", detail: "The last sample arrived 8 minutes ago." },
    { tone: "error" as const, title: "Database unavailable", detail: "Current diagnostics could not be loaded." },
  ];

  return (
    <DemoCard
      id="observability"
      chip={[
        { kind: "component", name: "PanelHeader", from: "@k2b/ui" },
        { kind: "component", name: "DataPanel", from: "@k2b/ui" },
        { kind: "component", name: "StatusBadge", from: "@k2b/ui" },
        { kind: "component", name: "NoticeCard", from: "@k2b/ui" },
        { kind: "component", name: "NoticeCard.Grid", from: "@k2b/ui" },
        { kind: "component", name: "RangePicker", from: "@k2b/ui" },
      ]}
      description="Persistent notices and six semantic status tones keep operational meaning consistent across panels and dense rows."
      code={`import {
  DataPanel,
  NoticeCard,
  PanelHeader,
  RangePicker,
  StatusBadge,
} from "@k2b/ui";

const notices = [
  { tone: "warn", title: "Delayed source", detail: "The last sample arrived 8 minutes ago." },
  { tone: "error", title: "Database unavailable", detail: "Current diagnostics could not be loaded." },
] as const;

<div class="ui-demo-form-grid">
  <PanelHeader
    title="System status"
    subtitle="Updated just now"
    actions={
      <RangePicker
        value="24h"
        options={[
          { value: "1h", href: "?range=1h" },
          { value: "24h", href: "?range=24h" },
        ]}
      />
    }
  />
  <NoticeCard.Grid items={notices}>
    {(notice) => <NoticeCard tone={notice.tone} title={notice.title} detail={notice.detail} />}
  </NoticeCard.Grid>

  <DataPanel title="Routes" subtitle="6 states">
    <div class="ui-demo-row ui-data-panel-demo-body">
      <StatusBadge label="Online" tone="ok" />
      <StatusBadge label="Attention" tone="warn" />
      <StatusBadge label="Failed" tone="error" />
      <StatusBadge label="Degraded" tone="degraded" />
      <StatusBadge
        label="Refreshing telemetry and dependency health"
        tone="running"
        variant="dot"
        title="Refreshing telemetry and dependency health"
      />
      <StatusBadge label="Disabled" tone="neutral" variant="text" />
    </div>
  </DataPanel>
</div>`}
    >
      <div class="ui-demo-form-grid">
        <PanelHeader
          title="System status"
          subtitle="Updated just now"
          actions={
            <RangePicker
              value="24h"
              options={[
                { value: "1h", href: "?range=1h" },
                { value: "24h", href: "?range=24h" },
              ]}
            />
          }
        />
        <NoticeCard.Grid items={notices}>
          {(notice) => <NoticeCard tone={notice.tone} title={notice.title} detail={notice.detail} />}
        </NoticeCard.Grid>
        <DataPanel title="Routes" subtitle="6 states">
          <div class="ui-demo-row ui-data-panel-demo-body">
            <StatusBadge label="Online" tone="ok" />
            <StatusBadge label="Attention" tone="warn" />
            <StatusBadge label="Failed" tone="error" />
            <StatusBadge label="Degraded" tone="degraded" />
            <StatusBadge
              label="Refreshing telemetry and dependency health"
              tone="running"
              variant="dot"
              title="Refreshing telemetry and dependency health"
            />
            <StatusBadge label="Disabled" tone="neutral" variant="text" />
          </div>
        </DataPanel>
      </div>
    </DemoCard>
  );
};

const CalendarDemo = () => {
  const [date, setDate] = createSignal(new Date("2026-07-15T12:00:00Z"));
  const [view, setView] = createSignal<"day" | "week" | "month" | "year">("month");
  const [selectedEventId, setSelectedEventId] = createSignal<string>();
  const [events, setEvents] = createSignal([
    { id: "review", title: "Design review", start: "2026-07-15T09:00:00Z", end: "2026-07-15T10:00:00Z" },
    { id: "release", title: "Release", start: "2026-07-18T16:00:00Z", end: "2026-07-18T17:00:00Z", allDay: true },
  ]);
  return (
    <DemoCard
      id="calendar"
      chip={{ kind: "component", name: "Calendar", from: "@k2b/ui" }}
      description="A controlled calendar: navigate, switch views, select events, and drag or resize timed entries."
      code={`<Calendar date={date()} view={view()} events={events()} onDateChange={setDate} onViewChange={setView} />`}
    >
      <Calendar
        date={date()}
        view={view()}
        views={["day", "week", "month", "year"]}
        dateConfig={{ timeZone: "UTC", locale: "en" }}
        events={events()}
        selectedEventId={selectedEventId()}
        onDateChange={setDate}
        onViewChange={setView}
        onEventClick={(event) => setSelectedEventId(event.id)}
        onEventDrop={(event, next) =>
          setEvents((current) => current.map((item) => item.id === event.id ? {
            ...item,
            start: next.start.toISOString(),
            end: next.end.toISOString(),
            allDay: next.allDay,
          } : item))}
        onEventResize={(event, next) =>
          setEvents((current) => current.map((item) => item.id === event.id ? {
            ...item,
            start: next.start.toISOString(),
            end: next.end.toISOString(),
            allDay: next.allDay,
          } : item))}
      />
    </DemoCard>
  );
};

const demos: DemoSection = {
  utilities: () => <DemoGrid columns="one"><ThemeDemo /></DemoGrid>,
  "empty-states": () => <DemoGrid columns="one"><EmptyDemo /></DemoGrid>,
  cards: () => <DemoGrid columns="one"><CardsDemo /></DemoGrid>,
  progress: () => <DemoGrid columns="one"><ProgressDemo /></DemoGrid>,
  stats: () => <DemoGrid columns="one"><StatsDemo /></DemoGrid>,
  observability: () => <DemoGrid columns="one"><OperationalDemo /></DemoGrid>,
  calendar: () => <DemoGrid columns="one"><CalendarDemo /></DemoGrid>,
};

export default demos;
