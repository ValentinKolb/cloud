import { weatherUiService } from "@valentinkolb/cloud/services/weather/ui";
import type { DailyForecastPayload } from "../../contracts";

const formatDay = (dateStr: string): string => {
  const date = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";

  return date.toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
};

type DailyForecastProps = {
  daily: DailyForecastPayload[];
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Show temperature bar visualization (default: true) */
  showBar?: boolean;
};

const sizeClasses = {
  sm: {
    day: "text-xs",
    icon: "text-base",
    temp: "text-xs",
    rain: "text-[10px]",
    rainIcon: "text-[8px]",
    sun: "text-[10px]",
    sunIcon: "text-[8px]",
    meta: "min-w-[4.5rem]",
    gap: "gap-2",
    py: "py-1.5",
  },
  md: {
    day: "text-sm",
    icon: "text-xl",
    temp: "text-sm",
    rain: "text-xs",
    rainIcon: "text-[10px]",
    sun: "text-xs",
    sunIcon: "text-[10px]",
    meta: "min-w-[5rem]",
    gap: "gap-2.5",
    py: "py-2",
  },
  lg: {
    day: "text-lg",
    icon: "text-3xl",
    temp: "text-lg",
    rain: "text-base",
    rainIcon: "text-sm",
    sun: "text-base",
    sunIcon: "text-sm",
    meta: "min-w-[6.5rem]",
    gap: "gap-3",
    py: "py-3",
  },
};

export default function DailyForecast({ daily, size = "md", showBar = true }: DailyForecastProps) {
  const s = sizeClasses[size];

  if (daily.length === 0) return null;

  return (
    <div class="flex min-w-0 flex-col gap-1" role="list">
      {daily.map((d) => (
        <div
          class={`grid min-w-0 grid-cols-[minmax(4.75rem,6.5rem)_1.75rem_minmax(0,1fr)_auto] items-center ${s.gap} ${s.py}`}
          role="listitem"
        >
          <span class={`${s.day} truncate font-medium`}>{formatDay(d.date)}</span>
          <i
            class={`ti ti-${weatherUiService.getTablerIcon(d.icon)} ${
              s.icon
            } ${weatherUiService.getAvgTempColorClass(d.tempMin, d.tempMax)}`}
            aria-hidden="true"
          />
          <div class="flex min-w-0 items-center gap-2">
            <span class={`${s.temp} w-8 shrink-0 text-right text-dimmed`}>{weatherUiService.formatTemp(d.tempMin)}</span>
            {showBar && (
              <div
                class="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
                role="img"
                aria-label={`Temperature range from ${weatherUiService.formatTemp(d.tempMin)} to ${weatherUiService.formatTemp(d.tempMax)}`}
              >
                <div
                  class="h-full bg-linear-to-r from-blue-400 via-emerald-400 to-amber-400 rounded-full"
                  style={`width: ${Math.min(100, Math.max(20, ((d.tempMax - d.tempMin) / 30) * 100))}%; margin-left: ${Math.max(
                    0,
                    ((d.tempMin + 10) / 50) * 100,
                  )}%`}
                />
              </div>
            )}
            <span class={`${s.temp} w-8 shrink-0 font-medium ${weatherUiService.getTempColorClass(d.tempMax)}`}>
              {weatherUiService.formatTemp(d.tempMax)}
            </span>
          </div>
          <div class={`flex items-center justify-end gap-2 ${s.meta}`}>
            {d.precipitationProbability != null && d.precipitationProbability > 0 && (
              <span class={`${s.rain} whitespace-nowrap text-blue-500`}>
                <i class={`ti ti-droplet ${s.rainIcon}`} aria-hidden="true" /> {d.precipitationProbability}%
              </span>
            )}
            {d.sunshine > 0 && (
              <span class={`${s.sun} whitespace-nowrap text-amber-500`}>
                <i class={`ti ti-sun ${s.sunIcon}`} aria-hidden="true" /> {Math.round(d.sunshine / 60)}h
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
