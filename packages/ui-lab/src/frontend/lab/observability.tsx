/**
 * Observability primitives — the pieces admin and operations surfaces repeat.
 *
 * Each of these replaced a construct that had been hand-assembled per page and
 * had drifted: the panel shell existed in ~30 variants, the status badge in
 * 25, and the warning card had lost its error branch in one copy so a hard
 * failure rendered as a routine advisory.
 */
import {
  DataPanel,
  DataTable,
  type DataTableColumn,
  NoticeCard,
  PanelHeader,
  RangePicker,
  StatCell,
  StatGrid,
  StatusBadge,
} from "@valentinkolb/cloud/ui";
import DemoCard from "./DemoCard";

const FROM_UI = "@valentinkolb/cloud/ui";

type RouteRow = { route: string; app: string; requests: number; state: "ok" | "warn" | "error" };

const ROUTES: RouteRow[] = [
  { route: "/api/mail/mailboxes/:id", app: "mail", requests: 18492, state: "ok" },
  { route: "/app/grids/_ssr/_ping", app: "grids", requests: 976, state: "error" },
  { route: "/api/pulse/ingest", app: "pulse", requests: 3582, state: "warn" },
];

const ROUTE_COLUMNS: DataTableColumn<RouteRow>[] = [
  { id: "route", header: "Route" },
  { id: "app", header: "App" },
  { id: "requests", header: "Requests", align: "right", sortable: true },
  { id: "state", header: "Health", sortable: "errorRate" },
];

export const PanelHeaderDemo = () => (
  <DemoCard
    id="panelheader"
    chip={{ kind: "component", name: "PanelHeader", from: FROM_UI }}
    description="Title, quiet subtitle and trailing actions. Composed by `StatGrid` and `DataPanel` so panel titles match everywhere; use it directly only when building a new panel-shaped surface. Renders no border or divider — the surface around it owns that."
    code={`<PanelHeader
  title="Routes"
  subtitle="12 of 340 requests"
  actions={<a class="btn-input btn-input-sm" href="/admin/observability/telemetry">Open</a>}
/>

<PanelHeader as="h1" size="md" title="Observability" subtitle="What is wrong right now." />`}
  >
    <div class="grid gap-3">
      <div class="paper p-3">
        <PanelHeader
          title="Routes"
          subtitle="12 of 340 requests"
          actions={
            <a class="btn-input btn-input-sm" href="#panelheader">
              Open
            </a>
          }
        />
      </div>
      <div class="paper p-3">
        <PanelHeader as="h1" size="md" title="Observability" subtitle="What is wrong right now, and where to look next." />
      </div>
    </div>
  </DemoCard>
);

export const StatusBadgeDemo = () => (
  <DemoCard
    id="statusbadge"
    chip={{ kind: "component", name: "StatusBadge", from: FROM_UI }}
    description="One vocabulary for health. `tone` carries the meaning, `label` the domain wording — 'failed', 'offline' and 'error' are all `error`. `degraded` is its own tone: the check ran, but its backing source is unreachable, which is not the same as a failure. Use `dot` in dense tables where a chip would dominate the row."
    code={`<StatusBadge tone="ok" label="Online" />
<StatusBadge tone="degraded" label="Degraded" title="Postgres diagnostics unavailable" />
<StatusBadge tone="error" label="Failed" />
<StatusBadge tone="running" label="In flight" />
<StatusBadge tone="warn" label="Overdue" variant="dot" />
<StatusBadge tone="neutral" label="Disabled" variant="text" />`}
  >
    <div class="flex flex-wrap items-center gap-2">
      <StatusBadge tone="ok" label="Online" />
      <StatusBadge tone="degraded" label="Degraded" title="Postgres diagnostics unavailable" />
      <StatusBadge tone="error" label="Failed" />
      <StatusBadge tone="running" label="In flight" />
      <StatusBadge tone="warn" label="Overdue" variant="dot" />
      <StatusBadge tone="neutral" label="Disabled" variant="text" />
    </div>
  </DemoCard>
);

export const NoticeCardDemo = () => (
  <DemoCard
    id="noticecard"
    chip={{ kind: "component", name: "NoticeCard", from: FROM_UI }}
    description="A finding the page keeps visible, between a toast and an empty state. `NoticeCard.Grid` lays several out and picks its column count from how many there are — two full-width cards read as an outage. Always pass the real tone: an unreachable backend is `error`, a housekeeping note is `warn`."
    code={`<NoticeCard.Grid items={warnings}>
  {(warning) => <NoticeCard tone={warning.tone} title={warning.title} detail={warning.detail} />}
</NoticeCard.Grid>`}
  >
    <NoticeCard.Grid
      items={[
        { tone: "error" as const, title: "Redis diagnostics unavailable", detail: "Connection refused while reading INFO." },
        { tone: "warn" as const, title: "Keys without expiry", detail: "10,438 of 104,424 sampled keys have no TTL." },
        { tone: "info" as const, title: "Prefix data is sampled", detail: "Scanned 20,000 of 104,424 keys." },
      ]}
    >
      {(warning) => <NoticeCard tone={warning.tone} title={warning.title} detail={warning.detail} />}
    </NoticeCard.Grid>
  </DemoCard>
);

export const RangePickerDemo = () => (
  <DemoCard
    id="rangepicker"
    chip={{ kind: "component", name: "RangePicker", from: FROM_UI }}
    description="Time window for observability surfaces. Renders links, not buttons: the window is a server concern, so it belongs in the URL and works without hydration. The caller supplies each href, which is what keeps the page's other filters intact, and owns the vocabulary — traces think in 10m–30d, request telemetry in 1h–30d."
    code={`<RangePicker
  label="Window"
  value={filter.range}
  options={RANGES.map((range) => ({ value: range, href: buildUrl(filter, { range }) }))}
/>`}
  >
    <div class="grid gap-3">
      <RangePicker
        label="Window"
        value="24h"
        options={["1h", "6h", "24h", "7d", "30d"].map((value) => ({ value, href: "#rangepicker" }))}
      />
      <RangePicker
        label={null}
        ariaLabel="Trace window"
        value="12h"
        options={[
          { value: "10m", label: "10 min", href: "#rangepicker" },
          { value: "1h", label: "1 hour", href: "#rangepicker" },
          { value: "12h", label: "12 hours", href: "#rangepicker" },
        ]}
      />
    </div>
  </DemoCard>
);

export const DataPanelDemo = () => (
  <DemoCard
    id="datapanel"
    chip={{ kind: "component", name: "DataPanel", from: FROM_UI }}
    description="The container around records: heading, count, search and filter slots, the rows, and the states that replace them. Distinct from `StatGrid`, which summarises metrics rather than framing records — both compose `PanelHeader`. `error` takes precedence over `empty`, because 'could not read' and 'nothing here' need different responses. Search is a slot: `SearchBar` is an island and the kit must not re-export islands."
    code={`<DataPanel
  title="Routes"
  subtitle={\`\${rows.length} of \${total} routes\`}
  search={<SearchBar action={PATH} value={filter.search} />}
  filters={<RouteFilterBar filter={filter} />}
  error={loadError}
  isEmpty={rows.length === 0}
  empty="No route produced traffic in this window."
  footer={<Pagination currentPage={page} totalPages={pages} baseUrl={base} />}
>
  <DataTable rows={rows} columns={columns} sort={sort} sortHref={sortHref} />
</DataPanel>`}
  >
    <div class="grid gap-3">
      <DataPanel
        title="Routes"
        subtitle="3 of 77 routes"
        actions={<RangePicker label={null} ariaLabel="Window" value="24h" options={[{ value: "24h", href: "#datapanel" }]} />}
        isEmpty={false}
      >
        <DataTable
          rows={ROUTES}
          columns={ROUTE_COLUMNS}
          getRowId={(row) => row.route}
          density="compact"
          sort={{ key: "requests", direction: "desc" }}
          sortHref={() => "#datapanel"}
          renderCell={({ row, col, value, render }) =>
            col.id === "state" ? (
              <StatusBadge tone={row.state} label={row.state === "ok" ? "Healthy" : row.state === "warn" ? "Slow" : "Failing"} />
            ) : (
              render(value)
            )
          }
        />
      </DataPanel>
      <div class="grid gap-3 lg:grid-cols-2">
        <DataPanel title="Failing routes" subtitle="0 routes" isEmpty empty="No route produced an error in this window." />
        <DataPanel title="Sessions" subtitle="unavailable" error="Connection refused while reading pg_stat_activity." />
      </div>
    </div>
  </DemoCard>
);

export const ObservabilityStatsDemo = () => (
  <DemoCard
    id="observability-stats"
    chip={{ kind: "component", name: "StatGrid", from: FROM_UI }}
    description="Stat tiles in an operations context: every headline number is a link to the page that explains it, with the filter already applied, and the window shown in `sub` so the figure can be reproduced there. A tile that cannot be clicked is a dead end for whoever is trying to act on it."
    code={`<StatGrid columns={3}>
  <StatCell label="Server errors" value="4,913" sub="5xx · 24h"
            href="/admin/observability/telemetry?range=24h&errors=1"
            valueClass="text-red-500" accent={{ tone: "red", icon: "ti ti-alert-circle" }} />
</StatGrid>`}
  >
    <StatGrid columns={3}>
      <StatCell
        label="Server errors"
        value="4,913"
        sub="5xx · 24h"
        href="#observability-stats"
        valueClass="text-red-500"
        accent={{ tone: "red", icon: "ti ti-alert-circle" }}
      />
      <StatCell
        label="Rate limited"
        value="6,071"
        sub="429 · 24h"
        href="#observability-stats"
        accent={{ tone: "amber", icon: "ti ti-hand-stop" }}
      />
      <StatCell label="Requests" value="273,911" sub="24h" href="#observability-stats" />
    </StatGrid>
  </DemoCard>
);
