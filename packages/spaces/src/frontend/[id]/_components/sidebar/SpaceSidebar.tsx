import { AppWorkspace, type LinkNavigateEvent } from "@valentinkolb/cloud/ui";
import SidebarSettings from "../settings/SidebarSettings.island";
import type { ViewType } from "../settings/SpaceSettingsStore";
import CopyICalButton from "./CopyICalButton.island";
import CreateItemButton from "./CreateItemButton.island";
import type { SpaceContext } from "./types";

type Props = {
  ctx: SpaceContext;
  onNavigate?: (event: LinkNavigateEvent) => void | Promise<void>;
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
    <AppWorkspace.Sidebar>
      <AppWorkspace.SidebarHeader
        title={props.ctx.space.name}
        icon={getViewIcon(props.ctx.currentView)}
        iconStyle={`background-color: ${props.ctx.space.color}`}
        iconViewTransitionName={`space-color-${props.ctx.space.id}`}
        titleViewTransitionName={`space-name-${props.ctx.space.id}`}
        action={
          <AppWorkspace.SidebarIconAction
            href={settingsHref}
            navigation={props.onNavigate ? "enhanced" : "document"}
            onNavigate={props.onNavigate}
            icon="ti ti-settings"
            label="Settings"
            viewTransitionName={vt("settings-desktop")}
          />
        }
      />

      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileItems scrollPreserveKey={`spaces-sidebar-mobile-${props.ctx.space.id}`}>
          <AppWorkspace.SidebarItem
            href={settingsHref}
            navigation={props.onNavigate ? "enhanced" : "document"}
            onNavigate={props.onNavigate}
            icon="ti ti-settings"
            viewTransitionName={vt("settings-mobile")}
          >
            Settings
          </AppWorkspace.SidebarItem>
          <div style={`view-transition-name:${vt("create-mobile")}`}>
            <CreateItemButton spaceId={props.ctx.space.id} columns={props.ctx.columns} tags={props.ctx.tags} variant="chip" />
          </div>
          <AppWorkspace.SidebarItem
            href="/app/spaces"
            navigation="document"
            icon="ti ti-layout-grid"
            viewTransitionName={vt("all-spaces-mobile")}
          >
            All Spaces
          </AppWorkspace.SidebarItem>
          {views.map((view) => (
            <AppWorkspace.SidebarItem
              href={buildViewHref(props.ctx, view.id)}
              navigation={props.onNavigate ? "enhanced" : "document"}
              onNavigate={props.onNavigate}
              icon={view.icon}
              active={props.ctx.currentView === view.id}
              viewTransitionName={vt(`view-${view.id}-mobile`)}
            >
              {view.label}
            </AppWorkspace.SidebarItem>
          ))}
          <div style={`view-transition-name:${vt("copy-ical-mobile")}`}>
            <CopyICalButton icalToken={props.ctx.space.icalToken} variant="chip" />
          </div>
        </AppWorkspace.SidebarMobileItems>
      </AppWorkspace.SidebarMobile>

      <AppWorkspace.SidebarDesktop>
        <div class="flex flex-col gap-3">
          <AppWorkspace.SidebarSection title="Actions">
            <div style={`view-transition-name:${vt("create-desktop")}`}>
              <CreateItemButton spaceId={props.ctx.space.id} columns={props.ctx.columns} tags={props.ctx.tags} variant="sidebar" />
            </div>
            <AppWorkspace.SidebarItem
              href="/app/spaces"
              navigation="document"
              icon="ti ti-layout-grid"
              viewTransitionName={vt("all-spaces-desktop")}
            >
              All Spaces
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarSection>

          <AppWorkspace.SidebarSection title="Navigation">
            {views.map((view) => (
              <AppWorkspace.SidebarItem
                href={buildViewHref(props.ctx, view.id)}
                navigation={props.onNavigate ? "enhanced" : "document"}
                onNavigate={props.onNavigate}
                icon={view.icon}
                active={props.ctx.currentView === view.id}
                viewTransitionName={vt(`view-${view.id}-desktop`)}
              >
                {view.label}
              </AppWorkspace.SidebarItem>
            ))}
          </AppWorkspace.SidebarSection>
        </div>

        <AppWorkspace.SidebarBody scrollPreserveKey={`spaces-sidebar-${props.ctx.space.id}`}>
          <AppWorkspace.SidebarSection>
            <SidebarSettings
              spaceId={props.ctx.space.id}
              currentView={props.ctx.currentView}
              currentPanelWidth={props.ctx.currentPanelWidth}
              hasOverride={props.ctx.hasOverride}
              hideSettings={props.ctx.settings.hideSettings}
            />
          </AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarBody>

        <AppWorkspace.SidebarFooter>
          <div style={`view-transition-name:${vt("copy-ical-desktop")}`}>
            <CopyICalButton icalToken={props.ctx.space.icalToken} />
          </div>
        </AppWorkspace.SidebarFooter>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
