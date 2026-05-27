import dayjs from "dayjs";
import { dates as calendar } from "@valentinkolb/stdlib";
import CalendarHeader from "./CalendarHeader.island";
import CalendarDetailNavigation from "./CalendarDetailNavigation.island";
import MonthView from "./MonthView";
import WeekView from "./WeekView";
import type { CalendarProps } from "./types";

/**
 * Main calendar component.
 * SSR-first with islands for interactivity.
 */
export default function Calendar(props: CalendarProps) {
  const year = dayjs(props.date).year();
  const month = dayjs(props.date).month();
  const weekStart = calendar.startOfWeek(props.date);
  const rootId = `space-calendar-${props.spaceId}`;

  return (
    <div id={rootId} class="flex flex-col gap-2">
      <CalendarDetailNavigation rootId={rootId} />
      {/* Header with navigation - outside paper */}
      <CalendarHeader view={props.view} date={props.date} baseUrl={props.baseUrl} />

      {/* Calendar View */}
      <div class="overflow-hidden">
        {props.view === "month" ? (
          <MonthView
            year={year}
            month={month}
            items={props.items}
            currentDate={props.date}
            currentView={props.view}
            baseUrl={props.baseUrl}
            weather={props.weather}
          />
        ) : (
          <WeekView
            spaceId={props.spaceId}
            weekStart={weekStart}
            items={props.items}
            currentView={props.view}
            currentDate={props.date}
            baseUrl={props.baseUrl}
            weather={props.weather}
          />
        )}
      </div>
    </div>
  );
}
