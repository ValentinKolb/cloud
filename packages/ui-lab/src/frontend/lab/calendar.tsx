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

const allDayStressEvents: CalendarEvent[] = [
  ...events,
  {
    id: "migration-window",
    title: "Migration window",
    start: "2026-05-25 00:00:00",
    end: "2026-05-28 00:00:00",
    allDay: true,
    color: "violet",
    calendarName: "Infra",
  },
  {
    id: "legal-review",
    title: "Legal review due",
    start: "2026-05-27 00:00:00",
    end: "2026-05-28 00:00:00",
    allDay: true,
    color: "amber",
  },
  {
    id: "backup-audit",
    title: "Backup audit",
    start: "2026-05-27 00:00:00",
    end: "2026-05-28 00:00:00",
    allDay: true,
    color: "zinc",
  },
  {
    id: "release-freeze",
    title: "Release freeze",
    start: "2026-05-27 00:00:00",
    end: "2026-05-30 00:00:00",
    allDay: true,
    color: "red",
  },
];

const overlapEvents: CalendarEvent[] = [
  {
    id: "design-a",
    title: "Design review A",
    start: "2026-05-27 09:00:00",
    end: "2026-05-27 11:00:00",
    color: "blue",
  },
  {
    id: "design-b",
    title: "Design review B",
    start: "2026-05-27 09:30:00",
    end: "2026-05-27 10:30:00",
    color: "emerald",
  },
  {
    id: "design-c",
    title: "Incident retro",
    start: "2026-05-27 10:00:00",
    end: "2026-05-27 12:30:00",
    color: "violet",
  },
  {
    id: "design-d",
    title: "Partner call",
    start: "2026-05-27 11:00:00",
    end: "2026-05-27 12:00:00",
    color: "amber",
  },
  {
    id: "overnight",
    title: "Overnight deploy",
    start: "2026-05-27 22:00:00",
    end: "2026-05-28 02:00:00",
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

export const CalendarAllDayStressDemo = () => (
  <DemoCard
    id="calendar-all-day-stress"
    chip={{ kind: "component", name: "Calendar", from: FROM_UI }}
    variant="sticky all-day row"
    description="All-day and multi-day items render in a capped row above the timed grid. The row can scroll independently while the hour grid keeps its own scroll position."
    code={`<Calendar
  view="week"
  date="2026-05-27"
  events={allDayStressEvents}
  allDayMaxHeightRem={5}
  startHour={8}
  endHour={18}
/>`}
  >
    <Calendar
      view="week"
      date={baseDate}
      events={allDayStressEvents}
      allDayMaxHeightRem={5}
      startHour={8}
      endHour={18}
      getDateHref={hrefForDate}
    />
  </DemoCard>
);

export const CalendarOverlapDemo = () => {
  const [demoEvents, setDemoEvents] = createSignal<CalendarEvent[]>(overlapEvents);
  const [selectedEventTitle, setSelectedEventTitle] = createSignal("None");
  const [editorEventTitle, setEditorEventTitle] = createSignal("None");
  const [selectedSlotLabel, setSelectedSlotLabel] = createSignal("None");
  const updateEventTime = (event: CalendarEvent, next: { start: Date; end: Date; allDay?: boolean }) => {
    setDemoEvents((current) =>
      current.map((candidate) =>
        candidate.id === event.id
          ? {
              ...candidate,
              start: next.start,
              end: next.end,
              allDay: next.allDay ?? candidate.allDay,
            }
          : candidate,
      ),
    );
  };

  return (
    <DemoCard
      id="calendar-overlap-interactions"
      chip={{ kind: "component", name: "Calendar", from: FROM_UI }}
      variant="overlap lanes, drag and resize"
      description="Timed overlaps are assigned to stable lanes. Drag/drop and resize callbacks update the same controlled event array, so app code can persist changes through its own mutation layer."
      code={`const [events, setEvents] = createSignal(overlapEvents);

<Calendar
  view="week"
  date="2026-05-27"
  events={events()}
  visibleStartHour={6}
  visibleEndHour={22}
  onEventClick={(event) => selectEvent(event)}
  onEventDoubleClick={(event) => openEditor(event)}
  onSlotClick={(slot) => selectSlot(slot)}
  onEventDrop={(event, next) => updateEvent(event, next)}
  onEventResize={(event, next) => updateEvent(event, next)}
/>`}
    >
      <Calendar
        view="week"
        date={baseDate}
        events={demoEvents()}
        visibleStartHour={6}
        visibleEndHour={22}
        startHour={8}
        endHour={18}
        getDateHref={hrefForDate}
        onEventClick={(event) => setSelectedEventTitle(event.title)}
        onEventDoubleClick={(event) => setEditorEventTitle(event.title)}
        onSlotClick={(slot) => setSelectedSlotLabel(`${slot.start.toLocaleDateString("en")} ${slot.start.toLocaleTimeString("en")}`)}
        onEventDrop={updateEventTime}
        onEventResize={updateEventTime}
      />
      <div class="grid gap-1 border-t border-zinc-100 px-3 py-2 text-xs text-dimmed dark:border-zinc-800/70 sm:grid-cols-3">
        <div>
          Click event: <span class="font-semibold text-primary">{selectedEventTitle()}</span>
        </div>
        <div>
          Double-click event: <span class="font-semibold text-primary">{editorEventTitle()}</span>
        </div>
        <div>
          Click slot: <span class="font-semibold text-primary">{selectedSlotLabel()}</span>
        </div>
      </div>
    </DemoCard>
  );
};

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
