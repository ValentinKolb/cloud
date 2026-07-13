import { type WeatherData, weatherService } from "@valentinkolb/cloud/services";
import { AppWorkspace } from "@valentinkolb/cloud/ui";
import AddLocationButton from "../AddLocation.island";

type Location = {
  id: string;
  name: string;
  state: string | null;
  lat: number;
  lon: number;
};

type Props = {
  locations: Location[];
  activeId: string | null;
  weatherMap: Map<string, WeatherData | null>;
};

export default function LocationSidebar(props: Props) {
  const activeLocation = props.locations.find((location) => location.id === props.activeId);
  const activeWeather = activeLocation ? props.weatherMap.get(activeLocation.id) : null;

  const renderLocation = (loc: Location, mode: "desktop" | "mobile") => {
    const data = props.weatherMap.get(loc.id);
    const isActive = loc.id === props.activeId;
    const tempClass = data?.current ? weatherService.ui.getTempColorClass(data.current.temperature) : "";

    return (
      <AppWorkspace.SidebarItem
        href={`/app/weather/${loc.id}`}
        navigation="document"
        active={isActive}
        class={mode === "desktop" ? "sidebar-item-tall" : ""}
        title={loc.name}
      >
        <span class="flex min-w-0 flex-1 items-center gap-2">
          <i
            class={`ti ti-${data?.current ? weatherService.ui.getTablerIcon(data.current.icon) : "map-pin"} shrink-0 text-sm ${
              tempClass || "text-dimmed"
            }`}
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-xs">{loc.name}</span>
            <span class="sidebar-item-meta mt-0.5 block text-[11px]">
              {data?.current ? (
                <span class={tempClass}>{weatherService.ui.formatTemp(data.current.temperature)}</span>
              ) : (
                <span class="text-dimmed">No forecast</span>
              )}
              {mode === "desktop" && loc.state ? <span class="ml-1 text-dimmed">· {loc.state}</span> : null}
            </span>
          </span>
        </span>
      </AppWorkspace.SidebarItem>
    );
  };

  return (
    <AppWorkspace.Sidebar>
      <AppWorkspace.SidebarHeader
        title={activeLocation?.name ?? "Weather"}
        icon={`ti ti-${activeWeather?.current ? weatherService.ui.getTablerIcon(activeWeather.current.icon) : "temperature-celsius"}`}
        iconStyle="background-color: color-mix(in srgb, var(--app-accent) 10%, var(--ui-surface)); color: var(--ui-app-accent-text); box-shadow: inset 0 0 0 1px var(--ui-app-accent-border)"
      />

      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileItems>
          <AddLocationButton variant="sidebar" />
        </AppWorkspace.SidebarMobileItems>
        <AppWorkspace.SidebarMobileBody scrollPreserveKey="weather-locations-mobile">
          <AppWorkspace.SidebarSection>{props.locations.map((loc) => renderLocation(loc, "mobile"))}</AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>

      <AppWorkspace.SidebarDesktop>
        <div class="flex min-h-0 flex-1 flex-col gap-3">
          <AddLocationButton />
          <AppWorkspace.SidebarBody scrollPreserveKey="weather-locations">
            <AppWorkspace.SidebarSection title="Locations">
              {props.locations.map((loc) => renderLocation(loc, "desktop"))}
            </AppWorkspace.SidebarSection>
          </AppWorkspace.SidebarBody>
        </div>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
