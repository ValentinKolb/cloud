/**
 * Surfaces & Cards tab — surface utilities (paper, thumbnail), card
 * components (LinkCard, ProgressBar), identity surfaces (Avatar /
 * UserView / GroupView), stat blocks (StatCell / StatGrid), and
 * dashboard widgets composed end-to-end.
 *
 * Widget demos show the dashboard endpoint contract: apps return
 * WidgetResponse JSON, the dashboard owns rendering.
 */
import {
  Avatar,
  LinkCard,
  ProgressBar,
  StatCell,
  StatGrid,
  Widget,
  WidgetStat,
  WidgetList,
  WidgetStatus,
  WidgetPills,
  WidgetHero,
} from "@valentinkolb/cloud/ui";
import type { WidgetBlock, WidgetResponse } from "@valentinkolb/cloud/contracts";
import type { JSX } from "solid-js";
import DemoCard from "./DemoCard";

const FROM_UI = "@valentinkolb/cloud/ui";

const stringifyWidget = (widget: WidgetResponse): string => JSON.stringify(widget, null, 2);

const renderWidgetBlock = (block: WidgetBlock): JSX.Element => {
  switch (block.kind) {
    case "stat":
      return (
        <WidgetStat
          value={block.value}
          label={block.label}
          sub={block.sub}
          valueClass={block.valueClass}
          accent={block.accent}
          grow={block.grow}
        />
      );
    case "list":
      return <WidgetList items={block.items} emptyMessage={block.emptyMessage} grow={block.grow} />;
    case "status":
      return <WidgetStatus tone={block.tone} title={block.title} message={block.message} icon={block.icon} grow={block.grow} />;
    case "pills":
      return <WidgetPills pills={block.pills} grow={block.grow} />;
    case "hero":
      return <WidgetHero title={block.title} subtitle={block.subtitle} icon={block.icon} tone={block.tone} />;
  }
};

const WidgetPreview = (props: { response: WidgetResponse }) => (
  <Widget title={props.response.title} icon={props.response.icon} href={props.response.href} meta={props.response.meta}>
    {props.response.blocks.map((block) => renderWidgetBlock(block))}
  </Widget>
);

const adminQueueWidget: WidgetResponse = {
  title: "Admin queue",
  icon: "ti ti-users-group",
  href: "/app/accounts",
  meta: "admin",
  blocks: [
    {
      kind: "stat",
      grow: true,
      value: 8,
      label: "Pending requests",
      sub: "needs review",
      valueClass: "text-amber-600 dark:text-amber-400",
      accent: { tone: "amber", icon: "ti ti-clock", text: "open" },
    },
    {
      kind: "status",
      tone: "warn",
      grow: true,
      title: "6 accounts expiring within 30 days",
      message: "2 IPA · 3 local user · 1 guest",
      icon: "ti ti-calendar-due",
    },
    {
      kind: "pills",
      pills: [
        { label: "accts", value: 342, href: "/app/accounts" },
        { label: "groups", value: 47 },
        { label: "queue", value: 8, tone: "amber" },
      ],
    },
  ],
};

const recentNotesWidget: WidgetResponse = {
  title: "Recent notes",
  icon: "ti ti-notebook",
  href: "/app/notebooks",
  meta: "last 24h",
  blocks: [
    {
      kind: "list",
      grow: true,
      items: [
        {
          icon: "ti ti-file-text",
          iconTone: "blue",
          label: "Launch checklist",
          sub: "Product",
          meta: "2m",
          href: "/app/notebooks/a1b2c3/notes/d4e5f6",
        },
        {
          icon: "ti ti-file-text",
          iconTone: "emerald",
          label: "Hiring plan",
          sub: "People",
          meta: "18m",
          href: "/app/notebooks/a1b2c3/notes/g7h8i9",
        },
        { icon: "ti ti-file-text", label: "Security review", sub: "Ops", meta: "1h", href: "/app/notebooks/a1b2c3/notes/j1k2l3" },
      ],
    },
    {
      kind: "list",
      items: [],
      emptyMessage: "No pinned notes yet.",
    },
  ],
};

const allClearWidget: WidgetResponse = {
  title: "Admin queue",
  icon: "ti ti-users-group",
  href: "/app/accounts",
  blocks: [
    {
      kind: "hero",
      icon: "ti ti-circle-check",
      tone: "emerald",
      title: "All clear",
      subtitle: "No pending requests and nothing expiring",
    },
    {
      kind: "pills",
      pills: [
        { label: "accts", value: 342 },
        { label: "groups", value: 47 },
      ],
    },
  ],
};

const serviceStatesWidget: WidgetResponse = {
  title: "Service states",
  icon: "ti ti-heartbeat",
  meta: "live",
  blocks: [
    {
      kind: "status",
      tone: "ok",
      title: "API healthy",
      message: "p95 84ms",
    },
    {
      kind: "status",
      tone: "info",
      title: "Indexing notes",
      message: "Background work is still running",
      icon: "ti ti-loader-2",
    },
    {
      kind: "status",
      tone: "error",
      title: "Mail queue paused",
      message: "3 messages waiting for retry",
      icon: "ti ti-alert-triangle",
    },
    {
      kind: "pills",
      grow: true,
      pills: [
        { label: "ok", value: 12, tone: "emerald" },
        { label: "warn", value: 2, tone: "amber", href: "/app/logs?level=warn" },
        { label: "error", value: 1, tone: "red", href: "/app/logs?level=error" },
        { label: "info", value: 5, tone: "blue" },
        { label: "muted", value: 0, tone: "zinc" },
      ],
    },
  ],
};

/* ── Surface utilities ─────────────────────────────────── */

export const PaperUtility = () => (
  <DemoCard
    id="paper"
    chip={{ kind: "utility", name: "paper" }}
    description="Default content surface. Light bg in light mode, dark bg in dark mode, subtle border."
    code={`<div class="paper p-4">Content goes here.</div>`}
  >
    <div class="paper p-4">Content goes here.</div>
  </DemoCard>
);

export const ThumbnailUtility = () => (
  <DemoCard
    id="thumbnail"
    chip={{ kind: "utility", name: "thumbnail" }}
    description="Square icon surface for nav menus, tool tiles, and list-item leading slots."
    code={`<div class="w-12 h-12 thumbnail bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
  <i class="ti ti-rocket text-2xl text-zinc-600 dark:text-zinc-400" />
</div>`}
  >
    <div class="w-12 h-12 thumbnail bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
      <i class="ti ti-rocket text-2xl text-zinc-600 dark:text-zinc-400" />
    </div>
  </DemoCard>
);

/* ── LinkCard / ProgressBar ───────────────────────────── */

export const LinkCardDemo = () => (
  <DemoCard
    id="linkcard"
    chip={{ kind: "component", name: "LinkCard", from: FROM_UI }}
    description="Tile with icon, title, description — building block for app launchers and tool grids."
    code={`<LinkCard
  href="/files"
  title="Files"
  description="Cloud storage with shared folders"
  icon="ti ti-folder"
  color="blue"
/>`}
  >
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <LinkCard href="#linkcard" title="Files" description="Cloud storage with shared folders" icon="ti ti-folder" color="blue" />
      <LinkCard href="#linkcard" title="Notebooks" description="Markdown notes with widgets" icon="ti ti-book" color="emerald" />
      <LinkCard href="#linkcard" title="Settings" description="Tenant configuration" icon="ti ti-settings" color="zinc" />
      <LinkCard href="#linkcard" title="Logs" description="Audit log entries" icon="ti ti-list-details" color="amber" />
    </div>
  </DemoCard>
);

export const ProgressBarDemo = () => (
  <DemoCard
    id="progressbar"
    chip={{ kind: "component", name: "ProgressBar", from: FROM_UI }}
    description="Sizes via `size` prop, tones via `tone`. Optional `showValue` to print the percent inline."
    code={`<ProgressBar value={20} size="xs" showValue />
<ProgressBar value={55} tone="primary" showValue />
<ProgressBar value={90} tone="success" showValue />
<ProgressBar value={72} tone="danger" showValue />`}
  >
    <div class="space-y-2">
      <ProgressBar value={20} size="xs" showValue />
      <ProgressBar value={55} tone="primary" showValue />
      <ProgressBar value={90} tone="success" showValue />
      <ProgressBar value={72} tone="danger" showValue />
    </div>
  </DemoCard>
);

/* ── Identity ─────────────────────────────────────────── */

export const AvatarDemo = () => (
  <DemoCard
    id="avatar"
    chip={{ kind: "component", name: "Avatar", from: FROM_UI }}
    description="Initials avatar in four sizes (sm / md / lg / xl)."
    code={`<Avatar username="Valentin Kolb" size="sm" />
<Avatar username="Valentin Kolb" size="md" />
<Avatar username="Valentin Kolb" size="lg" />
<Avatar username="Valentin Kolb" size="xl" />`}
  >
    <div class="flex items-center gap-3">
      <Avatar username="Valentin Kolb" size="sm" />
      <Avatar username="Valentin Kolb" size="md" />
      <Avatar username="Valentin Kolb" size="lg" />
      <Avatar username="Valentin Kolb" size="xl" />
    </div>
  </DemoCard>
);

/* ── Stats ────────────────────────────────────────────── */

export const StatCellDemo = () => (
  <DemoCard
    id="statcell"
    chip={{ kind: "component", name: "StatCell", from: FROM_UI }}
    description="One labelled stat. Accent can be a coloured icon, a pill, or a linked pill."
    code={`<StatCell label="Active users" value={1284} sub="last 24h" />
<StatCell
  label="Storage used"
  value="847 GB"
  accent={{ tone: "amber", icon: "ti ti-alert-triangle", text: "84% full" }}
/>`}
  >
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCell label="Active users" value={1284} sub="last 24h" />
      <StatCell label="Storage used" value="847 GB" accent={{ tone: "amber", icon: "ti ti-alert-triangle", text: "84% full" }} />
      <StatCell label="Requests" value={42} accent={{ tone: "red", icon: "ti ti-flame" }} />
      <StatCell label="Uptime" value="99.98%" accent={{ tone: "emerald", icon: "ti ti-check" }} />
    </div>
  </DemoCard>
);

export const StatGridDemo = () => (
  <DemoCard
    id="statgrid"
    chip={{ kind: "component", name: "StatGrid", from: FROM_UI }}
    description="Paper-wrapped grid of `StatCell` children. Use explicit `columns` for known counts, optional title/action for admin summaries, and the default 6-column ladder for dense metric rows."
    code={`<StatGrid title="Account requests" columns={3}>
  <StatCell label="Open" value={7} accent={{ tone: "amber", icon: "ti ti-clock" }} />
  <StatCell label="Approved" value={142} />
  <StatCell label="Rejected" value={12} accent={{ tone: "red", icon: "ti ti-x" }} />
</StatGrid>

<StatGrid title="Storage" action={{ label: "Open files", href: "/app/files" }} columns={4}>
  <StatCell label="Used" value="847 GB" sub="of 1 TB" />
  <StatCell label="Large files" value={18} accent={{ tone: "amber", icon: "ti ti-alert-triangle" }} />
  <StatCell label="Shared" value={64} sub="folders" />
  <StatCell label="Health" value="OK" accent={{ tone: "emerald", icon: "ti ti-check" }} />
</StatGrid>`}
  >
    <div class="flex flex-col gap-3">
      <StatGrid title="Account requests" columns={3}>
        <StatCell label="Open" value={7} accent={{ tone: "amber", icon: "ti ti-clock" }} />
        <StatCell label="Approved" value={142} />
        <StatCell label="Rejected" value={12} accent={{ tone: "red", icon: "ti ti-x" }} />
      </StatGrid>

      <StatGrid title="Storage" action={{ label: "Open files", href: "#statgrid" }} columns={4}>
        <StatCell label="Used" value="847 GB" sub="of 1 TB" />
        <StatCell label="Large files" value={18} accent={{ tone: "amber", icon: "ti ti-alert-triangle" }} />
        <StatCell label="Shared" value={64} sub="folders" />
        <StatCell label="Health" value="OK" accent={{ tone: "emerald", icon: "ti ti-check" }} />
      </StatGrid>

      <StatGrid title="Request pipeline">
        <StatCell label="Open" value={7} />
        <StatCell label="Waiting" value={3} accent={{ tone: "amber", icon: "ti ti-hourglass" }} />
        <StatCell label="Approved" value={142} accent={{ tone: "emerald", icon: "ti ti-check" }} />
        <StatCell label="Rejected" value={12} accent={{ tone: "red", icon: "ti ti-x" }} />
        <StatCell label="Avg. review" value="4h" />
        <StatCell label="SLA" value="98%" sub="met" />
      </StatGrid>
    </div>
  </DemoCard>
);

export const StatHeroGridDemo = () => (
  <DemoCard
    id="stat-hero-grid"
    chip={[
      { kind: "component", name: "StatCell", from: FROM_UI },
      { kind: "component", name: "ProgressBar", from: FROM_UI },
      { kind: "utility", name: "inline StatGrid hairlines" },
    ]}
    description="Accounts-dashboard style hero stats. This intentionally does not wrap the right side in `StatGrid`, because the whole hero is already one `paper`; use the same `gap-px bg-zinc-*` hairline pattern and place `StatCell` children inline."
    code={`<div class="paper overflow-hidden">
  <div class="grid grid-cols-1 lg:grid-cols-[1.2fr_1.8fr]">
    <div class="px-5 py-5 flex flex-col gap-3 lg:border-r border-zinc-100 dark:border-zinc-800">
      <div class="flex items-center justify-between gap-3">
        <span class="text-[10px] uppercase tracking-wider text-dimmed">Run health</span>
        <span class="tag bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          <i class="ti ti-check" />
          Synced 2 mins ago
        </span>
      </div>
      <div class="flex flex-col gap-2 flex-1 justify-center">
        <ProgressBar value={100} size="xs" class="flex-1 min-w-0" />
      </div>
      <span class="text-[10px] text-dimmed">Based on last 10 runs</span>
    </div>

    <div class="grid grid-cols-2 gap-px bg-zinc-100 dark:bg-zinc-800">
      <StatCell label="Accounts" value={273} sub="272 IPA · 1 local" />
      <StatCell label="Groups" value={176} sub="176 IPA · 0 local" />
      <StatCell label="Requests" value={0} sub="none pending" />
      <StatCell label="Expiring 30d" value={0} sub="none soon" />
    </div>
  </div>
</div>`}
  >
    <div class="paper overflow-hidden">
      <div class="grid grid-cols-1 lg:grid-cols-[1.2fr_1.8fr]">
        <div class="flex flex-col gap-3 border-zinc-100 px-5 py-5 dark:border-zinc-800 lg:border-r">
          <div class="flex items-center justify-between gap-3">
            <span class="text-[10px] uppercase tracking-wider text-dimmed">Run health</span>
            <span class="tag bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <i class="ti ti-check" />
              Synced 2 mins ago
            </span>
          </div>
          <div class="flex flex-1 flex-col justify-center gap-2">
            {[
              ["IPA sync", 100],
              ["IPA demotion", 100],
              ["Reminders", 100],
            ].map(([label, rate]) => (
              <div class="flex items-center gap-3">
                <span class="w-28 shrink-0 truncate text-xs text-secondary">{label}</span>
                <ProgressBar value={rate as number} size="xs" class="min-w-0 flex-1" />
                <span class="shrink-0 text-[11px] tabular-nums text-dimmed">{rate}%</span>
              </div>
            ))}
          </div>
          <span class="text-[10px] text-dimmed">Based on last 10 runs</span>
        </div>

        <div class="grid grid-cols-2 gap-px bg-zinc-100 dark:bg-zinc-800">
          <StatCell label="Accounts" value={273} sub="272 IPA · 1 local" accent={{ tone: "blue", icon: "ti ti-users" }} />
          <StatCell label="Groups" value={176} sub="176 IPA · 0 local" />
          <StatCell label="Requests" value={0} sub="none pending" />
          <StatCell label="Expiring 30d" value={0} sub="none soon" />
        </div>
      </div>
    </div>
  </DemoCard>
);

/* ── Widget endpoint responses ───────────────────────── */

const WidgetResponseExample = (props: { response: WidgetResponse }) => (
  <div class="max-w-md">
    <WidgetPreview response={props.response} />
  </div>
);

export const WidgetAdminQueueDemo = () => (
  <DemoCard
    id="widget-admin-queue"
    chip={[
      { kind: "component", name: "Widget", from: FROM_UI },
      { kind: "component", name: "WidgetStat", from: FROM_UI },
      { kind: "component", name: "WidgetStatus", from: FROM_UI },
      { kind: "component", name: "WidgetPills", from: FROM_UI },
    ]}
    description="Admin summary endpoint response. Covers widget `href`/`meta`, stat `grow`, `valueClass`, accent pill text, status with custom icon, and pills with tones/hrefs."
    code={`// packages/my-app/src/api/widgets.ts
const body: WidgetResponse = ${stringifyWidget(adminQueueWidget)};
return c.json(body);`}
  >
    <WidgetResponseExample response={adminQueueWidget} />
  </DemoCard>
);

export const WidgetRecentNotesDemo = () => (
  <DemoCard
    id="widget-recent-notes"
    chip={[
      { kind: "component", name: "Widget", from: FROM_UI },
      { kind: "component", name: "WidgetList", from: FROM_UI },
    ]}
    description="List-heavy endpoint response. Covers header meta, list `grow`, list item icon/iconTone/label/sub/meta/href, and list `emptyMessage` for an empty block."
    code={`const body: WidgetResponse = ${stringifyWidget(recentNotesWidget)};
return c.json(body);`}
  >
    <WidgetResponseExample response={recentNotesWidget} />
  </DemoCard>
);

export const WidgetHeroDemo = () => (
  <DemoCard
    id="widget-hero"
    chip={{ kind: "component", name: "WidgetHero", from: FROM_UI }}
    description="Hero blocks are the endpoint-driven empty-state / all-clear response. Return JSON with `kind: 'hero'`; the dashboard renders the visual block."
    code={`const body: WidgetResponse = ${stringifyWidget(allClearWidget)};
return c.json(body);`}
  >
    <WidgetResponseExample response={allClearWidget} />
  </DemoCard>
);

export const WidgetServiceStatesDemo = () => (
  <DemoCard
    id="widget-service-states"
    chip={[
      { kind: "component", name: "WidgetStatus", from: FROM_UI },
      { kind: "component", name: "WidgetPills", from: FROM_UI },
    ]}
    description="Status and tone coverage. Shows `ok`, `info`, `error`, custom status icons, `grow` on pills, and all widget pill tones."
    code={`const body: WidgetResponse = ${stringifyWidget(serviceStatesWidget)};
return c.json(body);`}
  >
    <WidgetResponseExample response={serviceStatesWidget} />
  </DemoCard>
);

export const SurfacesCardsTab = () => (
  <div class="grid grid-cols-1 gap-3">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <PaperUtility />
      <ThumbnailUtility />
      <LinkCardDemo />
      <ProgressBarDemo />
      <AvatarDemo />
      <StatCellDemo />
    </div>
    <StatGridDemo />
    <WidgetAdminQueueDemo />
    <WidgetRecentNotesDemo />
    <WidgetHeroDemo />
    <WidgetServiceStatesDemo />
  </div>
);
