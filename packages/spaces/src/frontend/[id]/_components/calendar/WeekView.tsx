import { For } from "solid-js";
import { dates as calendar } from "@valentinkolb/stdlib";
import CalendarItemDisplay from "./CalendarItem";
import type { WeekViewProps } from "./types";
import { formatTemp, getAvgTempColorClass, getTempColorClass } from "./weather-ui";

export default function WeekView(props: WeekViewProps) {
  const days = calendar.getWeekDays(props.weekStart);

  // Check if any day in the week has weather data
  const hasAnyWeather = days.some((date) => {
    const dateKey = calendar.formatDateKey(date);
    return props.weather?.[dateKey] !== undefined;
  });

  return (
    <div class="flex flex-col">
      {/* Desktop: Horizontal grid */}
      <div class="hidden md:grid md:grid-cols-7 md:min-h-120" role="grid">
        <For each={days}>
          {(date) => {
            const dayItems = calendar.getDayItems(props.items, date);
            const todayDate = calendar.isToday(date);
            const dateKey = calendar.formatDateKey(date);
            const dayWeather = props.weather?.[dateKey];

            return (
              <div class="flex flex-col" role="gridcell">
                {/* Day Header */}
                <div class={`py-2 text-center ${todayDate ? "bg-blue-50/50 dark:bg-blue-900/10" : ""}`}>
                  <div class="text-xs text-dimmed">{calendar.formatWeekdayShort(date)}</div>
                  <div class={`text-lg font-medium ${todayDate ? "text-blue-500" : "text-primary"}`}>{calendar.formatDayNumber(date)}</div>
                  {/* Weather row - always reserve space if any day has weather */}
                  {hasAnyWeather && (
                    <div class="flex items-center justify-center gap-1 mt-0.5 h-4">
                      {dayWeather ? (
                        <>
                          <i class={`ti ti-${dayWeather.icon} text-xs ${getAvgTempColorClass(dayWeather.tempMin, dayWeather.tempMax)}`} />
                          <span class="text-[10px] text-dimmed">
                            {formatTemp(dayWeather.tempMax)} / {formatTemp(dayWeather.tempMin)}
                          </span>
                        </>
                      ) : (
                        <span class="text-[10px] text-dimmed">–</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Items */}
                <div
                  class="flex-1 p-1 overflow-y-auto flex flex-col gap-1"
                  data-scroll-preserve={`spaces-calendar-week-day-${props.spaceId}-${dateKey}`}
                >
                  {dayItems.length > 0 ? (
                    <For each={dayItems}>
                      {(item) => (
                        <CalendarItemDisplay
                          item={item}
                          variant="full"
                          baseUrl={props.baseUrl}
                          currentView={props.currentView}
                          currentDate={props.currentDate}
                        />
                      )}
                    </For>
                  ) : (
                    <div class="text-[10px] text-dimmed text-center py-4 opacity-50">-</div>
                  )}
                </div>
              </div>
            );
          }}
        </For>
      </div>

      {/* Mobile: Vertical stack */}
      <div class="md:hidden flex flex-col">
        <For each={days}>
          {(date) => {
            const dayItems = calendar.getDayItems(props.items, date);
            const todayDate = calendar.isToday(date);
            const dateKey = calendar.formatDateKey(date);
            const dayWeather = props.weather?.[dateKey];

            return (
              <div class={`flex items-start gap-3 px-3 py-2 ${todayDate ? "bg-blue-50/30 dark:bg-blue-900/10" : ""}`}>
                {/* Date column */}
                <div class="w-12 shrink-0 text-center">
                  <div class="text-[10px] text-dimmed uppercase">{calendar.formatWeekdayShort(date)}</div>
                  <div class={`text-lg font-medium ${todayDate ? "text-blue-500" : "text-primary"}`}>{calendar.formatDayNumber(date)}</div>
                  {/* Weather */}
                  {dayWeather && (
                    <div class="flex items-center justify-center gap-0.5 text-[10px]">
                      <i class={`ti ti-${dayWeather.icon} ${getAvgTempColorClass(dayWeather.tempMin, dayWeather.tempMax)}`} />
                      <span class={getTempColorClass(dayWeather.tempMax)}>{formatTemp(dayWeather.tempMax)}</span>
                    </div>
                  )}
                </div>

                {/* Items column */}
                <div class="flex-1 min-w-0 py-1">
                  {dayItems.length > 0 ? (
                    <div class="flex flex-col gap-1">
                      <For each={dayItems}>
                        {(item) => (
                          <CalendarItemDisplay
                            item={item}
                            variant="compact"
                            baseUrl={props.baseUrl}
                            currentView={props.currentView}
                            currentDate={props.currentDate}
                          />
                        )}
                      </For>
                    </div>
                  ) : (
                    <div class="text-xs text-dimmed">-</div>
                  )}
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
