import { For } from "solid-js";
import { dates as calendar } from "@valentinkolb/stdlib";
import CalendarItemDisplay from "./CalendarItem";
import CalendarCell from "./CalendarCell";
import type { MonthViewProps } from "./types";
import { formatTemp, getAvgTempColorClass, getTempColorClass } from "./weather-ui";
import { requestSpacesRouteNavigation } from "../workspace/workspace-events";

const MAX_VISIBLE_ITEMS = 2;

export default function MonthView(props: MonthViewProps) {
  const weeks = calendar.getMonthGrid(props.year, props.month);
  const rowCount = weeks.length;

  return (
    <div class="flex flex-col">
      {/* Weekday Header */}
      <div class="grid grid-cols-7" role="row">
        <For each={calendar.weekdays()}>
          {(day) => (
            <div class="py-1.5 text-center text-xs text-dimmed" role="columnheader">
              {day}
            </div>
          )}
        </For>
      </div>

      {/* Calendar Grid - fixed height per row (90px) */}
      <div
        class="grid divide-y divide-zinc-200 dark:divide-zinc-700 md:divide-y-0"
        style={{
          "grid-template-rows": `repeat(${rowCount}, 90px)`,
        }}
        role="grid"
      >
        <For each={weeks}>
          {(week) => (
            <div class="grid grid-cols-7 min-h-0 overflow-hidden divide-x divide-zinc-200 dark:divide-zinc-700 md:divide-x-0" role="row">
              <For each={week}>
                {(date) => {
                  const dayItems = calendar.getDayItems(props.items, date);
                  const todayDate = calendar.isToday(date);
                  const currentMonth = calendar.isSameMonth(date, props.currentDate);
                  const visibleItems = dayItems.slice(0, MAX_VISIBLE_ITEMS);
                  const hiddenCount = Math.max(0, dayItems.length - MAX_VISIBLE_ITEMS);
                  const dateKey = calendar.formatDateKey(date);
                  const dayWeather = props.weather?.[dateKey];

                  return (
                    <CalendarCell date={date} items={dayItems} isToday={todayDate} isCurrentMonth={currentMonth} baseUrl={props.baseUrl}>
                      {/* Day Number + Weather (Desktop) */}
                      <div class="flex items-center justify-between px-1.5 py-1">
                        <div class="flex items-center gap-1">
                          <span
                            class={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs ${
                              todayDate ? "bg-blue-500 text-white font-medium" : currentMonth ? "text-primary" : "text-dimmed"
                            }`}
                          >
                            {calendar.formatDayNumber(date)}
                          </span>
                          {/* Desktop: Weather chip */}
                          {dayWeather && (
                            <span class="hidden md:inline-flex items-center gap-0.5 text-[10px]">
                              <i class={`ti ti-${dayWeather.icon} ${getAvgTempColorClass(dayWeather.tempMin, dayWeather.tempMax)}`} />
                              <span class={getTempColorClass(dayWeather.tempMax)}>{formatTemp(dayWeather.tempMax)}</span>
                            </span>
                          )}
                        </div>
                        {/* Mobile: Item count */}
                        {dayItems.length > 0 && <span class="md:hidden text-[10px] text-dimmed">{dayItems.length}</span>}
                      </div>

                      {/* Mobile: Dot indicators */}
                      <div class="md:hidden flex gap-0.5 px-1.5 pb-1">
                        <For each={dayItems.slice(0, 4)}>
                          {(item) => (
                            <CalendarItemDisplay
                              item={item}
                              variant="dot"
                              baseUrl={props.baseUrl}
                              currentView={props.currentView}
                              currentDate={props.currentDate}
                            />
                          )}
                        </For>
                        {dayItems.length > 4 && <span class="text-[10px] text-dimmed">+</span>}
                      </div>

                      {/* Desktop: Item list (max 2, then +N more) */}
                      <div class="hidden md:flex flex-col gap-px px-1 pb-1 overflow-hidden">
                        <For each={visibleItems}>
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
                        {hiddenCount > 0 && (
                          <a
                            href={calendar.buildCalendarUrl(props.baseUrl, {
                              view: "week",
                              date,
                            })}
                            onClick={(event) => {
                              if (
                                event.defaultPrevented ||
                                event.button !== 0 ||
                                event.metaKey ||
                                event.ctrlKey ||
                                event.shiftKey ||
                                event.altKey
                              ) {
                                return;
                              }
                              event.preventDefault();
                              requestSpacesRouteNavigation(
                                calendar.buildCalendarUrl(props.baseUrl, {
                                  view: "week",
                                  date,
                                }),
                              );
                            }}
                            class="relative z-20 text-[10px] text-dimmed hover:text-blue-500 text-left px-1"
                          >
                            +{hiddenCount} more
                          </a>
                        )}
                      </div>
                    </CalendarCell>
                  );
                }}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
