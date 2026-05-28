import { AppWorkspace, type LinkNavigateEvent } from "@valentinkolb/cloud/ui";
import SidebarSettings from "../settings/SidebarSettings";
import type { ViewType } from "../settings/SpaceSettingsStore";
import CopyICalButton from "./CopyICalButton";
import CreateItemButton from "./CreateItemButton";
import type { SpaceContext } from "./types";

type Props = {
  ctx: SpaceContext;
  onNavigate: (event: LinkNavigateEvent) => void | Promise<void>;
  onOpenSettings: () => void | Promise<void>;
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

  return (
    <AppWorkspace.Sidebar>
      <AppWorkspace.SidebarHeader
        title={props.ctx.space.name}
        icon={getViewIcon(props.ctx.currentView)}
        iconStyle={`background-color: ${props.ctx.space.color}`}
        iconViewTransitionName={`space-color-${props.ctx.space.id}`}
        titleViewTransitionName={`space-name-${props.ctx.space.id}`}
        action={
          <button
            type="button"
            onClick={() => void props.onOpenSettings()}
            class="absolute right-0 top-0 inline-flex h-6 w-6 items-center justify-center text-dimmed transition-colors hover:text-primary"
            title="Settings"
            aria-label={`Settings for ${props.ctx.space.name}`}
            style={`view-transition-name:${vt("settings-desktop")}`}
          >
            <i class="ti ti-settings text-xs" />
          </button>
        }
      />

      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileItems scrollPreserveKey={`spaces-sidebar-mobile-${props.ctx.space.id}`}>
          <AppWorkspace.SidebarItem
            onClick={() => void props.onOpenSettings()}
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
          {views.map((view) => {
            const href = buildViewHref(props.ctx, view.id);
            return (
              <AppWorkspace.SidebarItem
                href={href}
                navigation="enhanced"
                onNavigate={props.onNavigate}
                icon={view.icon}
                active={props.ctx.currentView === view.id}
                viewTransitionName={vt(`view-${view.id}-mobile`)}
              >
                {view.label}
              </AppWorkspace.SidebarItem>
            );
          })}
          <div style={`view-transition-name:${vt("copy-ical-mobile")}`}>
            <CopyICalButton icalToken={props.ctx.space.icalToken} variant="chip" />
          </div>
        </AppWorkspace.SidebarMobileItems>
      </AppWorkspace.SidebarMobile>

      <AppWorkspace.SidebarDesktop>
        <div class="flex flex-col gap-3">
          <AppWorkspace.SidebarSection title="Actions">
            <AppWorkspace.SidebarIconGrid columns={3}>
              <div style={`view-transition-name:${vt("create-desktop")}`}>
                <CreateItemButton spaceId={props.ctx.space.id} columns={props.ctx.columns} tags={props.ctx.tags} variant="icon" />
              </div>
              <AppWorkspace.SidebarIconAction
                href="/app/spaces"
                navigation="document"
                icon="ti ti-layout-grid"
                label="All Spaces"
                viewTransitionName={vt("all-spaces-desktop")}
              />
              <div style={`view-transition-name:${vt("copy-ical-desktop")}`}>
                <CopyICalButton icalToken={props.ctx.space.icalToken} variant="icon" />
              </div>
            </AppWorkspace.SidebarIconGrid>
          </AppWorkspace.SidebarSection>

          <AppWorkspace.SidebarSection title="Navigation">
            {views.map((view) => {
              const href = buildViewHref(props.ctx, view.id);
              return (
                <AppWorkspace.SidebarItem
                  href={href}
                  navigation="enhanced"
                  onNavigate={props.onNavigate}
                  icon={view.icon}
                  active={props.ctx.currentView === view.id}
                  viewTransitionName={vt(`view-${view.id}-desktop`)}
                >
                  {view.label}
                </AppWorkspace.SidebarItem>
              );
            })}
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
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
