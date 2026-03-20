import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { weatherService, type WeatherData } from "../../service";
import LocationSidebar from "../components/LocationSidebar";
import DeleteLocationButton from "../DeleteLocation.island";
import DisplaySettingsButton from "../DisplaySettings.island";

// DWD Germany-wide radar GIF (always available, no state needed)
const DWD_RADAR_URL = "https://www.dwd.de/DWD/wetter/radar/radfilm_brd_akt.gif";

type Location = {
  id: string;
  name: string;
  state: string | null;
  lat: number;
  lon: number;
};

const formatHour = (timestamp: string, isFirst: boolean): string => {
  const date = new Date(timestamp);

  // Show "Now" for the first entry
  if (isFirst) return "Now";

  // 24h format
  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDay = (dateStr: string): string => {
  const date = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";

  return date.toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
};

function WeatherDetail({ location, data }: { location: Location; data: WeatherData }) {
  const { current, hourly, daily } = data;

  return (
    <article class="flex flex-col gap-4" aria-label={`Weather for ${location.name}`}>
      {/* Header */}
      <header class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold" style="view-transition-name: location-name">
            {location.name}
          </h1>
          {location.state && <p class="text-sm text-dimmed">{location.state}</p>}
        </div>
        <div class="flex items-center gap-2">
          <DisplaySettingsButton lat={location.lat} lon={location.lon} />
          <DeleteLocationButton id={location.id} />
        </div>
      </header>

      {/* Current - centered, no paper */}
      <section class="flex flex-col items-center gap-2 py-4" aria-label="Current weather">
        <div class="flex items-center gap-3">
          <i
            class={`ti ti-${weatherService.ui.getTablerIcon(
              current.icon,
            )} text-5xl ${weatherService.ui.getTempColorClass(current.temperature)}`}
            aria-hidden="true"
            style="view-transition-name: weather-icon"
          />
          <span
            class={`text-5xl font-light ${weatherService.ui.getTempColorClass(current.temperature)}`}
            title={`Temperature ${weatherService.ui.formatTemp(current.temperature)}`}
            style="view-transition-name: weather-temp"
          >
            {weatherService.ui.formatTemp(current.temperature)}
          </span>
        </div>
        <dl class="flex items-center gap-6 text-sm">
          <div class="flex flex-col gap-0.5">
            <div class="text-dimmed">
              <dt class="inline">Humidity</dt> <dd class="inline text-secondary font-medium">{current.humidity ?? "-"}%</dd>
            </div>
            <div class="text-dimmed">
              <dt class="inline">Clouds</dt> <dd class="inline text-secondary font-medium">{current.cloudCover}%</dd>
            </div>
          </div>
          <div class="flex flex-col gap-0.5">
            <div class="text-dimmed">
              <dt class="inline">Wind</dt> <dd class="inline text-secondary font-medium">{current.windSpeed} km/h</dd>
            </div>
            <div class="text-dimmed">
              <dt class="inline">Rain</dt> <dd class="inline text-secondary font-medium">{current.precipitation} mm</dd>
            </div>
          </div>
        </dl>
      </section>

      {/* Hourly Forecast */}
      {hourly.length > 0 && (
        <section class="paper p-4" aria-label="Hourly forecast">
          <h2 class="section-label mb-3">Hourly</h2>
          <div class="flex gap-6 overflow-x-auto pb-1" role="list" aria-label="Hourly temperature forecast">
            {hourly.map((h, idx) => (
              <div
                class="flex flex-col items-center gap-1 min-w-14 flex-1"
                role="listitem"
                aria-label={`${formatHour(h.timestamp, idx === 0)}: ${weatherService.ui.formatTemp(h.temperature)}`}
              >
                {/* Time */}
                <span class={`text-xs ${idx === 0 ? "text-secondary font-medium" : "text-dimmed"}`}>
                  {formatHour(h.timestamp, idx === 0)}
                </span>
                {/* Icon + Temp */}
                <div class="flex items-center gap-1">
                  <i
                    class={`ti ti-${weatherService.ui.getTablerIcon(
                      h.icon,
                    )} text-base ${weatherService.ui.getTempColorClass(h.temperature)}`}
                    aria-hidden="true"
                  />
                  <span class={`text-sm font-medium ${weatherService.ui.getTempColorClass(h.temperature)}`}>
                    {weatherService.ui.formatTemp(h.temperature)}
                  </span>
                </div>
                {/* Rain probability */}
                {h.precipitationProbability != null && h.precipitationProbability > 0 ? (
                  <span class="text-[10px] text-blue-500" title={`${h.precipitationProbability}% chance of rain`}>
                    <i class="ti ti-droplet text-[8px]" aria-hidden="true" /> {h.precipitationProbability}%
                  </span>
                ) : (
                  <span class="text-[10px] text-transparent" aria-hidden="true">
                    -
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Weekly + Radar */}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left column: Weekly Forecast + Details */}
        <div class="flex flex-col gap-4">
          {/* Weekly Forecast */}
          {daily.length > 0 && (
            <section class="paper p-4" aria-label="7-day forecast">
              <h2 class="section-label mb-3">7-Day Forecast</h2>
              <div class="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800" role="list">
                {daily.map((d, idx) => (
                  <div
                    class={`flex items-center gap-4 py-3 ${idx === 0 ? "pt-0" : ""}`}
                    role="listitem"
                    aria-label={`${formatDay(d.date)}: ${weatherService.ui.formatTemp(
                      d.tempMin,
                    )} to ${weatherService.ui.formatTemp(d.tempMax)}`}
                  >
                    <span class="text-sm font-medium w-20">{formatDay(d.date)}</span>
                    <i
                      class={`ti ti-${weatherService.ui.getTablerIcon(d.icon)} text-xl ${weatherService.ui.getAvgTempColorClass(
                        d.tempMin,
                        d.tempMax,
                      )}`}
                      aria-hidden="true"
                    />
                    <div class="flex-1 flex items-center gap-2">
                      {/* Temperature bar visualization */}
                      <span class="text-sm text-dimmed w-8 text-right">{weatherService.ui.formatTemp(d.tempMin)}</span>
                      <div
                        class="flex-1 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden"
                        role="img"
                        aria-label={`Temperature range from ${weatherService.ui.formatTemp(
                          d.tempMin,
                        )} to ${weatherService.ui.formatTemp(d.tempMax)}`}
                      >
                        <div
                          class="h-full bg-linear-to-r from-blue-400 via-emerald-400 to-amber-400 rounded-full"
                          style={`width: ${Math.min(100, Math.max(20, ((d.tempMax - d.tempMin) / 30) * 100))}%; margin-left: ${Math.max(
                            0,
                            ((d.tempMin + 10) / 50) * 100,
                          )}%`}
                        />
                      </div>
                      <span class={`text-sm font-medium w-8 ${weatherService.ui.getTempColorClass(d.tempMax)}`}>
                        {weatherService.ui.formatTemp(d.tempMax)}
                      </span>
                    </div>
                    <div class="flex items-center gap-3 w-24 justify-end">
                      {d.precipitationProbability != null && d.precipitationProbability > 0 && (
                        <span class="text-xs text-blue-500" title={`${d.precipitationProbability}% chance of rain`}>
                          <i class="ti ti-droplet text-[10px]" aria-hidden="true" /> {d.precipitationProbability}%
                        </span>
                      )}
                      {d.sunshine > 0 && (
                        <span class="text-xs text-amber-500" title={`${Math.round(d.sunshine / 60)} hours of sunshine`}>
                          <i class="ti ti-sun text-[10px]" aria-hidden="true" /> {Math.round(d.sunshine / 60)}h
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Current Conditions Details */}
          <section class="paper p-4" aria-label="Current conditions">
            <h2 class="section-label mb-3">Current Conditions</h2>
            <dl class="grid grid-cols-2 gap-4 text-sm">
              <div class="flex flex-col gap-1">
                <div class="text-dimmed">
                  <dt class="inline">Pressure</dt>{" "}
                  <dd class="inline text-secondary font-medium">{current.pressure != null ? `${current.pressure} hPa` : "-"}</dd>
                </div>
                <div class="text-dimmed">
                  <dt class="inline">Dew Point</dt>{" "}
                  <dd class="inline text-secondary font-medium">{current.dewPoint != null ? `${current.dewPoint}°` : "-"}</dd>
                </div>
              </div>
              <div class="flex flex-col gap-1">
                <div class="text-dimmed">
                  <dt class="inline">Visibility</dt>{" "}
                  <dd class="inline text-secondary font-medium">
                    {current.visibility != null ? `${(current.visibility / 1000).toFixed(1)} km` : "-"}
                  </dd>
                </div>
                <div class="text-dimmed">
                  <dt class="inline">Sunshine</dt>{" "}
                  <dd class="inline text-secondary font-medium">{current.sunshine != null ? `${current.sunshine} min` : "-"}</dd>
                </div>
              </div>
            </dl>
          </section>
        </div>

        {/* Radar */}
        <section class="paper p-4" aria-label="Rain radar">
          <h2 class="section-label mb-3">Rain Radar</h2>
          <div class="bg-zinc-100 dark:bg-zinc-800 thumbnail" style="aspect-ratio: 540/500;">
            <img
              src={DWD_RADAR_URL}
              alt="Rain radar animation for Germany showing precipitation"
              class="w-full h-full object-contain"
              loading="lazy"
            />
          </div>

          {/* Legend */}
          <div class="mt-3">
            <div class="flex h-2 rounded overflow-hidden">
              <div class="flex-1 bg-cyan-400" />
              <div class="flex-1 bg-green-600" />
              <div class="flex-1 bg-green-400" />
              <div class="flex-1 bg-yellow-400" />
              <div class="flex-1 bg-orange-500" />
              <div class="flex-1 bg-red-500" />
              <div class="flex-1 bg-purple-600" />
              <div class="flex-1 bg-blue-900" />
            </div>
            <div class="flex justify-between text-[10px] text-dimmed mt-1">
              <span>Light</span>
              <span>Moderate</span>
              <span>Heavy</span>
              <span>Extreme</span>
            </div>
          </div>

          <p class="text-[10px] text-dimmed mt-2 text-center">Germany • DWD</p>
        </section>
      </div>
    </article>
  );
}

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  // Get user's locations
  const locations = (await weatherService.location.saved.list({ userId: user.id })).items;

  // Find active location
  const activeLocation = locations.find((l) => l.id === id);
  if (!activeLocation) {
    return (
      <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Weather", href: "/app/weather" }, { title: "Not Found" }]}>
        <div class="app-cols h-full">
          <LocationSidebar locations={locations} activeId={id} weatherMap={new Map()} />
          <div class="flex-1 min-w-0 flex flex-col">
            <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed">
              <i class="ti ti-map-pin-off text-sm" />
              Location not found
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  // Fetch weather data for active location
  const activeWeather = await weatherService.forecast.get({
    lat: String(activeLocation.lat),
    lon: String(activeLocation.lon),
  });

  // Fetch current weather for sidebar preview (quick, parallel)
  const weatherMap = new Map<string, WeatherData | null>();
  const weatherPromises = locations.map(async (loc) => {
    const data = await weatherService.forecast.get({
      lat: String(loc.lat),
      lon: String(loc.lon),
    });
    weatherMap.set(loc.id, data);
  });
  await Promise.all(weatherPromises);

  return (
    <Layout
      c={c}
      fullWidth
      title={[{ title: "Start", href: "/" }, { title: "Weather", href: "/app/weather" }, { title: activeLocation.name }]}
    >
      <div class="app-cols h-full">
        <LocationSidebar locations={locations} activeId={id} weatherMap={weatherMap} />

        {/* Main */}
        <div class="flex-1 min-w-0 flex flex-col">
          {/* Scrollable content */}
          <div class="flex-1 min-h-0 overflow-y-auto">
            {activeWeather ? (
              <WeatherDetail location={activeLocation} data={activeWeather} />
            ) : (
              <div class="flex flex-col gap-4">
                <header class="flex items-center justify-between">
                  <div>
                    <h1 class="text-xl font-semibold">{activeLocation.name}</h1>
                    {activeLocation.state && <p class="text-sm text-dimmed">{activeLocation.state}</p>}
                  </div>
                  <div class="flex items-center gap-2">
                    <DisplaySettingsButton lat={activeLocation.lat} lon={activeLocation.lon} />
                    <DeleteLocationButton id={activeLocation.id} />
                  </div>
                </header>

                <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed" role="alert">
                  <i class="ti ti-cloud-off text-sm" aria-hidden="true" />
                  Weather data unavailable. DWD only provides data for Germany.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
});
