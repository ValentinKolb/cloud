import CreateItemButton from "./CreateItemButton.island";
import CopyICalButton from "./CopyICalButton.island";
import SidebarSettings from "../settings/SidebarSettings.island";
import type { SpaceContext } from "./types";
import type { ViewType } from "../settings/SpaceSettingsStore";

type Props = {
  ctx: SpaceContext;
};

const views: Array<{ id: ViewType; label: string; icon: string }> = [
  { id: "list", label: "List", icon: "ti-list-check" },
  { id: "table", label: "Table", icon: "ti-table" },
  { id: "kanban", label: "Kanban", icon: "ti-layout-kanban" },
  { id: "calendar", label: "Calendar", icon: "ti-calendar" },
];

/** Get icon for current view */
const getViewIcon = (view: ViewType): string => {
  switch (view) {
    case "list":
      return "ti-list-check";
    case "table":
      return "ti-table";
    case "kanban":
      return "ti-layout-kanban";
    case "calendar":
      return "ti-calendar";
  }
};

const buildViewHref = (ctx: SpaceContext, view: ViewType): string => {
  const query = new URLSearchParams(ctx.query);
  query.set("view", view);
  query.delete("mode");
  return `/app/spaces/${ctx.space.id}?${query.toString()}`;
};

export default function SpaceSidebar(props: Props) {
  const vt = (key: string) => `space-sidebar-${props.ctx.space.id}-${key}`;
  const settingsHref = `/app/spaces/${props.ctx.space.id}/settings`;

  return (
    <>
      <nav class="sidebar-container-mobile">
        <details class="group">
          <summary class="sidebar-mobile-toggle">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={`background-color: ${props.ctx.space.color}`}>
              <i class={`ti ${getViewIcon(props.ctx.currentView)} text-sm`} />
            </div>
            <span class="font-semibold truncate flex-1">{props.ctx.space.name}</span>
            <span class="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-dimmed transition-transform group-open:rotate-180">
              <i class="ti ti-chevron-down text-sm" />
            </span>
          </summary>
          <div class="sidebar-mobile-actions">
            <a href={settingsHref} class="sidebar-item-mobile" style={`view-transition-name:${vt("settings-mobile")}`}>
              <i class="ti ti-settings" />
              Settings
            </a>
            <div style={`view-transition-name:${vt("create-mobile")}`}>
              <CreateItemButton spaceId={props.ctx.space.id} columns={props.ctx.columns} tags={props.ctx.tags} variant="chip" />
            </div>
            <a href="/app/spaces" class="sidebar-item-mobile" style={`view-transition-name:${vt("all-spaces-mobile")}`}>
              <i class="ti ti-layout-grid" />
              All Spaces
            </a>
            {views.map((view) => (
              <a
                href={buildViewHref(props.ctx, view.id)}
                class={`sidebar-item-mobile ${props.ctx.currentView === view.id ? "border-blue-500/35 bg-blue-50/70 text-blue-700 dark:border-blue-400/40 dark:bg-blue-950/40 dark:text-blue-200" : ""}`}
                style={`view-transition-name:${vt(`view-${view.id}-mobile`)}`}
              >
                <i class={`ti ${view.icon}`} />
                {view.label}
              </a>
            ))}
            <div style={`view-transition-name:${vt("copy-ical-mobile")}`}>
              <CopyICalButton icalToken={props.ctx.space.icalToken} variant="chip" />
            </div>
          </div>
        </details>
      </nav>

      <aside class="sidebar-container">
        <div class="paper flex h-full min-h-0 flex-col gap-4 p-3">
          <div class="relative flex items-center gap-3 pr-7">
            <div
              class="sidebar-header-icon"
              style={`background-color: ${props.ctx.space.color}; view-transition-name: space-color-${props.ctx.space.id}`}
            >
              <i class={`ti ${getViewIcon(props.ctx.currentView)} text-xs`} />
            </div>
            <p class="sidebar-header-title flex-1" style={`view-transition-name: space-name-${props.ctx.space.id}`}>
              {props.ctx.space.name}
            </p>
            <a
              href={settingsHref}
              class="absolute right-0 top-0 inline-flex h-6 w-6 items-center justify-center text-dimmed transition-colors hover:text-primary"
              title="Settings"
              style={`view-transition-name:${vt("settings-desktop")}`}
            >
              <i class="ti ti-settings text-xs" />
            </a>
          </div>

          <div class="flex flex-col gap-3">
            <section class="sidebar-group">
              <p class="sidebar-section-title">Actions</p>
              <div style={`view-transition-name:${vt("create-desktop")}`}>
                <CreateItemButton spaceId={props.ctx.space.id} columns={props.ctx.columns} tags={props.ctx.tags} variant="sidebar" />
              </div>
              <a
                href="/app/spaces"
                class="sidebar-item text-xs"
                style={`view-transition-name:${vt("all-spaces-desktop")}`}
              >
                <i class="ti ti-layout-grid text-sm" />
                <span>All Spaces</span>
              </a>
            </section>

            <section class="sidebar-group">
              <p class="sidebar-section-title">Navigation</p>
              {views.map((view) => (
                <a
                  href={buildViewHref(props.ctx, view.id)}
                  class={`sidebar-item text-xs ${props.ctx.currentView === view.id ? "sidebar-item-active" : ""}`}
                  style={`view-transition-name:${vt(`view-${view.id}-desktop`)}`}
                >
                  <i class={`ti ${view.icon} text-sm`} />
                  <span>{view.label}</span>
                </a>
              ))}
            </section>
          </div>

          <div class="sidebar-body">
            <section class="sidebar-group">
              <SidebarSettings
                spaceId={props.ctx.space.id}
                currentView={props.ctx.currentView}
                currentPanelWidth={props.ctx.currentPanelWidth}
                hasOverride={props.ctx.hasOverride}
                hideSettings={props.ctx.settings.hideSettings}
              />
            </section>
          </div>

          <div class="sidebar-footer">
            <div style={`view-transition-name:${vt("copy-ical-desktop")}`}>
              <CopyICalButton icalToken={props.ctx.space.icalToken} />
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
