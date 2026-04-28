import { ssr } from "../../config";
import { weatherService, type WeatherData } from "@valentinkolb/cloud/services";
import { HourlyForecast, DailyForecast, RadarCard } from "../_components";

const formatHour = (timestamp: string): string => {
  return new Date(timestamp).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

// Zoom level text sizes for simple view
const zoomClasses = {
  1: {
    temp: "text-6xl",
    location: "text-xl",
    icon: "text-5xl",
    stats: "text-xs",
    hour: "text-xs",
    hourIcon: "text-base",
    hourTemp: "text-sm",
    hourGap: "gap-10",
  },
  2: {
    temp: "text-8xl",
    location: "text-2xl",
    icon: "text-7xl",
    stats: "text-sm",
    hour: "text-sm",
    hourIcon: "text-xl",
    hourTemp: "text-base",
    hourGap: "gap-12",
  },
  3: {
    temp: "text-9xl",
    location: "text-4xl",
    icon: "text-8xl",
    stats: "text-base",
    hour: "text-base",
    hourIcon: "text-2xl",
    hourTemp: "text-lg",
    hourGap: "gap-16",
  },
};

function AutoRefreshScript({ refresh }: { refresh: number }) {
  return (
    <script>{`
      setTimeout(function() {
        const nextUrl = window.location.pathname + window.location.search;
        if (document.startViewTransition) {
          document.startViewTransition(function() {
            window.location.href = nextUrl;
          });
        } else {
          window.location.href = nextUrl;
        }
      }, ${refresh * 1000});
    `}</script>
  );
}

function DisplayView({
  data,
  location,
  state,
  zoom,
  refresh,
}: {
  data: WeatherData;
  location: string;
  state: string | null;
  zoom: 1 | 2 | 3;
  refresh: number;
}) {
  const { current, hourly } = data;
  const sizes = zoomClasses[zoom];

  return (
    <div class="min-h-screen flex flex-col items-center justify-center p-6 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white">
      <AutoRefreshScript refresh={refresh} />

      {/* Main content - centered */}
      <div class="flex flex-col items-center text-center">
        {/* Location */}
        <div class="mb-4">
          <h1 class={`${sizes.location} font-medium`}>{location}</h1>
          {state && <p class="text-sm text-zinc-400 dark:text-zinc-500">{state}</p>}
        </div>

        {/* Temperature and icon */}
        <div class="flex items-center gap-4 mb-6">
          <i
            class={`ti ti-${weatherService.ui.getTablerIcon(current.icon)} ${
              sizes.icon
            } ${weatherService.ui.getTempColorClass(current.temperature)}`}
            style="view-transition-name: weather-icon"
          />
          <span
            class={`${sizes.temp} font-light ${weatherService.ui.getTempColorClass(current.temperature)}`}
            style="view-transition-name: temp-value"
          >
            {weatherService.ui.formatTemp(current.temperature)}
          </span>
        </div>

        {/* Stats */}
        <div class={`flex gap-6 text-zinc-500 dark:text-zinc-400 ${sizes.stats} mb-8`}>
          <div class="flex items-center gap-2">
            <i class="ti ti-droplet text-zinc-400 dark:text-zinc-600" />
            <span>{current.humidity ?? "-"}%</span>
          </div>
          <div class="flex items-center gap-2">
            <i class="ti ti-wind text-zinc-400 dark:text-zinc-600" />
            <span>{current.windSpeed} km/h</span>
          </div>
          <div class="flex items-center gap-2">
            <i class="ti ti-cloud text-zinc-400 dark:text-zinc-600" />
            <span>{current.cloudCover}%</span>
          </div>
          <div class="flex items-center gap-2">
            <i class="ti ti-umbrella text-zinc-400 dark:text-zinc-600" />
            <span>{current.precipitation} mm</span>
          </div>
        </div>

        {/* Hourly forecast */}
        {hourly.length > 0 && (
          <div class={`flex ${sizes.hourGap} justify-center`}>
            {hourly.slice(0, 7).map((h) => (
              <div class="flex flex-col items-center gap-1">
                <span class={`${sizes.hour} text-zinc-400 dark:text-zinc-600`}>{formatHour(h.timestamp)}</span>
                <div class="flex items-center gap-1">
                  <i
                    class={`ti ti-${weatherService.ui.getTablerIcon(h.icon)} ${
                      sizes.hourIcon
                    } ${weatherService.ui.getTempColorClass(h.temperature)}`}
                  />
                  <span class={`${sizes.hourTemp} font-medium ${weatherService.ui.getTempColorClass(h.temperature)}`}>
                    {weatherService.ui.formatTemp(h.temperature)}
                  </span>
                </div>
                {h.precipitationProbability != null && h.precipitationProbability > 0 ? (
                  <span class={`${sizes.hour} text-blue-400`}>
                    <i class="ti ti-droplet" /> {h.precipitationProbability}%
                  </span>
                ) : (
                  <span class={`${sizes.hour} text-transparent`}>-</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Time in corner */}
      <div class="absolute top-4 right-4 text-xs text-zinc-400 dark:text-zinc-600">
        {new Date().toLocaleTimeString("de-DE", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>
    </div>
  );
}

// Zoom level sizes for detail view
const detailZoomClasses = {
  1: {
    temp: "text-5xl",
    icon: "text-4xl",
    location: "text-lg",
    time: "text-xs",
    stats: "text-sm",
    statsGap: "gap-6",
    hourly: "md" as const,
    daily: "md" as const,
    radar: "md" as const,
    padding: "p-4",
    cardPadding: "p-4",
    gap: "gap-4",
    header: "text-[10px]",
    conditions: "text-sm",
  },
  2: {
    temp: "text-7xl",
    icon: "text-6xl",
    location: "text-xl",
    time: "text-sm",
    stats: "text-base",
    statsGap: "gap-8",
    hourly: "lg" as const,
    daily: "lg" as const,
    radar: "lg" as const,
    padding: "p-5",
    cardPadding: "p-5",
    gap: "gap-5",
    header: "text-xs",
    conditions: "text-base",
  },
  3: {
    temp: "text-8xl",
    icon: "text-7xl",
    location: "text-2xl",
    time: "text-base",
    stats: "text-lg",
    statsGap: "gap-10",
    hourly: "lg" as const,
    daily: "lg" as const,
    radar: "lg" as const,
    padding: "p-6",
    cardPadding: "p-6",
    gap: "gap-6",
    header: "text-xs",
    conditions: "text-lg",
  },
};

function DetailDisplayView({
  data,
  location,
  state,
  zoom,
  refresh,
}: {
  data: WeatherData;
  location: string;
  state: string | null;
  zoom: 1 | 2 | 3;
  refresh: number;
}) {
  const { current, hourly, daily } = data;
  const s = detailZoomClasses[zoom];

  return (
    <div class="h-screen flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white overflow-hidden">
      <AutoRefreshScript refresh={refresh} />

      {/* Main content - 2 columns */}
      <div class={`flex-1 grid grid-cols-2 ${s.gap} ${s.padding} min-h-0`}>
        {/* Left column: Current + Hourly + Daily + Conditions */}
        <div class={`flex flex-col ${s.gap} min-h-0`}>
          {/* Current weather - centered and prominent */}
          <div class="flex flex-col items-center text-center py-4">
            {/* Location and time */}
            <div class="mb-4">
              <h1 class={`${s.location} font-medium`}>{location}</h1>
              <p class={`${s.time} text-zinc-400 dark:text-zinc-500`}>
                {state ? `${state} · ` : ""}
                {new Date().toLocaleTimeString("de-DE", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <div class="flex items-center gap-6 mb-4">
              <i
                class={`ti ti-${weatherService.ui.getTablerIcon(current.icon)} ${
                  s.icon
                } ${weatherService.ui.getTempColorClass(current.temperature)}`}
                style="view-transition-name: weather-icon"
              />
              <span
                class={`${s.temp} font-light ${weatherService.ui.getTempColorClass(current.temperature)}`}
                style="view-transition-name: temp-value"
              >
                {weatherService.ui.formatTemp(current.temperature)}
              </span>
            </div>
            {/* Stats row */}
            <div class={`flex ${s.statsGap} ${s.stats} text-zinc-500 dark:text-zinc-400`}>
              <div class="flex items-center gap-2">
                <i class="ti ti-droplet text-zinc-400 dark:text-zinc-600" />
                <span>{current.humidity ?? "-"}%</span>
              </div>
              <div class="flex items-center gap-2">
                <i class="ti ti-wind text-zinc-400 dark:text-zinc-600" />
                <span>{current.windSpeed} km/h</span>
              </div>
              <div class="flex items-center gap-2">
                <i class="ti ti-cloud text-zinc-400 dark:text-zinc-600" />
                <span>{current.cloudCover}%</span>
              </div>
              <div class="flex items-center gap-2">
                <i class="ti ti-umbrella text-zinc-400 dark:text-zinc-600" />
                <span>{current.precipitation} mm</span>
              </div>
            </div>
          </div>

          {/* Hourly forecast */}
          {hourly.length > 0 && (
            <div class={`bg-zinc-50 dark:bg-zinc-900 rounded-xl ${s.cardPadding}`}>
              <h2 class={`${s.header} font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3`}>Hourly</h2>
              <HourlyForecast hourly={hourly} limit={8} size={s.hourly} showNow={true} />
            </div>
          )}

          {/* 7-day forecast */}
          {daily.length > 0 && (
            <div class={`bg-zinc-50 dark:bg-zinc-900 rounded-xl ${s.cardPadding} flex-1 flex flex-col`}>
              <h2 class={`${s.header} font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3`}>7-Day Forecast</h2>
              <div class="flex-1">
                <DailyForecast daily={daily} size={s.daily} />
              </div>
            </div>
          )}

          {/* Current Conditions */}
          <div class={`bg-zinc-50 dark:bg-zinc-900 rounded-xl ${s.cardPadding}`}>
            <h2 class={`${s.header} font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3`}>Current Conditions</h2>
            <div class={`grid grid-cols-4 gap-4 ${s.conditions}`}>
              <div class="text-zinc-500 dark:text-zinc-400">
                <span class="text-dimmed">Pressure</span>
                <div class="font-medium text-zinc-700 dark:text-zinc-300">{current.pressure != null ? `${current.pressure} hPa` : "-"}</div>
              </div>
              <div class="text-zinc-500 dark:text-zinc-400">
                <span class="text-dimmed">Dew Point</span>
                <div class="font-medium text-zinc-700 dark:text-zinc-300">{current.dewPoint != null ? `${current.dewPoint}°` : "-"}</div>
              </div>
              <div class="text-zinc-500 dark:text-zinc-400">
                <span class="text-dimmed">Visibility</span>
                <div class="font-medium text-zinc-700 dark:text-zinc-300">
                  {current.visibility != null ? `${(current.visibility / 1000).toFixed(1)} km` : "-"}
                </div>
              </div>
              <div class="text-zinc-500 dark:text-zinc-400">
                <span class="text-dimmed">Sunshine</span>
                <div class="font-medium text-zinc-700 dark:text-zinc-300">{current.sunshine != null ? `${current.sunshine} min` : "-"}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right column: Radar (height matches left column) */}
        <div class={`bg-zinc-50 dark:bg-zinc-900 rounded-xl ${s.cardPadding} flex flex-col min-h-0`}>
          <h2 class={`${s.header} font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3`}>Rain Radar</h2>
          <div class="flex-1 min-h-0">
            <RadarCard size={s.radar} showLegend={true} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <div class="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white min-h-screen flex items-center justify-center">
      <div class="text-center">
        <i class="ti ti-cloud-off text-4xl text-zinc-300 dark:text-zinc-700 mb-3 block" />
        <p class="text-zinc-500 dark:text-zinc-400 text-sm">{message}</p>
        <p class="text-zinc-400 dark:text-zinc-600 text-xs mt-3">/weather/display?lat=52.52&lon=13.405&zoom=1&theme=dark</p>
        <p class="text-zinc-400 dark:text-zinc-600 text-xs mt-1">/weather/display?lat=52.52&lon=13.405&detail=true&theme=dark</p>
      </div>
    </div>
  );
}

/**
 * Public weather display endpoint for monitors.
 * URL params:
 * - lat: Latitude (required)
 * - lon: Longitude (required)
 * - zoom: 1, 2, or 3 (default: 2)
 * - theme: light or dark (default: light)
 * - refresh: Refresh interval in seconds (default: 60)
 * - detail: true for detailed view with radar and 7-day forecast
 */
export default ssr(async (c) => {
  const lat = c.req.query("lat");
  const lon = c.req.query("lon");
  const zoomParam = c.req.query("zoom");
  const themeParam = c.req.query("theme");
  const refreshParam = c.req.query("refresh");
  const detailParam = c.req.query("detail");

  // Set theme from URL parameter (default: light)
  c.get("page").theme = themeParam === "dark" ? "dark" : "light";

  if (!lat || !lon) {
    return () => <ErrorView message="Please provide lat and lon parameters." />;
  }

  const zoom = (parseInt(zoomParam || "2") || 2) as 1 | 2 | 3;
  const clampedZoom = Math.max(1, Math.min(3, zoom)) as 1 | 2 | 3;
  const refresh = Math.max(10, parseInt(refreshParam || "60") || 60);
  const isDetail = detailParam === "true";

  const data = await weatherService.forecast.get({ lat, lon });
  if (!data) {
    return () => <ErrorView message="Could not load weather data." />;
  }

  const geoResult = await weatherService.location.city.get({
    lat: parseFloat(lat),
    lon: parseFloat(lon),
  });
  const city = geoResult.ok ? geoResult.data : null;
  const locationName = city?.name ?? `${lat}, ${lon}`;
  const state = city?.state ?? null;

  if (isDetail) {
    return () => <DetailDisplayView data={data} location={locationName} state={state} zoom={clampedZoom} refresh={refresh} />;
  }

  return () => <DisplayView data={data} location={locationName} state={state} zoom={clampedZoom} refresh={refresh} />;
});
