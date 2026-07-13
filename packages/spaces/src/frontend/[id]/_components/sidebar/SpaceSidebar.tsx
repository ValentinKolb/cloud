import { AppWorkspace } from "@valentinkolb/cloud/ui";
import type { LinkNavigateEvent } from "@valentinkolb/ssr/nav";
import type { DateContext } from "@valentinkolb/stdlib";
import { Show } from "solid-js";
import SearchButton from "../search/SearchButton";
import type { ViewType } from "../settings/SpaceSettingsStore";
import CopyICalButton from "./CopyICalButton";
import CreateItemButton from "./CreateItemButton";
import type { SpaceContext } from "./types";

type Props = {
  ctx: SpaceContext;
  onNavigate: (event: LinkNavigateEvent) => void | Promise<void>;
  onOpenSettings: () => void | Promise<void>;
  dateConfig?: DateContext;
};

const views: Array<{ id: ViewType; label: string; icon: string }> = [
  { id: "list", label: "Overview", icon: "ti-home" },
  { id: "table", label: "Table", icon: "ti-table" },
  { id: "kanban", label: "Kanban", icon: "ti-layout-kanban" },
  { id: "calendar", label: "Calendar", icon: "ti-calendar" },
];

/** Get icon for current view */
const getViewIcon = (view: ViewType): string => {
  switch (view) {
    case "list":
      return "ti-home";
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
        iconStyle={`background-color: color-mix(in srgb, ${props.ctx.space.color} 12%, var(--ui-surface)); color: ${props.ctx.space.color}; box-shadow: inset 0 0 0 1px color-mix(in srgb, ${props.ctx.space.color} 22%, transparent)`}
        iconViewTransitionName={`space-color-${props.ctx.space.id}`}
        titleViewTransitionName={`space-name-${props.ctx.space.id}`}
      />

      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileItems scrollPreserveKey={`spaces-sidebar-mobile-${props.ctx.space.id}`}>
          <Show when={props.ctx.canWrite}>
            <div style={`view-transition-name:${vt("create-mobile")}`}>
              <CreateItemButton
                spaceId={props.ctx.space.id}
                columns={props.ctx.columns}
                tags={props.ctx.tags}
                dateConfig={props.dateConfig}
                variant="chip"
                defaultType={props.ctx.currentView === "calendar" ? "event" : "task"}
              />
            </div>
          </Show>
          <div style={`view-transition-name:${vt("search-mobile")}`}>
            <SearchButton
              spaceId={props.ctx.space.id}
              spaceName={props.ctx.space.name}
              columns={props.ctx.columns}
              query={props.ctx.query}
              variant="sidebar-mobile"
            />
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
          <AppWorkspace.SidebarItem
            onClick={() => void props.onOpenSettings()}
            icon="ti ti-settings"
            viewTransitionName={vt("settings-mobile")}
          >
            Space settings
          </AppWorkspace.SidebarItem>
        </AppWorkspace.SidebarMobileItems>
      </AppWorkspace.SidebarMobile>

      <AppWorkspace.SidebarDesktop>
        <div class="flex flex-col gap-3">
          <AppWorkspace.SidebarIconGrid columns={props.ctx.canWrite ? 3 : 2}>
            <Show when={props.ctx.canWrite}>
              <div style={`view-transition-name:${vt("create-desktop")}`}>
                <CreateItemButton
                  spaceId={props.ctx.space.id}
                  columns={props.ctx.columns}
                  tags={props.ctx.tags}
                  dateConfig={props.dateConfig}
                  variant="icon"
                  defaultType={props.ctx.currentView === "calendar" ? "event" : "task"}
                />
              </div>
            </Show>
            <div style={`view-transition-name:${vt("search-desktop")}`}>
              <SearchButton
                spaceId={props.ctx.space.id}
                spaceName={props.ctx.space.name}
                columns={props.ctx.columns}
                query={props.ctx.query}
                variant="icon"
                registerShortcut
              />
            </div>
            <AppWorkspace.SidebarIconAction
              href="/app/spaces"
              navigation="document"
              icon="ti ti-layout-grid"
              label="All Spaces"
              viewTransitionName={vt("all-spaces-desktop")}
            />
          </AppWorkspace.SidebarIconGrid>

          <AppWorkspace.SidebarSection>
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

        <div class="min-h-0 flex-1" />

        <AppWorkspace.SidebarFooter>
          <div class="flex flex-col gap-1">
            <div style={`view-transition-name:${vt("copy-ical-desktop")}`}>
              <CopyICalButton icalToken={props.ctx.space.icalToken} />
            </div>
            <AppWorkspace.SidebarItem
              onClick={() => void props.onOpenSettings()}
              icon="ti ti-settings"
              viewTransitionName={vt("settings-desktop")}
            >
              Space settings
            </AppWorkspace.SidebarItem>
          </div>
        </AppWorkspace.SidebarFooter>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
