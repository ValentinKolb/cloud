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
  return (
    <nav class="flex flex-col h-full">
      <h2 class="section-label px-3 pt-3">Locations</h2>

      <div class="flex flex-col">
        {props.locations.map((loc) => {
          const data = props.weatherMap.get(loc.id);
          const isActive = loc.id === props.activeId;
          return (
            <a
              href={`/app/weather/${loc.id}`}
              class={`list-item ${isActive ? "list-item-active" : ""}`}
              aria-current={isActive ? "page" : undefined}
            >
              <div class="flex-1 min-w-0">
                <span class="block truncate">{loc.name}</span>
                {data?.current && (
                  <div class="flex items-center gap-1.5 mt-0.5">
                    <i
                      class={`ti ti-${weatherService.ui.getTablerIcon(data.current.icon)} text-xs ${weatherService.ui.getTempColorClass(
                        data.current.temperature,
                      )}`}
                    />
                    <span class={`text-xs ${weatherService.ui.getTempColorClass(data.current.temperature)}`}>
                      {weatherService.ui.formatTemp(data.current.temperature)}
                    </span>
                  </div>
                )}
              </div>
            </a>
          );
        })}
      </div>

      <div class="mt-auto p-3">
        <AddLocationButton />
      </div>
    </nav>
  );
}
