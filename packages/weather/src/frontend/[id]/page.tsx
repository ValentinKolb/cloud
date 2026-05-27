import { ssr } from "../../config";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { weatherService, type WeatherData } from "@valentinkolb/cloud/services";
import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { DailyForecast, HourlyForecast, RadarCard } from "../_components";
import LocationSidebar from "../_components/LocationSidebar";
import DeleteLocationButton from "../DeleteLocation.island";
import DisplaySettingsButton from "../DisplaySettings.island";

type Location = {
  id: string;
  name: string;
  state: string | null;
  lat: number;
  lon: number;
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
          <HourlyForecast hourly={hourly} />
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
              <DailyForecast daily={daily} />
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
          <RadarCard showLegend />
        </section>
      </div>
    </article>
  );
}

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const id = c.req.param("id") ?? "";

  // Get user's locations
  const locations = (await weatherService.location.saved.list({ userId: user.id })).items;

  // Find active location
  const activeLocation = locations.find((l) => l.id === id);
  if (!activeLocation) {
    return () => (
      <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Weather", href: "/app/weather" }, { title: "Not Found" }]}>
        <AppWorkspace>
          <LocationSidebar locations={locations} activeId={id} weatherMap={new Map()} />
          <AppWorkspace.Main>
            <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed">
              <i class="ti ti-map-pin-off text-sm" />
              Location not found
            </p>
          </AppWorkspace.Main>
        </AppWorkspace>
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

  return () => (
    <Layout
      c={c}
      fullWidth
      title={[{ title: "Start", href: "/" }, { title: "Weather", href: "/app/weather" }, { title: activeLocation.name }]}
    >
      <AppWorkspace>
        <LocationSidebar locations={locations} activeId={id} weatherMap={weatherMap} />

        <AppWorkspace.Main>
          {/* Scrollable content */}
          <div class="flex-1 min-h-0 overflow-y-auto" data-scroll-preserve={`weather-main-${activeLocation.id}`}>
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
        </AppWorkspace.Main>
      </AppWorkspace>
    </Layout>
  );
});
