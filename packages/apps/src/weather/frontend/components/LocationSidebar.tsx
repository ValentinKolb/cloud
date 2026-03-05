import { weatherService, type WeatherData } from "../../service";
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
  const renderLocation = (loc: Location, mode: "desktop" | "mobile") => {
    const data = props.weatherMap.get(loc.id);
    const isActive = loc.id === props.activeId;
    const tempClass = data?.current ? weatherService.ui.getTempColorClass(data.current.temperature) : "";

    return (
      <a
        href={`/app/weather/${loc.id}`}
        class={`sidebar-item sidebar-item-tall ${isActive ? "sidebar-item-active" : ""}`}
        aria-current={isActive ? "page" : undefined}
      >
        <i
          class={`ti ti-${data?.current ? weatherService.ui.getTablerIcon(data.current.icon) : "map-pin"} shrink-0 text-sm ${
            tempClass || "text-dimmed"
          }`}
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs">{loc.name}</p>
          <p class="sidebar-item-meta mt-0.5 text-[11px]">
            {data?.current ? (
              <span class={tempClass}>{weatherService.ui.formatTemp(data.current.temperature)}</span>
            ) : (
              <span class="text-dimmed">No forecast</span>
            )}
            {mode === "desktop" && loc.state ? <span class="ml-1 text-dimmed">· {loc.state}</span> : null}
          </p>
        </div>
      </a>
    );
  };

  return (
    <>
      <nav class="sidebar-container-mobile">
        <details class="group">
          <summary class="sidebar-mobile-toggle">
            <div class="sidebar-header-icon bg-cyan-500">
              <i class="ti ti-temperature-celsius text-xs" />
            </div>
            <span class="sidebar-header-title">Weather</span>
            <span class="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-dimmed transition-transform group-open:rotate-180">
              <i class="ti ti-chevron-down text-sm" />
            </span>
          </summary>
          <div class="sidebar-mobile-actions">
            <div class="w-full">
              <AddLocationButton />
            </div>
          </div>
          <div class="mt-2 max-h-64 overflow-y-auto px-1 pb-2">
            <div class="sidebar-group">{props.locations.map((loc) => renderLocation(loc, "mobile"))}</div>
          </div>
        </details>
      </nav>

      <aside class="sidebar-container">
        <div class="sidebar-header">
          <div class="sidebar-header-icon bg-cyan-500">
            <i class="ti ti-temperature-celsius text-xs" />
          </div>
          <div class="sidebar-header-text">
            <p class="sidebar-header-title">Weather</p>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <section class="sidebar-group">
            <p class="sidebar-section-title">Actions</p>
            <AddLocationButton />
          </section>
        </div>

        <div class="sidebar-body mt-2">
          <section class="sidebar-group">
            <p class="sidebar-section-title">Locations</p>
            <div class="sidebar-group">{props.locations.map((loc) => renderLocation(loc, "desktop"))}</div>
          </section>
        </div>
      </aside>
    </>
  );
}
