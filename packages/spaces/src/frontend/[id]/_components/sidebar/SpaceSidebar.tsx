import { AppWorkspace } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { Show } from "solid-js";
import SearchButton from "../search/SearchButton.island";
import type { ViewType } from "../settings/SpaceSettingsStore";
import CopyICalButton from "./CopyICalButton.island";
import CreateItemButton from "./CreateItemButton.island";
import SpaceSettingsButton from "./SpaceSettingsButton.island";
import type { SpaceContext } from "./types";

type Props = {
  ctx: SpaceContext;
  baseUrl: string;
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
  return `/app/spaces/${ctx.space.id}?${query.toString()}`;
};

export default function SpaceSidebar(props: Props) {
  const vt = (key: string) => `space-sidebar-${props.ctx.space.id}-${key}`;

  return (
    <AppWorkspace.Sidebar collapsible>
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
                navigation="document"
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
          <SpaceSettingsButton
            spaceId={props.ctx.space.id}
            baseUrl={props.baseUrl}
            variant="sidebar"
            viewTransitionName={vt("settings-mobile")}
          />
        </AppWorkspace.SidebarMobileItems>
      </AppWorkspace.SidebarMobile>

      <AppWorkspace.SidebarDesktop>
        <div class="flex flex-col gap-3">
          <AppWorkspace.SidebarIconGrid columns={props.ctx.canWrite ? 3 : 2} sidebarMode="expanded">
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

          <AppWorkspace.SidebarSection sidebarMode="expanded">
            {views.map((view) => {
              const href = buildViewHref(props.ctx, view.id);
              return (
                <AppWorkspace.SidebarItem
                  href={href}
                  navigation="document"
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

        <AppWorkspace.SidebarIconGrid sidebarMode="collapsed">
          <Show when={props.ctx.canWrite}>
            <CreateItemButton
              spaceId={props.ctx.space.id}
              columns={props.ctx.columns}
              tags={props.ctx.tags}
              dateConfig={props.dateConfig}
              variant="icon"
              defaultType={props.ctx.currentView === "calendar" ? "event" : "task"}
            />
          </Show>
          <SearchButton
            spaceId={props.ctx.space.id}
            spaceName={props.ctx.space.name}
            columns={props.ctx.columns}
            query={props.ctx.query}
            variant="icon"
          />
          <AppWorkspace.SidebarIconAction href="/app/spaces" navigation="document" icon="ti ti-layout-grid" label="All Spaces" />
          {views.map((view) => (
            <AppWorkspace.SidebarIconAction
              href={buildViewHref(props.ctx, view.id)}
              navigation="document"
              icon={view.icon}
              label={view.label}
              active={props.ctx.currentView === view.id}
            />
          ))}
        </AppWorkspace.SidebarIconGrid>

        <div class="min-h-0 flex-1" />

        <AppWorkspace.SidebarFooter sidebarMode="expanded">
          <div class="flex flex-col gap-1">
            <div style={`view-transition-name:${vt("copy-ical-desktop")}`}>
              <CopyICalButton icalToken={props.ctx.space.icalToken} />
            </div>
            <SpaceSettingsButton
              spaceId={props.ctx.space.id}
              baseUrl={props.baseUrl}
              variant="sidebar"
              viewTransitionName={vt("settings-desktop")}
            />
          </div>
        </AppWorkspace.SidebarFooter>
        <AppWorkspace.SidebarFooter sidebarMode="collapsed">
          <AppWorkspace.SidebarIconGrid>
            <CopyICalButton icalToken={props.ctx.space.icalToken} variant="icon" />
            <SpaceSettingsButton spaceId={props.ctx.space.id} baseUrl={props.baseUrl} variant="icon" />
          </AppWorkspace.SidebarIconGrid>
        </AppWorkspace.SidebarFooter>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
