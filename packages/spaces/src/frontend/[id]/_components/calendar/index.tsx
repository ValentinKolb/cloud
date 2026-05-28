import { type CalendarEvent, Calendar as CoreCalendar, type CalendarView as CoreCalendarView } from "@valentinkolb/cloud/ui";
import { dates as calendar } from "@valentinkolb/stdlib";
import type { CalendarItem } from "@/contracts";
import { requestSpacesRouteNavigation } from "../workspace/workspace-events";
import CalendarDetailNavigation from "./CalendarDetailNavigation";
import type { CalendarProps, CalendarView } from "./types";

const eventStart = (item: CalendarItem) => item.startsAt ?? item.deadline ?? calendar.today().toISOString();
const eventEnd = (item: CalendarItem) => item.endsAt ?? item.deadline ?? eventStart(item);

const buildCalendarHref = (baseUrl: string, view: CalendarView, date: Date, item?: string) => {
  const url = new URL(baseUrl, "http://spaces.local");
  url.searchParams.set("view", "calendar");
  url.searchParams.set("cv", view);
  url.searchParams.set("cd", calendar.formatDateKey(date));
  if (item) url.searchParams.set("item", item);
  else url.searchParams.delete("item");
  return `${url.pathname}?${url.searchParams.toString()}`;
};

const priorityColor = (item: CalendarItem) => {
  if (!item.deadline || item.startsAt) return undefined;
  if (item.priority === "urgent" || item.priority === "high") return "red";
  return "amber";
};

const toCalendarEvent = (item: CalendarItem, baseUrl: string, view: CalendarView, date: Date): CalendarEvent => {
  const isDeadline = Boolean(item.deadline && !item.startsAt);
  return {
    id: item.id,
    title: item.title,
    start: eventStart(item),
    end: eventEnd(item),
    allDay: false,
    color: priorityColor(item),
    colorHex: isDeadline ? undefined : item.spaceColor,
    href: buildCalendarHref(baseUrl, view, date, item.id),
    dataSpaceItemId: item.id,
    calendarName: item.spaceName,
    meta: isDeadline ? "Deadline" : item.spaceName,
  };
};

export default function Calendar(props: CalendarProps) {
  const rootId = `space-calendar-${props.spaceId}`;
  const events = () => props.items.map((item) => toCalendarEvent(item, props.baseUrl, props.view, props.date));
  const dayBadges = () =>
    Object.fromEntries(
      Object.entries(props.weather ?? {}).map(([date, weather]) => [
        date,
        {
          icon: weather.icon,
          label: `${Math.round(weather.tempMax)}°`,
        },
      ]),
    );
  const routeTo = (view: CalendarView, date: Date, replace = false) => {
    requestSpacesRouteNavigation(buildCalendarHref(props.baseUrl, view, date), { replace, scroll: "preserve" });
  };

  return (
    <div id={rootId} class="flex flex-col gap-2">
      <CalendarDetailNavigation rootId={rootId} />
      <CoreCalendar
        view={props.view}
        date={props.date}
        events={events()}
        startHour={8}
        endHour={20}
        withWeekNumbers
        dayBadges={dayBadges()}
        getViewHref={(view) => buildCalendarHref(props.baseUrl, view as CalendarView, props.date)}
        getDateHref={(date, view) => buildCalendarHref(props.baseUrl, view as CalendarView, date)}
        getEventHref={(event) => event.href}
        onViewChange={(view: CoreCalendarView) => routeTo(view as CalendarView, props.date)}
        onDateChange={(date, view) => routeTo(view as CalendarView, date)}
      />
    </div>
  );
}
