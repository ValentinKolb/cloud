import { weatherService, type DailyForecast as DailyForecastType } from "../../service";

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
  daily: DailyForecastType[];
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Show temperature bar visualization (default: true) */
  showBar?: boolean;
};

const sizeClasses = {
  sm: {
    day: "text-xs w-16",
    icon: "text-base",
    temp: "text-xs w-6",
    rain: "text-[10px]",
    rainIcon: "text-[8px]",
    sun: "text-[10px]",
    sunIcon: "text-[8px]",
    meta: "w-20",
    py: "py-2",
  },
  md: {
    day: "text-sm w-20",
    icon: "text-xl",
    temp: "text-sm w-8",
    rain: "text-xs",
    rainIcon: "text-[10px]",
    sun: "text-xs",
    sunIcon: "text-[10px]",
    meta: "w-24",
    py: "py-3",
  },
  lg: {
    day: "text-lg w-28",
    icon: "text-3xl",
    temp: "text-lg w-12",
    rain: "text-base",
    rainIcon: "text-sm",
    sun: "text-base",
    sunIcon: "text-sm",
    meta: "w-32",
    py: "py-5",
  },
};

export default function DailyForecast({ daily, size = "md", showBar = true }: DailyForecastProps) {
  const s = sizeClasses[size];

  if (daily.length === 0) return null;

  return (
    <div class="flex flex-col justify-between h-full" role="list">
      {daily.map((d) => (
        <div class="flex items-center gap-4" role="listitem">
          <span class={`${s.day} font-medium`}>{formatDay(d.date)}</span>
          <i
            class={`ti ti-${weatherService.ui.getTablerIcon(d.icon)} ${
              s.icon
            } ${weatherService.ui.getAvgTempColorClass(d.tempMin, d.tempMax)}`}
            aria-hidden="true"
          />
          <div class="flex-1 flex items-center gap-2">
            <span class={`${s.temp} text-dimmed text-right`}>{weatherService.ui.formatTemp(d.tempMin)}</span>
            {showBar && (
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
            )}
            <span class={`${s.temp} font-medium ${weatherService.ui.getTempColorClass(d.tempMax)}`}>
              {weatherService.ui.formatTemp(d.tempMax)}
            </span>
          </div>
          <div class={`flex items-center gap-3 ${s.meta} justify-end`}>
            {d.precipitationProbability != null && d.precipitationProbability > 0 && (
              <span class={`${s.rain} text-blue-500`}>
                <i class={`ti ti-droplet ${s.rainIcon}`} aria-hidden="true" /> {d.precipitationProbability}%
              </span>
            )}
            {d.sunshine > 0 && (
              <span class={`${s.sun} text-amber-500`}>
                <i class={`ti ti-sun ${s.sunIcon}`} aria-hidden="true" /> {Math.round(d.sunshine / 60)}h
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
