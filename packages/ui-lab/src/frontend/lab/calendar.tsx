import { Calendar, type CalendarEvent } from "@valentinkolb/cloud/ui";
import { createSignal } from "solid-js";
import DemoCard from "./DemoCard";

const FROM_UI = "@valentinkolb/cloud/ui";

const baseDate = new Date(2026, 4, 27);

const events: CalendarEvent[] = [
  {
    id: "all-day",
    title: "Cloud platform planning",
    start: "2026-05-27 00:00:00",
    end: "2026-05-27 23:59:59",
    allDay: true,
    color: "red",
    href: "/app/spaces/calendar/planning",
    calendarName: "Platform",
  },
  {
    id: "standup",
    title: "Morning standup",
    start: "2026-05-27 09:00:00",
    end: "2026-05-27 09:30:00",
    color: "blue",
    location: "Huddle room",
    attendees: [{ name: "Core" }, { name: "Gateway" }],
  },
  {
    id: "team",
    title: "Team meeting",
    start: "2026-05-27 10:00:00",
    end: "2026-05-27 11:30:00",
    color: "emerald",
    location: "Meet",
    resources: [{ name: "Conference room", kind: "room" }],
    recurrence: { rrule: "FREQ=WEEKLY;BYDAY=WE" },
  },
  {
    id: "interview",
    title: "Candidate interview",
    start: "2026-05-27 10:30:00",
    end: "2026-05-27 12:00:00",
    color: "violet",
    location: "Room 2",
  },
  {
    id: "lunch",
    title: "Lunch break",
    start: "2026-05-27 12:00:00",
    end: "2026-05-27 13:00:00",
    color: "amber",
  },
  {
    id: "review",
    title: "Code review",
    start: "2026-05-28 14:00:00",
    end: "2026-05-28 15:00:00",
    color: "cyan",
  },
  {
    id: "travel",
    title: "Munich onsite",
    start: "2026-05-29 00:00:00",
    end: "2026-05-29 23:59:59",
    allDay: true,
    color: "zinc",
    display: "background",
  },
  {
    id: "release",
    title: "Release window",
    start: "2026-05-30 16:00:00",
    end: "2026-05-30 18:00:00",
    color: "red",
  },
];

const hrefForDate = (date: Date, view: string) => {
  const key = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
  return `/app/ui-lab/surfaces/calendar?view=${view}&date=${key}`;
};

type InteractiveCalendarView = "day" | "week" | "month" | "year";

const viewFromUrl = (): InteractiveCalendarView => {
  if (typeof window === "undefined") return "week";
  const view = new URL(window.location.href).searchParams.get("view");
  return view === "day" || view === "week" || view === "month" || view === "year" ? view : "week";
};

const dateFromUrl = () => {
  if (typeof window === "undefined") return baseDate;
  const date = new URL(window.location.href).searchParams.get("date");
  if (!date) return baseDate;
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? baseDate : parsed;
};

export const CalendarScheduleDemo = () => {
  const [view, setView] = createSignal<"day" | "week" | "month" | "year">(viewFromUrl());
  const [date, setDate] = createSignal(dateFromUrl());
  const pushState = (nextView: string, nextDate: Date) => {
    const href = hrefForDate(nextDate, nextView);
    window.history.pushState(null, "", href);
  };

  return (
    <DemoCard
      id="calendar-schedule"
      chip={{ kind: "component", name: "Calendar", from: FROM_UI }}
      variant="schedule shell, controlled view/date"
      description="Unified calendar surface for app calendars: day/week/month/year views, all-day rows, timed events, overlapping lanes, real hrefs, and event metadata for attendees, resources, recurrence, and calendar names."
      code={`<Calendar
  view={view()}
  date={new Date(2026, 4, 27)}
  events={events}
  startHour={8}
  endHour={18}
  withWeekNumbers
  getDateHref={(date, view) => buildCalendarHref(date, view)}
  getViewHref={(view) => \`?view=\${view}\`}
  onViewChange={(view) => setView(view)}
  onDateChange={(date) => setDate(date)}
/>`}
    >
      <Calendar
        view={view()}
        date={date()}
        events={events}
        startHour={8}
        endHour={18}
        withWeekNumbers
        getDateHref={hrefForDate}
        getViewHref={(nextView) => `/app/ui-lab/surfaces/calendar?view=${nextView}`}
        onViewChange={(nextView) => {
          const normalized = nextView === "mobile-month" ? "month" : nextView;
          setView(normalized);
          pushState(normalized, date());
        }}
        onDateChange={(nextDate, currentView) => {
          setDate(nextDate);
          pushState(currentView, nextDate);
        }}
      />
    </DemoCard>
  );
};

export const CalendarMonthDemo = () => (
  <DemoCard
    id="calendar-month"
    chip={{ kind: "component", name: "Calendar", from: FROM_UI }}
    variant="month and mobile density"
    description="Month view keeps the current Spaces behavior: compact badges on desktop, dot indicators on narrow containers, week numbers, outside days, and date links for drill-down."
    code={`<Calendar
  view="month"
  date="2026-05-27"
  events={events}
  withWeekNumbers
  getDateHref={(date) => buildDayHref(date)}
/>`}
  >
    <Calendar view="month" date={baseDate} events={events} withWeekNumbers getDateHref={hrefForDate} />
  </DemoCard>
);

export const CalendarDayDemo = () => (
  <DemoCard
    id="calendar-day"
    chip={{ kind: "component", name: "Calendar", from: FROM_UI }}
    variant="day agenda"
    description="Day view focuses the same timed-event model into one column. This is the base surface for calendar-detail work such as full-day planning, room views, and person-specific schedules."
    code={`<Calendar
  view="day"
  date="2026-05-27"
  events={events}
  startHour={8}
  endHour={18}
  getDateHref={(date) => buildDayHref(date)}
/>`}
  >
    <Calendar view="day" date={baseDate} events={events} startHour={8} endHour={18} getDateHref={hrefForDate} />
  </DemoCard>
);

export const CalendarYearDemo = () => (
  <DemoCard
    id="calendar-year"
    chip={{ kind: "component", name: "Calendar", from: FROM_UI }}
    variant="year overview"
    description="Year view gives a fast availability map across all months. It is intentionally compact and SSR-safe: day cells are normal links and colored dots summarize events."
    code={`<Calendar
  view="year"
  date="2026-05-27"
  events={events}
  getDateHref={(date) => buildDayHref(date)}
/>`}
  >
    <Calendar view="year" date={baseDate} events={events} getDateHref={hrefForDate} />
  </DemoCard>
);

export const CalendarMobileDemo = () => (
  <DemoCard
    id="calendar-mobile-month"
    chip={{ kind: "component", name: "Calendar", from: FROM_UI }}
    variant="mobile month agenda"
    description="Mobile-month mode mirrors native calendar apps: dense month grid first, selected-day agenda below, and no island required for the initial SSR render."
    code={`<Calendar
  view="mobile-month"
  date="2026-05-27"
  selectedDate="2026-05-27"
  events={events}
/>`}
  >
    <Calendar view="mobile-month" date={baseDate} selectedDate={baseDate} events={events} getDateHref={hrefForDate} />
  </DemoCard>
);
