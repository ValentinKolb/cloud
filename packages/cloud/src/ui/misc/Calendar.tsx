import { dates as calendar } from "@valentinkolb/stdlib";
import type { JSX } from "solid-js";
import { For, Show } from "solid-js";
import SegmentedControl from "../input/SegmentedControl";

export type CalendarView = "day" | "week" | "month" | "year" | "mobile-month";

export type CalendarEventColor = "blue" | "emerald" | "amber" | "red" | "violet" | "cyan" | "zinc";

export type CalendarEvent = {
  id: string;
  title: string;
  start: Date | string;
  end?: Date | string;
  allDay?: boolean;
  color?: CalendarEventColor;
  colorHex?: string;
  href?: string;
  dataSpaceItemId?: string;
  meta?: string;
  description?: string;
  display?: "event" | "background";
  location?: string;
  calendarName?: string;
  attendees?: CalendarAttendee[];
  resources?: CalendarResource[];
  recurrence?: CalendarRecurrence;
};

export type CalendarAttendee = {
  name: string;
  status?: "accepted" | "declined" | "tentative" | "needs-action";
};

export type CalendarResource = {
  name: string;
  kind?: "room" | "equipment" | "link" | "other";
};

export type CalendarRecurrence = {
  rrule: string;
  exdate?: Array<Date | string>;
  recurrenceId?: Date | string;
};

export type CalendarLabels = Partial<{
  today: string;
  day: string;
  week: string;
  month: string;
  year: string;
  allDay: string;
  noEvents: string;
  previous: string;
  next: string;
}>;

export type CalendarProps = {
  date: Date | string;
  events: CalendarEvent[];
  view?: CalendarView;
  labels?: CalendarLabels;
  firstDayOfWeek?: 0 | 1;
  withWeekNumbers?: boolean;
  startHour?: number;
  endHour?: number;
  selectedDate?: Date | string;
  dayBadges?: Record<string, CalendarDayBadge>;
  getViewHref?: (view: CalendarView) => string;
  getDateHref?: (date: Date, view: CalendarView) => string;
  getEventHref?: (event: CalendarEvent) => string | undefined;
  onViewChange?: (view: CalendarView) => void;
  onDateChange?: (date: Date, view: CalendarView) => void;
  class?: string;
};

export type CalendarDayBadge = {
  icon?: string;
  label: string;
};

type NormalizedEvent = CalendarEvent & {
  startDate: Date;
  endDate: Date;
  dayKey: string;
};

const labels: Required<CalendarLabels> = {
  today: "Today",
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
  allDay: "All day",
  noEvents: "No events",
  previous: "Previous",
  next: "Next",
};

const colorClass: Record<CalendarEventColor, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-200 dark:border-blue-500/30",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/30",
  amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30",
  red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/30",
  violet: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-200 dark:border-violet-500/30",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-200 dark:border-cyan-500/30",
  zinc: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-700",
};

const dotClass: Record<CalendarEventColor, string> = {
  blue: "bg-blue-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  violet: "bg-violet-500",
  cyan: "bg-cyan-500",
  zinc: "bg-zinc-400",
};

const yearIndicatorClass = (date: Date, color: CalendarEventColor): string => (calendar.isToday(date) ? "bg-white" : dotClass[color]);

const parseDate = (value: Date | string): Date => {
  if (value instanceof Date) return new Date(value);
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const [year, month = "1", day = "1"] = value.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day), 12);
};

const weekNumber = (date: Date): number => {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};

const formatTime = (date: Date): string => calendar.formatTime(date.toISOString());
const formatDay = (date: Date): string => date.toLocaleDateString("en", { weekday: "short", day: "numeric" });
const formatMonth = (date: Date): string => calendar.formatMonthYear(date);

const normalizeEvents = (events: CalendarEvent[]): NormalizedEvent[] =>
  events.map((event) => {
    const startDate = parseDate(event.start);
    const endDate = event.end ? parseDate(event.end) : new Date(startDate.getTime() + 60 * 60 * 1000);
    return { ...event, startDate, endDate, dayKey: calendar.formatDateKey(startDate) };
  });

const eventHref = (props: CalendarProps, event: CalendarEvent): string | undefined => props.getEventHref?.(event) ?? event.href;

const EventChip = (props: { event: NormalizedEvent; href?: string; compact?: boolean }): JSX.Element => {
  const color = () => props.event.color ?? "blue";
  const style = () => (props.event.colorHex ? { "border-color": props.event.colorHex } : undefined);
  const className = () =>
    `block min-w-0 rounded border px-1.5 py-1 text-left leading-tight ${props.event.display === "background" ? "opacity-60" : ""} ${props.event.colorHex ? "border-l-2 bg-zinc-50 text-primary dark:bg-zinc-900" : colorClass[color()]}`;
  const content = (
    <>
      <span class="block truncate text-[11px] font-semibold">{props.event.title}</span>
      <Show when={!props.event.allDay && !props.compact}>
        <span class="block truncate text-[10px] opacity-75">
          {formatTime(props.event.startDate)} - {formatTime(props.event.endDate)}
        </span>
      </Show>
      <Show when={props.event.location && !props.compact}>
        <span class="block truncate text-[10px] opacity-75">{props.event.location}</span>
      </Show>
    </>
  );

  return props.href ? (
    <a href={props.href} class={className()} data-space-item-id={props.event.dataSpaceItemId} style={style()}>
      {content}
    </a>
  ) : (
    <div class={className()} style={style()}>
      {content}
    </div>
  );
};

const CalendarHeader = (props: { date: Date; view: CalendarView; labels: Required<CalendarLabels>; owner: CalendarProps }): JSX.Element => {
  const previous = () => {
    if (props.view === "year") return new Date(props.date.getFullYear() - 1, 0, 1);
    if (props.view === "month" || props.view === "mobile-month") return new Date(props.date.getFullYear(), props.date.getMonth() - 1, 1);
    return calendar.addDays(props.date, props.view === "day" ? -1 : -7);
  };
  const next = () => {
    if (props.view === "year") return new Date(props.date.getFullYear() + 1, 0, 1);
    if (props.view === "month" || props.view === "mobile-month") return new Date(props.date.getFullYear(), props.date.getMonth() + 1, 1);
    return calendar.addDays(props.date, props.view === "day" ? 1 : 7);
  };
  const title = () => {
    if (props.view === "year") return `${props.date.getFullYear()}`;
    if (props.view === "day")
      return props.date.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    if (props.view === "week")
      return `${formatDay(calendar.startOfWeek(props.date))} - ${formatDay(calendar.addDays(calendar.startOfWeek(props.date), 6))}`;
    return formatMonth(props.date);
  };
  const goDate = (date: Date) => props.owner.onDateChange?.(date, props.view);
  const goView = (view: CalendarView) => {
    if (props.owner.onViewChange) {
      props.owner.onViewChange(view);
      return;
    }
    const href = props.owner.getViewHref?.(view);
    if (href) window.location.href = href;
  };
  const navButton = (date: Date, icon: string, label: string) => {
    const href = props.owner.getDateHref?.(date, props.view);
    return props.owner.onDateChange ? (
      <button type="button" aria-label={label} class="btn-segment-icon" onClick={() => goDate(date)}>
        <i class={`ti ${icon}`} />
      </button>
    ) : (
      <a href={href ?? "#"} aria-label={label} class="btn-segment-icon">
        <i class={`ti ${icon}`} />
      </a>
    );
  };
  const todayButton = () => {
    const today = new Date();
    const href = props.owner.getDateHref?.(today, props.view);
    return props.owner.onDateChange ? (
      <button type="button" class="btn-segment font-semibold" onClick={() => goDate(today)}>
        {props.labels.today}
      </button>
    ) : (
      <a href={href ?? "#"} class="btn-segment font-semibold">
        {props.labels.today}
      </a>
    );
  };

  return (
    <header class="flex flex-col gap-2 border-b border-zinc-100 p-2 dark:border-zinc-800/70 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-1.5">
        {navButton(previous(), "ti-chevron-left", props.labels.previous)}
        <div class="btn-segment min-w-36 font-semibold">{title()}</div>
        {navButton(next(), "ti-chevron-right", props.labels.next)}
        {todayButton()}
      </div>
      <div class="w-full sm:w-auto">
        <SegmentedControl
          value={() => (props.view === "mobile-month" ? "month" : props.view)}
          onChange={goView}
          ariaLabel="Calendar view"
          options={[
            { value: "day", label: props.labels.day },
            { value: "week", label: props.labels.week },
            { value: "month", label: props.labels.month },
            { value: "year", label: props.labels.year },
          ]}
        />
      </div>
    </header>
  );
};

const MonthView = (props: {
  owner: CalendarProps;
  date: Date;
  events: NormalizedEvent[];
  labels: Required<CalendarLabels>;
}): JSX.Element => {
  const firstDay = () => props.owner.firstDayOfWeek ?? 1;
  const weeks = () =>
    firstDay() === 1
      ? calendar.getMonthGrid(props.date.getFullYear(), props.date.getMonth())
      : calendar
          .getMonthGrid(props.date.getFullYear(), props.date.getMonth())
          .map((week) => [calendar.addDays(week[0]!, -1), ...week.slice(0, 6)]);
  const weekdays = () => (firstDay() === 1 ? calendar.weekdays() : ["Sun", ...calendar.weekdays().slice(0, 6)]);
  return (
    <div>
      <div
        class={`grid ${props.owner.withWeekNumbers ? "grid-cols-[3rem_repeat(7,minmax(0,1fr))]" : "grid-cols-7"} border-b border-zinc-100 dark:border-zinc-800/70`}
      >
        <Show when={props.owner.withWeekNumbers}>
          <div class="px-2 py-2 text-center text-[11px] font-semibold text-dimmed">Wk</div>
        </Show>
        <For each={weekdays()}>{(day) => <div class="px-2 py-2 text-center text-[11px] font-semibold text-dimmed">{day}</div>}</For>
      </div>
      <div class="grid divide-y divide-zinc-100 dark:divide-zinc-800/70">
        <For each={weeks()}>
          {(week) => (
            <div
              class={`grid min-h-24 ${props.owner.withWeekNumbers ? "grid-cols-[3rem_repeat(7,minmax(0,1fr))]" : "grid-cols-7"} divide-x divide-zinc-100 dark:divide-zinc-800/70`}
            >
              <Show when={props.owner.withWeekNumbers}>
                <div class="flex items-start justify-center px-2 py-2 text-xs font-semibold text-dimmed">{weekNumber(week[0]!)}</div>
              </Show>
              <For each={week}>
                {(day) => {
                  const events = props.events.filter((event) => event.dayKey === calendar.formatDateKey(day));
                  const href = props.owner.getDateHref?.(day, "day");
                  const dayBadge = props.owner.dayBadges?.[calendar.formatDateKey(day)];
                  return (
                    <div
                      class={`relative min-w-0 p-1.5 ${calendar.isSameMonth(day, props.date) ? "" : "bg-zinc-50/60 dark:bg-zinc-900/30"}`}
                    >
                      <div class="flex items-center gap-1">
                        <a
                          href={href ?? "#"}
                          class={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${
                            calendar.isToday(day)
                              ? "bg-blue-500 text-white"
                              : calendar.isSameMonth(day, props.date)
                                ? "text-primary"
                                : "text-dimmed"
                          }`}
                        >
                          {day.getDate()}
                        </a>
                        <Show when={dayBadge}>
                          {(badge) => (
                            <span class="hidden items-center gap-0.5 text-[10px] text-dimmed md:inline-flex">
                              <Show when={badge().icon}>{(icon) => <i class={`ti ti-${icon()} text-[10px]`} />}</Show>
                              {badge().label}
                            </span>
                          )}
                        </Show>
                      </div>
                      <div class="mt-1 hidden flex-col gap-1 md:flex">
                        <For each={events.slice(0, 3)}>
                          {(event) => <EventChip event={event} href={eventHref(props.owner, event)} compact />}
                        </For>
                        <Show when={events.length > 3}>
                          <a href={href ?? "#"} class="px-1 text-[11px] font-medium text-dimmed hover:text-primary">
                            +{events.length - 3} more
                          </a>
                        </Show>
                      </div>
                      <div class="mt-1 flex gap-0.5 md:hidden">
                        <For each={events.slice(0, 4)}>
                          {(event) => (
                            <span
                              class={`h-1.5 w-1.5 rounded-full ${event.colorHex ? "" : dotClass[event.color ?? "blue"]}`}
                              style={event.colorHex ? { "background-color": event.colorHex } : undefined}
                            />
                          )}
                        </For>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

const TimeGridView = (props: {
  owner: CalendarProps;
  date: Date;
  events: NormalizedEvent[];
  labels: Required<CalendarLabels>;
  days: Date[];
}): JSX.Element => {
  const startHour = () => props.owner.startHour ?? 8;
  const endHour = () => props.owner.endHour ?? 18;
  const hours = () => Array.from({ length: endHour() - startHour() + 1 }, (_, index) => startHour() + index);
  return (
    <div class="overflow-x-auto">
      <div class="min-w-160">
        <div
          class={`grid border-b border-zinc-100 dark:border-zinc-800/70`}
          style={{ "grid-template-columns": `4rem repeat(${props.days.length}, minmax(0, 1fr))` }}
        >
          <div class="px-2 py-2 text-center text-[11px] font-semibold text-dimmed">{props.labels.allDay}</div>
          <For each={props.days}>
            {(day) => {
              const dayBadge = props.owner.dayBadges?.[calendar.formatDateKey(day)];
              return (
                <a
                  href={props.owner.getDateHref?.(day, "day") ?? "#"}
                  class="px-2 py-2 text-center text-[11px] font-semibold text-primary hover:text-blue-500"
                >
                  <span>{formatDay(day)}</span>
                  <Show when={dayBadge}>
                    {(badge) => (
                      <span class="mt-0.5 flex items-center justify-center gap-0.5 text-[10px] font-medium text-dimmed">
                        <Show when={badge().icon}>{(icon) => <i class={`ti ti-${icon()} text-[10px]`} />}</Show>
                        {badge().label}
                      </span>
                    )}
                  </Show>
                </a>
              );
            }}
          </For>
        </div>
        <div class="grid" style={{ "grid-template-columns": `4rem repeat(${props.days.length}, minmax(0, 1fr))` }}>
          <div class="border-r border-zinc-100 dark:border-zinc-800/70">
            <For each={hours()}>
              {(hour) => (
                <div class="h-16 border-b border-zinc-100 pr-2 pt-1 text-right text-[11px] text-dimmed dark:border-zinc-800/70">
                  {`${hour}`.padStart(2, "0")}:00
                </div>
              )}
            </For>
          </div>
          <For each={props.days}>
            {(day) => {
              const timed = props.events.filter((event) => event.dayKey === calendar.formatDateKey(day) && !event.allDay);
              const allDay = props.events.filter((event) => event.dayKey === calendar.formatDateKey(day) && event.allDay);
              return (
                <div class="relative min-h-full border-r border-zinc-100 dark:border-zinc-800/70">
                  <div class="absolute inset-x-1 top-1 z-10 flex flex-col gap-1">
                    <For each={allDay}>{(event) => <EventChip event={event} href={eventHref(props.owner, event)} compact />}</For>
                  </div>
                  <For each={hours()}>{() => <div class="h-16 border-b border-zinc-100 dark:border-zinc-800/70" />}</For>
                  <For each={timed}>
                    {(event, index) => {
                      const start = event.startDate.getHours() + event.startDate.getMinutes() / 60;
                      const end = event.endDate.getHours() + event.endDate.getMinutes() / 60;
                      const top = Math.max(0, (start - startHour()) * 4);
                      const height = Math.max(2.5, (end - start) * 4);
                      const lane = index() % 2;
                      return (
                        <div
                          class="absolute px-1"
                          style={{
                            top: `${top}rem`,
                            height: `${height}rem`,
                            left: lane === 0 ? "0.25rem" : "50%",
                            right: lane === 0 ? "50%" : "0.25rem",
                          }}
                        >
                          <EventChip event={event} href={eventHref(props.owner, event)} />
                        </div>
                      );
                    }}
                  </For>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
};

const YearView = (props: { owner: CalendarProps; date: Date; events: NormalizedEvent[] }): JSX.Element => (
  <div class="grid grid-cols-1 divide-y divide-zinc-100 dark:divide-zinc-800/70 md:grid-cols-3 md:divide-x md:divide-y-0">
    <For each={Array.from({ length: 12 }, (_, month) => new Date(props.date.getFullYear(), month, 1))}>
      {(monthDate) => (
        <div class="p-3">
          <div class="mb-2 text-xs font-semibold text-primary">{monthDate.toLocaleDateString("en", { month: "long" })}</div>
          <div class="grid grid-cols-7 gap-1 text-center text-[10px]">
            <For each={calendar.getMonthGrid(monthDate.getFullYear(), monthDate.getMonth()).flat().slice(0, 35)}>
              {(day) => {
                const events = props.events.filter((event) => event.dayKey === calendar.formatDateKey(day));
                return (
                  <a
                    href={props.owner.getDateHref?.(day, "day") ?? "#"}
                    class={`relative flex aspect-square items-center justify-center rounded ${calendar.isToday(day) ? "bg-blue-500 text-white" : calendar.isSameMonth(day, monthDate) ? "text-primary hover:bg-zinc-100 dark:hover:bg-zinc-800" : "text-zinc-300 dark:text-zinc-700"}`}
                  >
                    {day.getDate()}
                    <Show when={events.length > 0}>
                      <span
                        class={`absolute bottom-1 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full ${events[0]!.colorHex ? "" : yearIndicatorClass(day, events[0]!.color ?? "blue")}`}
                        style={
                          events[0]!.colorHex ? { "background-color": calendar.isToday(day) ? "white" : events[0]!.colorHex } : undefined
                        }
                      />
                    </Show>
                  </a>
                );
              }}
            </For>
          </div>
        </div>
      )}
    </For>
  </div>
);

const MobileMonthView = (props: {
  owner: CalendarProps;
  date: Date;
  selectedDate: Date;
  events: NormalizedEvent[];
  labels: Required<CalendarLabels>;
}): JSX.Element => {
  const selectedEvents = () => props.events.filter((event) => event.dayKey === calendar.formatDateKey(props.selectedDate));
  return (
    <div class="mx-auto max-w-md p-3">
      <MonthView owner={{ ...props.owner, withWeekNumbers: false }} date={props.date} events={props.events} labels={props.labels} />
      <div class="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800/70">
        <div class="mb-2 text-sm font-semibold text-primary">
          {props.selectedDate.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}
        </div>
        <Show when={selectedEvents().length > 0} fallback={<div class="py-6 text-center text-xs text-dimmed">{props.labels.noEvents}</div>}>
          <div class="flex flex-col gap-1">
            <For each={selectedEvents()}>{(event) => <EventChip event={event} href={eventHref(props.owner, event)} />}</For>
          </div>
        </Show>
      </div>
    </div>
  );
};

const Calendar = (props: CalendarProps): JSX.Element => {
  const view = () => props.view ?? "month";
  const date = () => parseDate(props.date);
  const selectedDate = () => parseDate(props.selectedDate ?? props.date);
  const normalizedEvents = () => normalizeEvents(props.events);
  const mergedLabels = () => ({ ...labels, ...props.labels });
  const days = () => {
    if (view() === "day") return [date()];
    return calendar.getWeekDays(date());
  };

  return (
    <section class={`paper overflow-hidden ${props.class ?? ""}`}>
      <CalendarHeader date={date()} view={view()} labels={mergedLabels()} owner={props} />
      <Show
        when={view() !== "month"}
        fallback={<MonthView owner={props} date={date()} events={normalizedEvents()} labels={mergedLabels()} />}
      >
        <Show when={view() !== "year"} fallback={<YearView owner={props} date={date()} events={normalizedEvents()} />}>
          <Show
            when={view() !== "mobile-month"}
            fallback={
              <MobileMonthView
                owner={props}
                date={date()}
                selectedDate={selectedDate()}
                events={normalizedEvents()}
                labels={mergedLabels()}
              />
            }
          >
            <TimeGridView owner={props} date={date()} events={normalizedEvents()} labels={mergedLabels()} days={days()} />
          </Show>
        </Show>
      </Show>
    </section>
  );
};

export default Calendar;
