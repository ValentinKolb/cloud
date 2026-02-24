import CreateItemButton from "./CreateItemButton.island";
import CopyICalButton from "./CopyICalButton.island";
import SidebarSettings from "../settings/SidebarSettings.island";
import ViewSwitcher from "./ViewSwitcher.island";
import type { SpaceContext } from "./types";
import type { ViewType } from "../settings/SpaceSettingsStore";

type Props = {
  ctx: SpaceContext;
  variant?: "mobile" | "desktop";
};

/** Get icon for current view */
const getViewIcon = (view: ViewType): string => {
  switch (view) {
    case "list":
      return "ti-list-check";
    case "kanban":
      return "ti-layout-kanban";
    case "calendar":
      return "ti-calendar";
  }
};

/**
 * Mobile navigation - horizontal chips
 */
function MobileNav({ ctx }: Props) {
  const { space, columns, tags, currentView } = ctx;
  const settingsUrl = `/app/spaces/${space.id}/settings`;

  return (
    <nav class="flex flex-col gap-3">
      {/* Header row: Icon + Name + Settings */}
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={`background-color: ${space.color}`}>
          <i class={`ti ${getViewIcon(currentView)} text-sm`} />
        </div>
        <h1 class="font-semibold truncate flex-1">{space.name}</h1>
        <a href={settingsUrl} class="p-1.5 text-dimmed hover:text-primary">
          <i class="ti ti-settings" />
        </a>
      </div>

      {/* View chips + New Item */}
      <div class="flex flex-wrap items-center gap-2">
        <ViewSwitcher spaceId={space.id} currentView={currentView} variant="chip" />
        <div class="ml-auto">
          <CreateItemButton spaceId={space.id} columns={columns} tags={tags} variant="primary" />
        </div>
      </div>
    </nav>
  );
}

/**
 * Desktop navigation - vertical sidebar
 */
function DesktopNav({ ctx }: Props) {
  const { space, columns, tags, currentView, currentPanelWidth, hasOverride, settings } = ctx;
  const settingsUrl = `/app/spaces/${space.id}/settings`;

  return (
    <>
      {/* Space Title */}
      <div class="flex items-center gap-2 py-2" style="view-transition-name: space-sidebar">
        <div
          class="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
          style={`background-color: ${space.color}; view-transition-name: space-color-${space.id}`}
        >
          <i class={`ti ${getViewIcon(currentView)} text-sm`} />
        </div>
        <h1 class="font-semibold truncate" style={`view-transition-name: space-name-${space.id}`}>
          {space.name}
        </h1>
      </div>

      {/* New Item Button — acts as its own divider in terminal, padded in refined */}
      <div class="py-2">
        <CreateItemButton spaceId={space.id} columns={columns} tags={tags} />
      </div>

      {/* Navigation */}
      <div class="py-3 flex flex-col gap-1">
        <ViewSwitcher spaceId={space.id} currentView={currentView} variant="sidebar" />
      </div>

      <div class="divider" />

      {/* Right Panel */}
      <div class="py-3">
        <SidebarSettings
          spaceId={space.id}
          currentView={currentView}
          currentPanelWidth={currentPanelWidth}
          hasOverride={hasOverride}
          hideSettings={settings.hideSettings}
        />
      </div>

      <div class="divider" />

      {/* General + iCal */}
      <div class="py-3 flex flex-col gap-1">
        <a href={settingsUrl} class="list-item text-xs">
          <i class="ti ti-settings text-sm" />
          <span>General</span>
        </a>
        <CopyICalButton icalToken={space.icalToken} />
      </div>
    </>
  );
}

export default function SpaceSidebar(props: Props) {
  if (props.variant === "mobile") return <MobileNav {...props} />;
  if (props.variant === "desktop") return <DesktopNav {...props} />;
  // Fallback: render both (shouldn't happen with new layout)
  return (
    <>
      <MobileNav {...props} />
      <DesktopNav {...props} />
    </>
  );
}
