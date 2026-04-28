import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { listWidgets, type DashboardWidget } from "@valentinkolb/cloud";
import { logger } from "@valentinkolb/cloud/services";
import { gradients } from "@valentinkolb/stdlib";
import {
  Widget,
  WidgetHero,
  WidgetList,
  WidgetPills,
  WidgetStat,
  WidgetStatus,
} from "@valentinkolb/cloud/ui";
import type {
  WidgetResponse,
  WidgetBlock,
} from "@valentinkolb/cloud/contracts";
import type { JSX } from "solid-js";
import EditDashboard, {
  DASHBOARD_COOKIE,
  type DashboardSettings,
  type DashboardWidgetSummary,
} from "./EditDashboard.island";

const log = logger("dashboard");

/**
 * Status code semantics (kept in sync with every widget endpoint):
 *   - 200 → render the response. The body always carries content — for empty
 *           states the endpoint returns a hero/status block with a hint.
 *   - 403 → user lacks the access level. Listed under "not available at your
 *           access level" in the edit modal.
 *   - other → log + skip silently (transient error).
 */
const fetchWidget = async (
  widget: DashboardWidget,
  cookie: string,
): Promise<
  | { source: DashboardWidget; status: 200; data: WidgetResponse }
  | { source: DashboardWidget; status: 403 }
  | null
> => {
  try {
    const resp = await fetch(widget.url, { headers: cookie ? { Cookie: cookie } : {} });
    if (resp.status === 403) return { source: widget, status: 403 };
    if (!resp.ok) {
      log.warn("Widget fetch failed", {
        appId: widget.appId,
        widgetId: widget.widgetId,
        status: resp.status,
      });
      return null;
    }
    const data = (await resp.json()) as WidgetResponse;
    return { source: widget, status: 200, data };
  } catch (err) {
    log.warn("Widget fetch threw", {
      appId: widget.appId,
      widgetId: widget.widgetId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
};

const renderBlock = (block: WidgetBlock): JSX.Element => {
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
      return (
        <WidgetList items={block.items} emptyMessage={block.emptyMessage} grow={block.grow} />
      );
    case "status":
      return (
        <WidgetStatus
          tone={block.tone}
          title={block.title}
          message={block.message}
          icon={block.icon}
          grow={block.grow}
        />
      );
    case "pills":
      return <WidgetPills pills={block.pills} grow={block.grow} />;
    case "hero":
      return (
        <WidgetHero title={block.title} subtitle={block.subtitle} icon={block.icon} tone={block.tone} />
      );
    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return null;
    }
  }
};

/**
 * Read dashboard settings from the request cookie. Single source of truth for
 * the cookie key + shape lives in `EditDashboard.island.tsx` so client-write
 * and server-read can't drift apart.
 */
const readDashboardSettings = (cookieHeader: string): DashboardSettings => {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${DASHBOARD_COOKIE}=([^;]+)`));
  if (!match?.[1]) return { hiddenWidgets: [], gradient: "default" };
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1])) as Partial<DashboardSettings>;
    return {
      hiddenWidgets: Array.isArray(parsed.hiddenWidgets) ? parsed.hiddenWidgets : [],
      gradient: typeof parsed.gradient === "string" ? parsed.gradient : "default",
    };
  } catch {
    return { hiddenWidgets: [], gradient: "default" };
  }
};

const widgetKey = (w: DashboardWidget): string => `${w.appId}/${w.widgetId}`;

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const greeting = user?.displayName || user?.uid || "there";
  const cookie = c.req.raw.headers.get("Cookie") ?? "";

  const settings = readDashboardSettings(cookie);
  const gradient = gradients.getGradientById(settings.gradient);

  // Pull every widget endpoint, fetch in parallel, classify by status.
  const widgets = await listWidgets();
  const results = await Promise.all(widgets.map((w) => fetchWidget(w, cookie)));

  const visible = results.filter((r): r is Extract<typeof r, { status: 200 }> => r?.status === 200);
  const inaccessible = results.filter(
    (r): r is Extract<typeof r, { status: 403 }> => r?.status === 403,
  );

  const hiddenSet = new Set(settings.hiddenWidgets);
  const rendered = visible.filter((r) => !hiddenSet.has(widgetKey(r.source)));

  // Summaries for the EditDashboard island — title/icon match what the user sees.
  const availableSummaries: DashboardWidgetSummary[] = visible.map((r) => ({
    key: widgetKey(r.source),
    title: r.data.title,
    icon: r.data.icon ?? r.source.appIcon,
  }));
  const inaccessibleSummaries: DashboardWidgetSummary[] = inaccessible.map((r) => ({
    key: widgetKey(r.source),
    title: r.source.appName,
    icon: r.source.appIcon,
  }));

  return () => (
    <Layout c={c} title="Dashboard">
      <div class="flex-1 min-h-0 overflow-y-auto" style="scrollbar-gutter: stable">
        <div class="max-w-[88rem] mx-auto p-4 sm:p-8 flex flex-col gap-8">
          {/* Welcome — large, centered */}
          <div class="text-center" style="view-transition-name: page-title">
            <h1 class="text-3xl sm:text-4xl font-bold text-primary">
              Hi,{" "}
              <span class={gradient.style ? "" : "text-blue-600 dark:text-blue-400"} style={gradient.style}>
                {greeting}
              </span>
            </h1>
          </div>

          {rendered.length === 0 ? (
            <div class="paper p-8 text-center text-sm text-dimmed">
              No widgets to show. Open <em>Edit dashboard</em> below to enable any you have access to.
            </div>
          ) : (
            // max-w-[68rem] caps the grid so column width stays ~254px at xl
            // (4 × 254 + 3 × 24 ≈ 1088). On wider monitors the leftover space
            // becomes side margin instead of stretching widgets — keeps the
            // "Nextcloud-ish" calm density. Breakpoints lean conservative
            // (md stays at 2 cols) so iPad-portrait widgets aren't cramped.
            <div class="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 max-w-[68rem] mx-auto w-full">
              {rendered.map((entry) => (
                <Widget
                  title={entry.data.title}
                  icon={entry.data.icon ?? entry.source.appIcon}
                  href={entry.data.href}
                  meta={entry.data.meta}
                >
                  {entry.data.blocks.map((block) => renderBlock(block))}
                </Widget>
              ))}
            </div>
          )}

          {/* Edit dashboard — centered button, shown when there's anything to edit. */}
          {availableSummaries.length + inaccessibleSummaries.length > 0 ? (
            <div class="flex justify-center">
              <EditDashboard
                available={availableSummaries}
                inaccessible={inaccessibleSummaries}
                initialHidden={settings.hiddenWidgets}
                initialGradient={settings.gradient}
              />
            </div>
          ) : null}
        </div>
      </div>
    </Layout>
  );
});
