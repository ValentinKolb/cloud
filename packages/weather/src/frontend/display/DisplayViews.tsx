import { weatherUiService } from "@valentinkolb/cloud/services/weather/ui";
import type { WeatherDataPayload } from "../../contracts";
import { DailyForecast, HourlyForecast, RadarCard } from "../_components";

const formatHour = (timestamp: string): string =>
  new Date(timestamp).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });

const formatTime = (timestamp: string): string =>
  new Date(timestamp).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });

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

type DisplayProps = {
  data: WeatherDataPayload;
  location: string;
  state: string | null;
  zoom: 1 | 2 | 3;
  now: string;
  refreshSeconds: number;
  refreshedAt: string | null;
};

const refreshAttributes = (props: Pick<DisplayProps, "refreshSeconds" | "refreshedAt">) => ({
  "data-live-refresh": "enabled",
  "data-refresh-seconds": String(props.refreshSeconds),
  "data-last-refresh-at": props.refreshedAt ?? undefined,
});

export function SimpleDisplayView(props: DisplayProps) {
  const { current, hourly } = props.data;
  const sizes = zoomClasses[props.zoom];

  return (
    <main
      class="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-white p-6 text-zinc-900 dark:bg-zinc-950 dark:text-white"
      {...refreshAttributes(props)}
    >
      <div class="flex max-w-full flex-col items-center text-center">
        <div class="mb-4">
          <h1 class={`${sizes.location} font-medium`}>{props.location}</h1>
          {props.state && <p class="text-sm text-zinc-400 dark:text-zinc-500">{props.state}</p>}
        </div>

        <div class="mb-6 flex items-center gap-4">
          <i
            class={`ti ti-${weatherUiService.getTablerIcon(current.icon)} ${sizes.icon} ${weatherUiService.getTempColorClass(
              current.temperature,
            )}`}
            aria-hidden="true"
            style="view-transition-name: weather-icon"
          />
          <span
            class={`${sizes.temp} font-light ${weatherUiService.getTempColorClass(current.temperature)}`}
            style="view-transition-name: temp-value"
          >
            {weatherUiService.formatTemp(current.temperature)}
          </span>
        </div>

        <dl class={`mb-8 flex flex-wrap justify-center gap-6 text-zinc-500 dark:text-zinc-400 ${sizes.stats}`}>
          <div class="flex items-center gap-2">
            <dt class="sr-only">Humidity</dt>
            <i class="ti ti-droplet text-zinc-400 dark:text-zinc-600" aria-hidden="true" />
            <dd>{current.humidity ?? "-"}%</dd>
          </div>
          <div class="flex items-center gap-2">
            <dt class="sr-only">Wind</dt>
            <i class="ti ti-wind text-zinc-400 dark:text-zinc-600" aria-hidden="true" />
            <dd>{current.windSpeed} km/h</dd>
          </div>
          <div class="flex items-center gap-2">
            <dt class="sr-only">Cloud cover</dt>
            <i class="ti ti-cloud text-zinc-400 dark:text-zinc-600" aria-hidden="true" />
            <dd>{current.cloudCover}%</dd>
          </div>
          <div class="flex items-center gap-2">
            <dt class="sr-only">Precipitation</dt>
            <i class="ti ti-umbrella text-zinc-400 dark:text-zinc-600" aria-hidden="true" />
            <dd>{current.precipitation} mm</dd>
          </div>
        </dl>

        {hourly.length > 0 && (
          <div class={`flex max-w-full justify-center ${sizes.hourGap}`} role="list" aria-label="Upcoming weather">
            {hourly.slice(0, 7).map((hour) => (
              <div class="flex min-w-0 flex-col items-center gap-1" role="listitem">
                <span class={`${sizes.hour} text-zinc-400 dark:text-zinc-600`}>{formatHour(hour.timestamp)}</span>
                <div class="flex items-center gap-1">
                  <i
                    class={`ti ti-${weatherUiService.getTablerIcon(hour.icon)} ${sizes.hourIcon} ${weatherUiService.getTempColorClass(
                      hour.temperature,
                    )}`}
                    aria-hidden="true"
                  />
                  <span class={`${sizes.hourTemp} font-medium ${weatherUiService.getTempColorClass(hour.temperature)}`}>
                    {weatherUiService.formatTemp(hour.temperature)}
                  </span>
                </div>
                {hour.precipitationProbability != null && hour.precipitationProbability > 0 ? (
                  <span class={`${sizes.hour} text-blue-400`}>
                    <i class="ti ti-droplet" aria-hidden="true" /> {hour.precipitationProbability}%
                  </span>
                ) : (
                  <span class={`${sizes.hour} text-transparent`} aria-hidden="true">
                    -
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <time class="absolute right-4 top-4 text-xs text-zinc-400 dark:text-zinc-600" dateTime={props.now}>
        {formatTime(props.now)}
      </time>
    </main>
  );
}

const detailZoomClasses = {
  1: {
    temp: "text-5xl",
    icon: "text-4xl",
    location: "text-lg",
    time: "text-xs",
    stats: "text-sm",
    statsGap: "gap-6",
    hourly: "sm" as const,
    daily: "sm" as const,
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
    hourly: "md" as const,
    daily: "sm" as const,
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
    daily: "md" as const,
    radar: "lg" as const,
    padding: "p-6",
    cardPadding: "p-6",
    gap: "gap-6",
    header: "text-xs",
    conditions: "text-lg",
  },
};

const displayCard = (padding: string) => `paper ${padding}`;

export function DetailDisplayView(props: DisplayProps) {
  const { current, hourly, daily } = props.data;
  const sizes = detailZoomClasses[props.zoom];

  return (
    <main
      class="flex h-screen flex-col overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-white"
      {...refreshAttributes(props)}
    >
      <div class={`grid min-h-0 flex-1 grid-cols-2 ${sizes.gap} ${sizes.padding}`}>
        <div class={`flex min-h-0 flex-col ${sizes.gap}`}>
          <section class="flex flex-col items-center py-4 text-center" aria-label="Current weather">
            <div class="mb-4">
              <h1 class={`${sizes.location} font-medium`}>{props.location}</h1>
              <p class={`${sizes.time} text-zinc-400 dark:text-zinc-500`}>
                {props.state ? `${props.state} · ` : ""}
                <time dateTime={props.now}>{formatTime(props.now)}</time>
              </p>
            </div>
            <div class="mb-4 flex items-center gap-6">
              <i
                class={`ti ti-${weatherUiService.getTablerIcon(current.icon)} ${sizes.icon} ${weatherUiService.getTempColorClass(
                  current.temperature,
                )}`}
                aria-hidden="true"
                style="view-transition-name: weather-icon"
              />
              <span
                class={`${sizes.temp} font-light ${weatherUiService.getTempColorClass(current.temperature)}`}
                style="view-transition-name: temp-value"
              >
                {weatherUiService.formatTemp(current.temperature)}
              </span>
            </div>
            <dl class={`flex ${sizes.statsGap} ${sizes.stats} text-zinc-500 dark:text-zinc-400`}>
              <div class="flex items-center gap-2">
                <dt class="sr-only">Humidity</dt>
                <i class="ti ti-droplet text-zinc-400 dark:text-zinc-600" aria-hidden="true" />
                <dd>{current.humidity ?? "-"}%</dd>
              </div>
              <div class="flex items-center gap-2">
                <dt class="sr-only">Wind</dt>
                <i class="ti ti-wind text-zinc-400 dark:text-zinc-600" aria-hidden="true" />
                <dd>{current.windSpeed} km/h</dd>
              </div>
              <div class="flex items-center gap-2">
                <dt class="sr-only">Cloud cover</dt>
                <i class="ti ti-cloud text-zinc-400 dark:text-zinc-600" aria-hidden="true" />
                <dd>{current.cloudCover}%</dd>
              </div>
              <div class="flex items-center gap-2">
                <dt class="sr-only">Precipitation</dt>
                <i class="ti ti-umbrella text-zinc-400 dark:text-zinc-600" aria-hidden="true" />
                <dd>{current.precipitation} mm</dd>
              </div>
            </dl>
          </section>

          {hourly.length > 0 && (
            <section class={displayCard(sizes.cardPadding)} aria-label="Hourly forecast">
              <h2 class={`${sizes.header} mb-3 font-medium uppercase text-zinc-500 dark:text-zinc-400`}>Hourly</h2>
              <HourlyForecast hourly={hourly} limit={8} size={sizes.hourly} showNow />
            </section>
          )}

          {daily.length > 0 && (
            <section class={`${displayCard(sizes.cardPadding)} flex flex-1 flex-col`} aria-label="7-day forecast">
              <h2 class={`${sizes.header} mb-3 font-medium uppercase text-zinc-500 dark:text-zinc-400`}>7-Day Forecast</h2>
              <div class="flex-1">
                <DailyForecast daily={daily} size={sizes.daily} />
              </div>
            </section>
          )}
        </div>

        <div class={`flex min-h-0 flex-col ${sizes.gap}`}>
          <section class={`${displayCard(sizes.cardPadding)} flex min-h-0 flex-1 flex-col`} aria-label="Rain radar">
            <h2 class={`${sizes.header} mb-3 font-medium uppercase text-zinc-500 dark:text-zinc-400`}>Rain Radar</h2>
            <div class="min-h-0 flex-1 overflow-hidden">
              <RadarCard size={sizes.radar} showLegend maxHeight="max-h-[52vh]" />
            </div>
          </section>

          <section class={displayCard(sizes.cardPadding)} aria-label="Current conditions">
            <h2 class={`${sizes.header} mb-3 font-medium uppercase text-zinc-500 dark:text-zinc-400`}>Current Conditions</h2>
            <dl class={`grid grid-cols-4 gap-4 ${sizes.conditions}`}>
              <div>
                <dt class="text-dimmed">Pressure</dt>
                <dd class="font-medium text-zinc-700 dark:text-zinc-300">{current.pressure != null ? `${current.pressure} hPa` : "-"}</dd>
              </div>
              <div>
                <dt class="text-dimmed">Dew Point</dt>
                <dd class="font-medium text-zinc-700 dark:text-zinc-300">{current.dewPoint != null ? `${current.dewPoint}°` : "-"}</dd>
              </div>
              <div>
                <dt class="text-dimmed">Visibility</dt>
                <dd class="font-medium text-zinc-700 dark:text-zinc-300">
                  {current.visibility != null ? `${(current.visibility / 1000).toFixed(1)} km` : "-"}
                </dd>
              </div>
              <div>
                <dt class="text-dimmed">Sunshine</dt>
                <dd class="font-medium text-zinc-700 dark:text-zinc-300">{current.sunshine != null ? `${current.sunshine} min` : "-"}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </main>
  );
}

export function DisplayUnavailable(props: { message: string; refreshSeconds: number; refreshedAt: string | null; retrying: boolean }) {
  return (
    <main
      class="flex min-h-screen items-center justify-center bg-white p-6 text-zinc-900 dark:bg-zinc-950 dark:text-white"
      {...refreshAttributes(props)}
    >
      <div class="max-w-md text-center" role="status">
        <i class="ti ti-cloud-off mb-3 block text-4xl text-zinc-300 dark:text-zinc-700" aria-hidden="true" />
        <h1 class="text-lg font-semibold">Weather data unavailable</h1>
        <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{props.message}</p>
        {props.retrying && <p class="mt-3 text-xs text-zinc-400 dark:text-zinc-600">Updates will resume automatically.</p>}
      </div>
    </main>
  );
}
