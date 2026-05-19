/**
 * Surfaces & Cards tab — surface utilities (paper, thumbnail), card
 * components (LinkCard, ProgressBar), identity surfaces (Avatar /
 * UserView / GroupView), stat blocks (StatCell / StatGrid), and
 * dashboard widgets composed end-to-end.
 *
 * Widget demos are intentionally minimal — TWO composed examples
 * showing the building blocks together rather than one demo per
 * block. The intent: tell the reader "you mix these in a Widget",
 * not "here's each block in isolation".
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
import DemoCard from "./DemoCard";

const FROM_UI = "@valentinkolb/cloud/ui";

/* ── Surface utilities ─────────────────────────────────── */

const PaperUtility = () => (
  <DemoCard
    id="paper"
    chip={{ kind: "utility", name: "paper" }}
    description="Default content surface. Light bg in light mode, dark bg in dark mode, subtle border."
    code={`<div class="paper p-4">Content goes here.</div>`}
  >
    <div class="paper p-4">Content goes here.</div>
  </DemoCard>
);

const ThumbnailUtility = () => (
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

const LinkCardDemo = () => (
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

const ProgressBarDemo = () => (
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

const AvatarDemo = () => (
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

const StatCellDemo = () => (
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
      <StatCell
        label="Storage used"
        value="847 GB"
        accent={{ tone: "amber", icon: "ti ti-alert-triangle", text: "84% full" }}
      />
      <StatCell label="Requests" value={42} accent={{ tone: "red", icon: "ti ti-flame" }} />
      <StatCell label="Uptime" value="99.98%" accent={{ tone: "emerald", icon: "ti ti-check" }} />
    </div>
  </DemoCard>
);

const StatGridDemo = () => (
  <DemoCard
    id="statgrid"
    chip={{ kind: "component", name: "StatGrid", from: FROM_UI }}
    description="Paper-wrapped grid of `StatCell` children with optional title + action link."
    code={`<StatGrid title="Account requests" columns={3}>
  <StatCell label="Open" value={7} accent={{ tone: "amber", icon: "ti ti-clock" }} />
  <StatCell label="Approved" value={142} />
  <StatCell label="Rejected" value={12} accent={{ tone: "red", icon: "ti ti-x" }} />
</StatGrid>`}
  >
    <StatGrid title="Account requests" columns={3}>
      <StatCell label="Open" value={7} accent={{ tone: "amber", icon: "ti ti-clock" }} />
      <StatCell label="Approved" value={142} />
      <StatCell label="Rejected" value={12} accent={{ tone: "red", icon: "ti ti-x" }} />
    </StatGrid>
  </DemoCard>
);

/* ── Widget composition ──────────────────────────────── */

const WidgetsComposed = () => (
  <DemoCard
    id="widgets-composed"
    chip={[
      { kind: "component", name: "Widget", from: FROM_UI },
      { kind: "component", name: "WidgetStat", from: FROM_UI },
      { kind: "component", name: "WidgetStatus", from: FROM_UI },
      { kind: "component", name: "WidgetList", from: FROM_UI },
      { kind: "component", name: "WidgetPills", from: FROM_UI },
      { kind: "component", name: "WidgetHero", from: FROM_UI },
    ]}
    description="Dashboard widgets compose freely — stack any combination of `WidgetStat / WidgetStatus / WidgetList / WidgetPills / WidgetHero` inside one `Widget` to build a tile that fits the data. Two examples side-by-side."
    code={`<Widget title="Account requests" icon="ti ti-id-badge" href="/admin/accounts">
  <WidgetStat
    value={150}
    label="Total"
    accent={{ tone: "emerald", icon: "ti ti-trending-up", text: "+12 this week" }}
  />
  <WidgetPills pills={[
    { label: "Active", value: 142, tone: "emerald" },
    { label: "Pending", value: 8, tone: "amber" },
  ]} />
  <WidgetStatus tone="warn" title="8 requests need review" message="oldest from 2 days ago" />
</Widget>

<Widget title="Recent activity" icon="ti ti-activity">
  <WidgetStat value={48} label="Events today" sub="across all users" />
  <WidgetList items={[
    { icon: "ti ti-user-plus", iconTone: "emerald", label: "Alice joined", sub: "as admin", meta: "2m" },
    { icon: "ti ti-file-text", label: "Spec.md edited", sub: "by Bob", meta: "5m" },
  ]} />
</Widget>`}
  >
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Widget title="Account requests" icon="ti ti-id-badge" href="#widgets-composed">
        <WidgetStat
          value={150}
          label="Total"
          accent={{ tone: "emerald", icon: "ti ti-trending-up", text: "+12 this week" }}
        />
        <WidgetPills
          pills={[
            { label: "Active", value: 142, tone: "emerald" },
            { label: "Pending", value: 8, tone: "amber" },
          ]}
        />
        <WidgetStatus tone="warn" title="8 requests need review" message="oldest from 2 days ago" />
      </Widget>
      <Widget title="Recent activity" icon="ti ti-activity" meta="last 24h">
        <WidgetStat value={48} label="Events today" sub="across all users" />
        <WidgetList
          items={[
            { icon: "ti ti-user-plus", iconTone: "emerald", label: "Alice joined", sub: "as admin", meta: "2m" },
            { icon: "ti ti-file-text", label: "Spec.md edited", sub: "by Bob", meta: "5m" },
            { icon: "ti ti-trash", iconTone: "red", label: "Note removed", meta: "12m" },
            { icon: "ti ti-key", iconTone: "blue", label: "API key rotated", meta: "1h" },
          ]}
        />
      </Widget>
    </div>
  </DemoCard>
);

const WidgetHeroDemo = () => (
  <DemoCard
    id="widget-hero"
    chip={{ kind: "component", name: "WidgetHero", from: FROM_UI }}
    description="The empty-state / onboarding nudge block — usually fills an empty widget when there's nothing else to show."
    code={`<Widget title="Onboarding" icon="ti ti-info-circle">
  <WidgetHero
    icon="ti ti-rocket"
    title="Welcome to the cloud"
    subtitle="Run your first deployment in under 5 minutes."
    tone="blue"
  />
</Widget>`}
  >
    <div class="max-w-md">
      <Widget title="Onboarding" icon="ti ti-info-circle">
        <WidgetHero
          icon="ti ti-rocket"
          title="Welcome to the cloud"
          subtitle="Run your first deployment in under 5 minutes."
          tone="blue"
        />
      </Widget>
    </div>
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
    <WidgetsComposed />
    <WidgetHeroDemo />
  </div>
);
