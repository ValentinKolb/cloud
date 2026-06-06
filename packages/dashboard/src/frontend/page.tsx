import { type DashboardWidget, listApps, listLegalLinks, listWidgets } from "@valentinkolb/cloud";
import type { WidgetBlock, WidgetResponse } from "@valentinkolb/cloud/contracts";
import { type AppRegistryEntry, hasRole, type Role, type User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { logger } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { Widget, WidgetHero, WidgetList, WidgetPills, WidgetStat, WidgetStatus } from "@valentinkolb/cloud/ui";
import { gradients } from "@valentinkolb/stdlib";
import type { JSX } from "solid-js";
import { ssr } from "../config";
import { dashboardSettingsService } from "../service";
import {
  DASHBOARD_COOKIE,
  type DashboardAppSummary,
  type DashboardSettings,
  type DashboardWidgetSummary,
  normalizeDashboardSettings,
} from "../shared";
import DashboardControls, { DashboardEditButton } from "./EditDashboard.island";

const log = logger("dashboard");
const WIDGET_TIMEOUT_MS = 500;
const SLOW_WIDGET_MS = 250;

type WidgetFetchResult =
  | { source: DashboardWidget; status: 200; data: WidgetResponse }
  | { source: DashboardWidget; status: 403 }
  | { source: DashboardWidget; status: "error"; data: WidgetResponse };

/**
 * Status code semantics (kept in sync with every widget endpoint):
 *   - 200 → render the response. The body always carries content — for empty
 *           states the endpoint returns a hero/status block with a hint.
 *   - 403 → user lacks the access level. Listed under "not available at your
 *           access level" in the edit modal.
 *   - 204 → no content; skip silently.
 *   - other / timeout → render a small error placeholder so one bad widget
 *           does not block or disappear from the dashboard.
 */
const widgetErrorResponse = (widget: DashboardWidget, message: string): WidgetResponse => ({
  title: widget.appName,
  icon: widget.appIcon,
  blocks: [
    {
      kind: "status",
      tone: "error",
      title: "Widget unavailable",
      message,
      icon: "ti ti-alert-circle",
      grow: true,
    },
  ],
});

const logSlowWidget = (widget: DashboardWidget, durationMs: number, status: number | "timeout" | "error") => {
  if (durationMs < SLOW_WIDGET_MS) return;
  log.warn("Slow dashboard widget", {
    appId: widget.appId,
    widgetId: widget.widgetId,
    status,
    durationMs,
    thresholdMs: SLOW_WIDGET_MS,
  });
};

const fetchWidget = async (widget: DashboardWidget, cookie: string): Promise<WidgetFetchResult | null> => {
  const controller = new AbortController();
  const startedAt = performance.now();
  const timeout = setTimeout(() => controller.abort(), WIDGET_TIMEOUT_MS);

  try {
    const resp = await fetch(widget.url, {
      headers: cookie ? { Cookie: cookie } : {},
      signal: controller.signal,
    });
    const durationMs = Math.round(performance.now() - startedAt);
    logSlowWidget(widget, durationMs, resp.status);

    if (resp.status === 403) return { source: widget, status: 403 };
    if (resp.status === 204) return null;
    if (!resp.ok) {
      log.warn("Widget fetch failed", {
        appId: widget.appId,
        widgetId: widget.widgetId,
        status: resp.status,
        durationMs,
      });
      return {
        source: widget,
        status: "error",
        data: widgetErrorResponse(widget, "The widget endpoint returned an error."),
      };
    }
    const data = (await resp.json()) as WidgetResponse;
    return { source: widget, status: 200, data };
  } catch (err) {
    const durationMs = Math.round(performance.now() - startedAt);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    logSlowWidget(widget, durationMs, isTimeout ? "timeout" : "error");
    log.warn("Widget fetch threw", {
      appId: widget.appId,
      widgetId: widget.widgetId,
      error: err instanceof Error ? err.message : String(err),
      durationMs,
      timeoutMs: WIDGET_TIMEOUT_MS,
    });
    return {
      source: widget,
      status: "error",
      data: widgetErrorResponse(widget, isTimeout ? "The widget took too long to respond." : "The widget could not be loaded."),
    };
  } finally {
    clearTimeout(timeout);
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
      return <WidgetList items={block.items} emptyMessage={block.emptyMessage} grow={block.grow} />;
    case "status":
      return <WidgetStatus tone={block.tone} title={block.title} message={block.message} icon={block.icon} grow={block.grow} />;
    case "pills":
      return <WidgetPills pills={block.pills} grow={block.grow} />;
    case "hero":
      return <WidgetHero title={block.title} subtitle={block.subtitle} icon={block.icon} tone={block.tone} />;
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
const readLegacyDashboardSettings = (cookieHeader: string): DashboardSettings | null => {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${DASHBOARD_COOKIE}=([^;]+)`));
  if (!match?.[1]) return null;
  try {
    return normalizeDashboardSettings(JSON.parse(decodeURIComponent(match[1])));
  } catch {
    return null;
  }
};

const widgetKey = (w: DashboardWidget): string => `${w.appId}/${w.widgetId}`;

const appIsAvailable = (app: AppRegistryEntry, user: User) => {
  const nav = app.nav;
  if (!nav || nav.section === "hidden") return false;
  if (nav.requiresRoles?.length && !nav.requiresRoles.some((role) => hasRole(user, role as Role))) return false;
  return true;
};

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const greeting = user?.displayName || user?.uid || "there";
  const cookie = c.req.raw.headers.get("Cookie") ?? "";

  const storedSettings = await dashboardSettingsService.get(user.id);
  const legacySettings = !storedSettings.exists ? readLegacyDashboardSettings(cookie) : null;
  if (legacySettings) await dashboardSettingsService.save(user.id, legacySettings);
  const settings = legacySettings ?? storedSettings.settings;
  const gradient = gradients.getGradientById(settings.gradient);

  const [widgets, apps] = await Promise.all([listWidgets(), listApps()]);
  const legalLinks = await listLegalLinks();
  const availableApps: DashboardAppSummary[] = [
    ...apps
      .filter((entry) => appIsAvailable(entry, user))
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        icon: entry.icon,
        href: entry.nav?.href ?? entry.routes[0] ?? "#",
        description: entry.description,
      })),
    ...(hasRole(user, "admin")
      ? [
          {
            id: "admin",
            name: "Admin",
            icon: "ti ti-shield-cog",
            href: "/admin",
            description: "Platform administration, app settings, logs, and gateway controls.",
          },
        ]
      : []),
  ];
  const hiddenSet = new Set(settings.hiddenWidgets);
  const widgetsToFetch = widgets.filter((w) => !hiddenSet.has(widgetKey(w)));
  const hiddenSummaries: DashboardWidgetSummary[] = widgets
    .filter((w) => hiddenSet.has(widgetKey(w)))
    .map((w) => ({
      key: widgetKey(w),
      title: w.appName,
      icon: w.appIcon,
    }));

  // Pull visible widget endpoints, fetch in parallel, classify by status.
  const results = await Promise.all(widgetsToFetch.map((w) => fetchWidget(w, cookie)));

  const visible = results.filter((r): r is Extract<typeof r, { status: 200 }> => r?.status === 200);
  const inaccessible = results.filter((r): r is Extract<typeof r, { status: 403 }> => r?.status === 403);
  const failed = results.filter((r): r is Extract<typeof r, { status: "error" }> => r?.status === "error");

  const rendered = [...visible, ...failed].filter((r) => !hiddenSet.has(widgetKey(r.source)));

  // Summaries for the EditDashboard island — title/icon match what the user sees.
  const availableSummaries: DashboardWidgetSummary[] = [
    ...[...visible, ...failed].map((r) => ({
      key: widgetKey(r.source),
      title: r.data.title,
      icon: r.data.icon ?? r.source.appIcon,
    })),
    ...hiddenSummaries,
  ];
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

          <DashboardControls
            apps={availableApps}
            legalLinks={legalLinks}
            settings={settings}
            available={availableSummaries}
            inaccessible={inaccessibleSummaries}
          />

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

          <DashboardEditButton
            apps={availableApps}
            legalLinks={legalLinks}
            settings={settings}
            available={availableSummaries}
            inaccessible={inaccessibleSummaries}
          />
        </div>
      </div>
    </Layout>
  );
});
