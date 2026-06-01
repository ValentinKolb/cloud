import { dates as calendar, type DateContext } from "@valentinkolb/stdlib";
import type { Accessor, JSX } from "solid-js";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
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
  /** stdlib date context used for timezone-aware rendering and calendar math. */
  dateConfig?: DateContext;
  /** Convenience override for dateConfig.timeZone. */
  timeZone?: string;
  firstDayOfWeek?: 0 | 1;
  withWeekNumbers?: boolean;
  startHour?: number;
  endHour?: number;
  visibleStartHour?: number;
  visibleEndHour?: number;
  allDayMaxHeightRem?: number;
  selectedDate?: Date | string;
  selectedEventId?: string;
  dayBadges?: Record<string, CalendarDayBadge>;
  getViewHref?: (view: CalendarView) => string;
  getDateHref?: (date: Date, view: CalendarView) => string;
  getEventHref?: (event: CalendarEvent) => string | undefined;
  onViewChange?: (view: CalendarView) => void;
  onDateChange?: (date: Date, view: CalendarView) => void;
  onEventClick?: (event: CalendarEvent) => void;
  onEventDrop?: (event: CalendarEvent, next: CalendarEventTimeChange) => void;
  onEventResize?: (event: CalendarEvent, next: CalendarEventTimeChange) => void;
  onEventDoubleClick?: (event: CalendarEvent) => void;
  onSlotClick?: (slot: CalendarEventTimeChange) => void;
  onSlotDoubleClick?: (slot: CalendarEventTimeChange) => void;
  class?: string;
};

export type CalendarEventTimeChange = {
  start: Date;
  end: Date;
  allDay?: boolean;
};

export type CalendarDayBadge = {
  icon?: string;
  label: string;
};

type NormalizedEvent = CalendarEvent & {
  startDate: Date;
  endDate: Date;
  dayKey: string;
  sourceStartDate: Date;
  sourceEndDate: Date;
};

type CalendarPreview = CalendarEventTimeChange & {
  id: string;
};

type TimedEventLayout = {
  event: NormalizedEvent;
  lane: number;
  lanes: number;
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
  blue: "bg-blue-50 text-blue-700 border-zinc-200 border-l-blue-500 dark:bg-blue-500/15 dark:text-blue-200 dark:border-zinc-700 dark:border-l-blue-400",
  emerald:
    "bg-emerald-50 text-emerald-700 border-zinc-200 border-l-emerald-500 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-zinc-700 dark:border-l-emerald-400",
  amber:
    "bg-amber-50 text-amber-700 border-zinc-200 border-l-amber-500 dark:bg-amber-500/15 dark:text-amber-200 dark:border-zinc-700 dark:border-l-amber-400",
  red: "bg-red-50 text-red-700 border-zinc-200 border-l-red-500 dark:bg-red-500/15 dark:text-red-200 dark:border-zinc-700 dark:border-l-red-400",
  violet:
    "bg-violet-50 text-violet-700 border-zinc-200 border-l-violet-500 dark:bg-violet-500/15 dark:text-violet-200 dark:border-zinc-700 dark:border-l-violet-400",
  cyan: "bg-cyan-50 text-cyan-700 border-zinc-200 border-l-cyan-500 dark:bg-cyan-500/15 dark:text-cyan-200 dark:border-zinc-700 dark:border-l-cyan-400",
  zinc: "bg-zinc-50 text-zinc-700 border-zinc-200 border-l-zinc-400 dark:bg-zinc-900 dark:text-zinc-200 dark:border-zinc-700 dark:border-l-zinc-500",
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

const ownerDateConfig = (owner: CalendarProps): DateContext => ({
  ...owner.dateConfig,
  timeZone: owner.timeZone ?? owner.dateConfig?.timeZone,
  firstDayOfWeek: owner.firstDayOfWeek ?? owner.dateConfig?.firstDayOfWeek ?? owner.dateConfig?.weekStartsOn ?? 1,
});

const yearIndicatorClass = (date: Date, color: CalendarEventColor, context?: DateContext): string =>
  calendar.isToday(date, context) ? "bg-white" : dotClass[color];
let activeDraggedEventId = "";

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
const zonedWeekNumber = (date: Date, context?: DateContext): number => {
  if (!context?.timeZone) return weekNumber(date);
  const [year = "1970", month = "1", day = "1"] = calendar.formatDateKey(date, context).split("-");
  return weekNumber(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
};

const formatTime = (date: Date, context?: DateContext): string => calendar.formatTime(date, context);
const formatDay = (date: Date, context?: DateContext): string =>
  date.toLocaleDateString(context?.locale ?? "en", { weekday: "short", day: "numeric", timeZone: context?.timeZone });
const formatMonth = (date: Date, context?: DateContext): string => calendar.formatMonthYear(date, context);
const zonedYearMonth = (date: Date, context?: DateContext): { year: number; month: number } => {
  const [year = "1970", month = "1"] = calendar.formatDateKey(date, context).split("-");
  return { year: Number(year), month: Number(month) - 1 };
};
const zonedMonthDate = (year: number, month: number, context?: DateContext): Date => {
  const value = `${year}-${String(month + 1).padStart(2, "0")}-01T12:00`;
  if (!context?.timeZone) return parseDate(value);
  return new Date(calendar.zonedDateTimeToInstant(value, context.timeZone, { disambiguation: "compatible" }));
};

const startOfDay = (date: Date, context?: DateContext): Date => calendar.startOfDay(date, context);
const endOfDay = (date: Date, context?: DateContext): Date => calendar.endOfDay(date, context);
const isStartOfDay = (date: Date, context?: DateContext): boolean => date.getTime() === startOfDay(date, context).getTime();
const addMinutes = (date: Date, minutes: number): Date => new Date(date.getTime() + minutes * 60 * 1000);
const zonedHour = (date: Date, context?: DateContext): number => {
  if (!context?.timeZone) return date.getHours() + date.getMinutes() / 60;
  const value = calendar.instantToZonedInput(date, context.timeZone);
  return Number(value.slice(11, 13)) + Number(value.slice(14, 16)) / 60;
};
const zonedSlot = (day: Date, hour: number, context?: DateContext): Date => {
  const value = `${calendar.formatDateKey(day, context)}T${String(hour).padStart(2, "0")}:00`;
  if (!context?.timeZone) return parseDate(value);
  return new Date(calendar.zonedDateTimeToInstant(value, context.timeZone, { disambiguation: "compatible" }));
};
const roundToMinutes = (date: Date, minutes: number): Date => {
  const next = new Date(date);
  const rounded = Math.round(next.getMinutes() / minutes) * minutes;
  next.setMinutes(rounded, 0, 0);
  return next;
};

const normalizeEvents = (events: CalendarEvent[], context?: DateContext): NormalizedEvent[] =>
  events.flatMap((event) => {
    const startDate = parseDate(event.start);
    const endDate = event.end ? parseDate(event.end) : new Date(startDate.getTime() + 60 * 60 * 1000);
    const duration = Math.max(60 * 60 * 1000, endDate.getTime() - startDate.getTime());
    const rangeEnd = endDate > startDate ? endDate : new Date(startDate.getTime() + duration);
    const lastDay =
      event.allDay && isStartOfDay(rangeEnd, context)
        ? calendar.addDays(startOfDay(rangeEnd, context), -1, context)
        : startOfDay(rangeEnd, context);
    const days: NormalizedEvent[] = [];
    for (let day = startOfDay(startDate, context); day <= lastDay; day = calendar.addDays(day, 1, context)) {
      const segmentStart = day.getTime() === startOfDay(startDate, context).getTime() ? startDate : startOfDay(day, context);
      const segmentEnd = day.getTime() === startOfDay(rangeEnd, context).getTime() ? rangeEnd : endOfDay(day, context);
      days.push({
        ...event,
        startDate: segmentStart,
        endDate: segmentEnd,
        sourceStartDate: startDate,
        sourceEndDate: rangeEnd,
        dayKey: calendar.formatDateKey(day, context),
        allDay: event.allDay,
      });
    }
    return days;
  });

const eventHref = (props: CalendarProps, event: CalendarEvent): string | undefined => props.getEventHref?.(event) ?? event.href;

const draggedEventId = (event: DragEvent): string =>
  activeDraggedEventId || event.dataTransfer?.getData("application/x-calendar-event") || event.dataTransfer?.getData("text/plain") || "";

const moveEventTo = (event: NormalizedEvent, target: Date, allDay = false, context?: DateContext): CalendarEventTimeChange => {
  const duration = Math.max(30 * 60 * 1000, event.sourceEndDate.getTime() - event.sourceStartDate.getTime());
  const start = allDay ? startOfDay(target, context) : new Date(target);
  start.setSeconds(0, 0);
  return { start, end: new Date(start.getTime() + duration), allDay };
};

const previewSegments = (preview: CalendarPreview | null, days: Date[], context?: DateContext): NormalizedEvent[] =>
  preview
    ? normalizeEvents(
        [
          {
            id: `preview-${preview.id}`,
            title: "Preview",
            start: preview.start,
            end: preview.end,
            allDay: preview.allDay,
            color: "blue",
          },
        ],
        context,
      ).filter((event) => days.some((day) => event.dayKey === calendar.formatDateKey(day, context)))
    : [];

const timedEventLayouts = (events: NormalizedEvent[]): TimedEventLayout[] => {
  const sorted = [...events].sort((a, b) => a.startDate.getTime() - b.startDate.getTime() || b.endDate.getTime() - a.endDate.getTime());
  const groups: NormalizedEvent[][] = [];
  let currentGroup: NormalizedEvent[] = [];
  let currentGroupEnd = 0;

  for (const event of sorted) {
    const start = event.startDate.getTime();
    const end = event.endDate.getTime();
    if (currentGroup.length === 0 || start < currentGroupEnd) {
      currentGroup.push(event);
      currentGroupEnd = Math.max(currentGroupEnd, end);
      continue;
    }
    groups.push(currentGroup);
    currentGroup = [event];
    currentGroupEnd = end;
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  return groups.flatMap((group) => {
    const laneEnds: number[] = [];
    const assigned = group.map((event) => {
      const start = event.startDate.getTime();
      const lane = laneEnds.findIndex((end) => end <= start);
      const nextLane = lane >= 0 ? lane : laneEnds.length;
      laneEnds[nextLane] = event.endDate.getTime();
      return { event, lane: nextLane };
    });
    const lanes = Math.max(1, laneEnds.length);
    return assigned.map((item) => ({ ...item, lanes }));
  });
};

const EventChip = (props: {
  event: NormalizedEvent;
  owner: CalendarProps;
  href?: string;
  compact?: boolean;
  fill?: boolean;
}): JSX.Element => {
  const dateConfig = () => ownerDateConfig(props.owner);
  const color = () => props.event.color ?? "blue";
  const style = () => (props.event.colorHex ? { "border-left-color": props.event.colorHex } : undefined);
  const selected = () => props.owner.selectedEventId === props.event.id;
  const className = () =>
    `block min-w-0 rounded border border-l-2 px-1.5 py-1 text-left leading-tight ${props.fill ? "h-full" : ""} ${props.owner.onEventDrop ? "cursor-grab active:cursor-grabbing" : ""} ${props.event.display === "background" ? "opacity-60" : ""} ${props.event.colorHex ? "border-zinc-200 bg-zinc-50 text-primary dark:border-zinc-700 dark:bg-zinc-900" : colorClass[color()]} ${selected() ? "outline outline-2 outline-blue-500 outline-offset-1" : ""}`;
  const durationHours = () => (props.event.endDate.getTime() - props.event.startDate.getTime()) / 3_600_000;
  const showTime = () => !props.event.allDay && !props.compact && durationHours() >= 0.75;
  const showLocation = () => Boolean(props.event.location && !props.compact && durationHours() >= 1.25);
  const isInteractive = () => Boolean(props.owner.onEventClick || props.owner.onEventDoubleClick);
  const dragProps = () =>
    props.owner.onEventDrop
      ? {
          draggable: true,
          onDragStart: (event: DragEvent) => {
            activeDraggedEventId = props.event.id;
            event.dataTransfer?.setData("application/x-calendar-event", props.event.id);
            event.dataTransfer?.setData("text/plain", props.event.id);
          },
          onDragEnd: () => {
            activeDraggedEventId = "";
          },
        }
      : {};
  const content = (
    <>
      <span class="block truncate text-[11px] font-semibold">{props.event.title}</span>
      <Show when={showTime()}>
        <span class="block truncate text-[10px] opacity-75">
          {formatTime(props.event.startDate, dateConfig())} - {formatTime(props.event.endDate, dateConfig())}
        </span>
      </Show>
      <Show when={showLocation()}>
        <span class="block truncate text-[10px] opacity-75">{props.event.location}</span>
      </Show>
    </>
  );
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (clickTimer) clearTimeout(clickTimer);
  });
  const onClick = (event: MouseEvent) => {
    if (!props.owner.onEventClick) return;
    event.preventDefault();
    event.stopPropagation();
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(
      () => {
        clickTimer = undefined;
        props.owner.onEventClick?.(props.event);
      },
      props.owner.onEventDoubleClick ? 220 : 0,
    );
  };
  const onDoubleClick = (event: MouseEvent) => {
    if (!props.owner.onEventDoubleClick) return;
    event.preventDefault();
    event.stopPropagation();
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = undefined;
    }
    props.owner.onEventDoubleClick(props.event);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isInteractive() || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    (props.owner.onEventClick ?? props.owner.onEventDoubleClick)?.(props.event);
  };

  return props.href ? (
    <a
      href={props.href}
      class={className()}
      data-calendar-event=""
      data-space-item-id={props.event.dataSpaceItemId}
      style={style()}
      onClick={onClick}
      onDblClick={onDoubleClick}
      onKeyDown={onKeyDown}
      aria-label={`${props.event.title}${props.event.allDay ? "" : `, ${formatTime(props.event.startDate, dateConfig())} to ${formatTime(props.event.endDate, dateConfig())}`}`}
      {...dragProps()}
    >
      {content}
    </a>
  ) : (
    <div
      class={className()}
      data-calendar-event=""
      style={style()}
      role={isInteractive() ? "button" : undefined}
      tabIndex={isInteractive() ? 0 : undefined}
      onClick={onClick}
      onDblClick={onDoubleClick}
      onKeyDown={onKeyDown}
      aria-label={`${props.event.title}${props.event.allDay ? "" : `, ${formatTime(props.event.startDate, dateConfig())} to ${formatTime(props.event.endDate, dateConfig())}`}`}
      {...dragProps()}
    >
      {content}
    </div>
  );
};

const slotInteractionProps = (owner: CalendarProps, slot: () => CalendarEventTimeChange) => {
  const isSlotChild = (event: MouseEvent) =>
    event.target instanceof Element && Boolean(event.target.closest("a,button,[data-calendar-event]"));
  return {
    onClick: (event: MouseEvent) => {
      if (!owner.onSlotClick || isSlotChild(event)) return;
      owner.onSlotClick(slot());
    },
    onDblClick: (event: MouseEvent) => {
      if (!owner.onSlotDoubleClick || isSlotChild(event)) return;
      owner.onSlotDoubleClick(slot());
    },
  };
};

const dropTargetProps = (owner: CalendarProps, events: NormalizedEvent[], target: () => Date, allDay = false) => {
  if (!owner.onEventDrop) return {};
  return {
    onDragOver: (event: DragEvent) => event.preventDefault(),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      const id = draggedEventId(event);
      const calendarEvent = events.find((candidate) => candidate.id === id);
      if (!calendarEvent) return;
      owner.onEventDrop?.(calendarEvent, moveEventTo(calendarEvent, target(), allDay, ownerDateConfig(owner)));
    },
  };
};

const dropPreviewProps = (
  owner: CalendarProps,
  events: NormalizedEvent[],
  preview: Accessor<string>,
  setPreview: (value: string) => void,
  key: string,
  target: () => Date,
  allDay = false,
) => {
  if (!owner.onEventDrop) return {};
  return {
    onDragEnter: (event: DragEvent) => {
      event.preventDefault();
      setPreview(key);
    },
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      if (preview() !== key) setPreview(key);
    },
    onDragLeave: () => {
      if (preview() === key) setPreview("");
    },
    onDrop: (event: DragEvent) => {
      dropTargetProps(owner, events, target, allDay).onDrop?.(event);
      setPreview("");
    },
  };
};

const CalendarHeader = (props: { date: Date; view: CalendarView; labels: Required<CalendarLabels>; owner: CalendarProps }): JSX.Element => {
  const dateConfig = () => ownerDateConfig(props.owner);
  const previous = () => {
    if (props.view === "year") return calendar.addMonths(props.date, -12, dateConfig());
    if (props.view === "month" || props.view === "mobile-month") return calendar.addMonths(props.date, -1, dateConfig());
    return calendar.addDays(props.date, props.view === "day" ? -1 : -7, dateConfig());
  };
  const next = () => {
    if (props.view === "year") return calendar.addMonths(props.date, 12, dateConfig());
    if (props.view === "month" || props.view === "mobile-month") return calendar.addMonths(props.date, 1, dateConfig());
    return calendar.addDays(props.date, props.view === "day" ? 1 : 7, dateConfig());
  };
  const title = () => {
    if (props.view === "year")
      return new Intl.DateTimeFormat(dateConfig().locale ?? "en", { year: "numeric", timeZone: dateConfig().timeZone }).format(props.date);
    if (props.view === "day")
      return props.date.toLocaleDateString(dateConfig().locale ?? "en", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: dateConfig().timeZone,
      });
    if (props.view === "week")
      return `${formatDay(calendar.startOfWeek(props.date, dateConfig()), dateConfig())} - ${formatDay(calendar.addDays(calendar.startOfWeek(props.date, dateConfig()), 6, dateConfig()), dateConfig())}`;
    return formatMonth(props.date, dateConfig());
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
    const today = calendar.today(dateConfig());
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
  const dateConfig = () => ownerDateConfig(props.owner);
  const [dropPreview, setDropPreview] = createSignal("");
  const month = () => zonedYearMonth(props.date, dateConfig());
  const weeks = () => calendar.getMonthGrid(month().year, month().month, dateConfig());
  const weekdays = () => calendar.weekdays(dateConfig());
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
                <div class="flex items-start justify-center px-2 py-2 text-xs font-semibold text-dimmed">
                  {zonedWeekNumber(week[0]!, dateConfig())}
                </div>
              </Show>
              <For each={week}>
                {(day) => {
                  const dayKey = calendar.formatDateKey(day, dateConfig());
                  const events = props.events.filter((event) => event.dayKey === dayKey);
                  const href = props.owner.getDateHref?.(day, "day");
                  const dayBadge = props.owner.dayBadges?.[dayKey];
                  return (
                    <div
                      class={`relative min-w-0 p-1.5 ${calendar.isSameMonth(day, props.date, dateConfig()) ? "" : "bg-zinc-50/60 dark:bg-zinc-900/30"}`}
                      classList={{
                        "bg-blue-500/10 ring-1 ring-inset ring-blue-400": dropPreview() === dayKey,
                        "cursor-pointer hover:bg-blue-500/5": Boolean(props.owner.onSlotClick || props.owner.onSlotDoubleClick),
                      }}
                      {...slotInteractionProps(props.owner, () => {
                        const start = startOfDay(day, dateConfig());
                        return { start, end: calendar.addDays(start, 1, dateConfig()), allDay: true };
                      })}
                      {...dropPreviewProps(
                        props.owner,
                        props.events,
                        dropPreview,
                        setDropPreview,
                        dayKey,
                        () => startOfDay(day, dateConfig()),
                        true,
                      )}
                    >
                      <div class="flex items-center gap-1">
                        <a
                          href={href ?? "#"}
                          class={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${
                            calendar.isToday(day, dateConfig())
                              ? "bg-blue-500 text-white"
                              : calendar.isSameMonth(day, props.date, dateConfig())
                                ? "text-primary"
                                : "text-dimmed"
                          }`}
                        >
                          {calendar.formatDayNumber(day, dateConfig())}
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
                          {(event) => <EventChip event={event} owner={props.owner} href={eventHref(props.owner, event)} compact />}
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
  const dateConfig = () => ownerDateConfig(props.owner);
  const gridStartHour = () => props.owner.visibleStartHour ?? 0;
  const gridEndHour = () => props.owner.visibleEndHour ?? 23;
  const businessStartHour = () => props.owner.startHour ?? 8;
  const businessEndHour = () => props.owner.endHour ?? 18;
  const hours = () => Array.from({ length: gridEndHour() - gridStartHour() + 1 }, (_, index) => gridStartHour() + index);
  const [dropPreview, setDropPreview] = createSignal("");
  const [timePreview, setTimePreview] = createSignal<CalendarPreview | null>(null);
  let scrollContainer: HTMLDivElement | undefined;
  let defaultHourMarker: HTMLDivElement | undefined;
  const slotEnd = (start: Date) => addMinutes(start, 60);
  const allDayKey = (day: Date) => `${calendar.formatDateKey(day, dateConfig())}-all-day`;
  const previewEvents = () => previewSegments(timePreview(), props.days, dateConfig());
  const timeDropProps = (key: string, target: () => Date, allDay = false) => {
    if (!props.owner.onEventDrop) return {};
    return {
      onDragEnter: (event: DragEvent) => {
        event.preventDefault();
        const id = draggedEventId(event);
        const calendarEvent = props.events.find((candidate) => candidate.id === id);
        setDropPreview(key);
        if (calendarEvent) setTimePreview({ id: calendarEvent.id, ...moveEventTo(calendarEvent, target(), allDay, dateConfig()) });
      },
      onDragOver: (event: DragEvent) => {
        event.preventDefault();
        const id = draggedEventId(event);
        const calendarEvent = props.events.find((candidate) => candidate.id === id);
        setDropPreview(key);
        if (calendarEvent) setTimePreview({ id: calendarEvent.id, ...moveEventTo(calendarEvent, target(), allDay, dateConfig()) });
      },
      onDragLeave: () => {
        if (dropPreview() === key) {
          setDropPreview("");
          setTimePreview(null);
        }
      },
      onDrop: (event: DragEvent) => {
        dropTargetProps(props.owner, props.events, target, allDay).onDrop?.(event);
        setDropPreview("");
        setTimePreview(null);
      },
    };
  };
  const eventLayout = (event: NormalizedEvent) => {
    const start = zonedHour(event.startDate, dateConfig());
    const end = zonedHour(event.endDate, dateConfig());
    const visibleStart = Math.max(gridStartHour(), start);
    const visibleEnd = Math.min(gridEndHour() + 1, end);
    return {
      top: Math.max(0, (visibleStart - gridStartHour()) * 4),
      height: Math.max(2.5, (visibleEnd - visibleStart) * 4),
    };
  };
  const currentTimeLine = (day: Date) => {
    const now = new Date();
    if (calendar.formatDateKey(day, dateConfig()) !== calendar.formatDateKey(now, dateConfig())) return null;
    const hour = zonedHour(now, dateConfig());
    if (hour < gridStartHour() || hour > gridEndHour() + 1) return null;
    return (hour - gridStartHour()) * 4;
  };
  onMount(() => {
    requestAnimationFrame(() => {
      if (!scrollContainer || !defaultHourMarker) return;
      const targetTop = defaultHourMarker.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top;
      scrollContainer.scrollTo({ top: Math.max(0, scrollContainer.scrollTop + targetTop), behavior: "smooth" });
    });
  });
  return (
    <div class="flex min-h-0 min-w-160 flex-1 flex-col">
      <div
        class="grid border-b border-zinc-100 dark:border-zinc-800/70"
        style={{ "grid-template-columns": `4rem repeat(${props.days.length}, minmax(0, 1fr))` }}
      >
        <div />
        <For each={props.days}>
          {(day) => {
            const dayBadge = props.owner.dayBadges?.[calendar.formatDateKey(day, dateConfig())];
            return (
              <a
                href={props.owner.getDateHref?.(day, "day") ?? "#"}
                class="px-2 py-2 text-center text-[11px] font-semibold text-primary hover:text-blue-500"
              >
                <span>{formatDay(day, dateConfig())}</span>
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
      <div
        class="grid overflow-y-auto border-b border-zinc-100 dark:border-zinc-800/70"
        style={{
          "grid-template-columns": `4rem repeat(${props.days.length}, minmax(0, 1fr))`,
          "max-height": `${props.owner.allDayMaxHeightRem ?? 7}rem`,
        }}
      >
        <div class="sticky top-0 bg-white px-2 py-2 text-center text-[11px] font-semibold text-dimmed dark:bg-zinc-950">
          {props.labels.allDay}
        </div>
        <For each={props.days}>
          {(day) => {
            const dayKey = calendar.formatDateKey(day, dateConfig());
            const allDay = props.events.filter((event) => event.dayKey === dayKey && event.allDay);
            const previewAllDay = previewEvents().filter((event) => event.dayKey === dayKey && event.allDay);
            return (
              <div
                class="min-h-10 border-r border-zinc-100 p-1 dark:border-zinc-800/70"
                classList={{
                  "rounded bg-blue-500/10 ring-1 ring-inset ring-blue-400": dropPreview() === allDayKey(day),
                  "cursor-pointer hover:bg-blue-500/5": Boolean(props.owner.onSlotClick || props.owner.onSlotDoubleClick),
                }}
                {...slotInteractionProps(props.owner, () => {
                  const start = startOfDay(day, dateConfig());
                  return { start, end: calendar.addDays(start, 1, dateConfig()), allDay: true };
                })}
                {...dropPreviewProps(
                  props.owner,
                  props.events,
                  dropPreview,
                  setDropPreview,
                  allDayKey(day),
                  () => startOfDay(day, dateConfig()),
                  true,
                )}
              >
                <div class="flex flex-col gap-1">
                  <For each={previewAllDay}>
                    {(event) => (
                      <div class="rounded border border-dashed border-blue-500 bg-blue-500/10 px-1.5 py-1 text-[10px] font-semibold text-blue-600">
                        {event.title}
                      </div>
                    )}
                  </For>
                  <For each={allDay}>
                    {(event) => <EventChip event={event} owner={props.owner} href={eventHref(props.owner, event)} compact />}
                  </For>
                </div>
              </div>
            );
          }}
        </For>
      </div>
      <div ref={scrollContainer} class="min-h-0 flex-1 overflow-auto">
        <div class="grid" style={{ "grid-template-columns": `4rem repeat(${props.days.length}, minmax(0, 1fr))` }}>
          <div class="border-r border-zinc-100 dark:border-zinc-800/70">
            <For each={hours()}>
              {(hour) => (
                <div
                  ref={(element) => {
                    if (hour === businessStartHour()) defaultHourMarker = element;
                  }}
                  class="h-16 border-b border-zinc-100 pr-2 pt-1 text-right text-[11px] text-dimmed dark:border-zinc-800/70"
                  classList={{ "bg-zinc-50/70 dark:bg-zinc-900/30": hour < businessStartHour() || hour > businessEndHour() }}
                >
                  {`${hour}`.padStart(2, "0")}:00
                </div>
              )}
            </For>
          </div>
          <For each={props.days}>
            {(day) => {
              const dayKey = calendar.formatDateKey(day, dateConfig());
              const timed = props.events.filter((event) => event.dayKey === dayKey && !event.allDay);
              const layouts = () => timedEventLayouts(timed);
              return (
                <div class="relative min-h-full border-r border-zinc-100 dark:border-zinc-800/70">
                  <Show when={currentTimeLine(day)}>
                    {(top) => (
                      <div class="pointer-events-none absolute inset-x-0 z-40 border-t border-red-500" style={{ top: `${top()}rem` }} />
                    )}
                  </Show>
                  <For each={hours()}>
                    {(hour) => (
                      <div
                        class="relative h-16 border-b border-zinc-100 dark:border-zinc-800/70"
                        classList={{
                          "bg-blue-500/10 ring-1 ring-inset ring-blue-400": dropPreview() === `${dayKey}-${hour}`,
                          "bg-zinc-50/70 dark:bg-zinc-900/30": hour < businessStartHour() || hour > businessEndHour(),
                          "cursor-pointer hover:bg-blue-500/5": Boolean(props.owner.onSlotClick || props.owner.onSlotDoubleClick),
                        }}
                        {...slotInteractionProps(props.owner, () => {
                          const start = zonedSlot(day, hour, dateConfig());
                          return { start, end: slotEnd(start), allDay: false };
                        })}
                        {...timeDropProps(`${dayKey}-${hour}`, () => zonedSlot(day, hour, dateConfig()), false)}
                      />
                    )}
                  </For>
                  <For each={previewEvents().filter((event) => event.dayKey === dayKey && !event.allDay)}>
                    {(event) => {
                      const layout = eventLayout(event);
                      return (
                        <div
                          class="pointer-events-none absolute inset-x-1 z-30 rounded border border-dashed border-blue-500 bg-blue-500/10"
                          style={{ top: `${layout.top}rem`, height: `${layout.height}rem` }}
                        >
                          <div class="px-1.5 py-1 text-[10px] font-semibold text-blue-600">
                            {formatTime(event.startDate, dateConfig())} - {formatTime(event.endDate, dateConfig())}
                          </div>
                        </div>
                      );
                    }}
                  </For>
                  <For each={layouts()}>
                    {(layoutItem) => {
                      const event = layoutItem.event;
                      const layout = eventLayout(event);
                      const visualLanes = Math.min(layoutItem.lanes, 3);
                      const laneWidth = layoutItem.lanes <= 1 ? 100 : 72;
                      const laneOffset = layoutItem.lanes <= 1 ? 0 : (28 / Math.max(1, visualLanes - 1)) * (layoutItem.lane % visualLanes);
                      const [resizePreview, setResizePreview] = createSignal<Date | null>(null);
                      const resizeStart = (pointerEvent: PointerEvent) => {
                        if (!props.owner.onEventResize) return;
                        pointerEvent.preventDefault();
                        pointerEvent.stopPropagation();
                        const startY = pointerEvent.clientY;
                        const initialEnd = event.sourceEndDate;
                        let nextEnd = initialEnd;
                        const onMove = (moveEvent: PointerEvent) => {
                          const deltaMinutes = Math.round(((moveEvent.clientY - startY) / 64) * 60);
                          const candidate = roundToMinutes(addMinutes(initialEnd, deltaMinutes), 15);
                          if (candidate > event.sourceStartDate) {
                            nextEnd = candidate;
                            setResizePreview(candidate);
                          }
                        };
                        const onUp = () => {
                          window.removeEventListener("pointermove", onMove);
                          window.removeEventListener("pointerup", onUp);
                          setResizePreview(null);
                          if (nextEnd.getTime() !== initialEnd.getTime()) {
                            props.owner.onEventResize?.(event, { start: event.sourceStartDate, end: nextEnd, allDay: event.allDay });
                          }
                        };
                        window.addEventListener("pointermove", onMove);
                        window.addEventListener("pointerup", onUp, { once: true });
                      };
                      return (
                        <div
                          class="absolute"
                          style={{
                            top: `${layout.top}rem`,
                            height: `${layout.height}rem`,
                            left: `${laneOffset}%`,
                            width: `${laneWidth}%`,
                            "z-index": String(20 + layoutItem.lane),
                          }}
                        >
                          <div class="group relative h-full">
                            <EventChip event={event} owner={props.owner} href={eventHref(props.owner, event)} fill />
                            <Show when={resizePreview()}>
                              {(end) => (
                                <>
                                  <div
                                    class="pointer-events-none absolute inset-x-0 top-0 z-10 rounded border border-dashed border-blue-500 bg-blue-500/10"
                                    style={{
                                      height: `${eventLayout({ ...event, endDate: end(), sourceEndDate: end() }).height}rem`,
                                    }}
                                  />
                                  <div class="pointer-events-none absolute inset-x-0 top-full z-30 rounded-b border border-dashed border-blue-500 bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:bg-zinc-950/90">
                                    until {formatTime(end(), dateConfig())}
                                  </div>
                                </>
                              )}
                            </Show>
                            <Show when={props.owner.onEventResize}>
                              <button
                                type="button"
                                aria-label="Resize event"
                                draggable={false}
                                class="absolute inset-x-2 bottom-0.5 z-20 flex h-4 cursor-ns-resize items-center justify-center rounded-md bg-blue-50/90 text-blue-600 opacity-0 backdrop-blur transition-opacity group-hover:opacity-90 focus:opacity-100 hover:opacity-100 dark:bg-blue-500/20 dark:text-blue-200"
                                onPointerDown={resizeStart}
                                onDragStart={(event) => event.preventDefault()}
                              >
                                <i class="ti ti-grip-horizontal text-[12px]" />
                              </button>
                            </Show>
                          </div>
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
    <For
      each={Array.from({ length: 12 }, (_, month) =>
        zonedMonthDate(zonedYearMonth(props.date, ownerDateConfig(props.owner)).year, month, ownerDateConfig(props.owner)),
      )}
    >
      {(monthDate) => (
        <div class="p-3">
          <div class="mb-2 text-xs font-semibold text-primary">
            {monthDate.toLocaleDateString(ownerDateConfig(props.owner).locale ?? "en", {
              month: "long",
              timeZone: ownerDateConfig(props.owner).timeZone,
            })}
          </div>
          <div class="grid grid-cols-7 gap-1 text-center text-[10px]">
            <For
              each={calendar
                .getMonthGrid(
                  zonedYearMonth(monthDate, ownerDateConfig(props.owner)).year,
                  zonedYearMonth(monthDate, ownerDateConfig(props.owner)).month,
                  ownerDateConfig(props.owner),
                )
                .flat()
                .slice(0, 35)}
            >
              {(day) => {
                const dateConfig = ownerDateConfig(props.owner);
                const events = props.events.filter((event) => event.dayKey === calendar.formatDateKey(day, dateConfig));
                return (
                  <a
                    href={props.owner.getDateHref?.(day, "day") ?? "#"}
                    class={`relative flex aspect-square items-center justify-center rounded ${calendar.isToday(day, dateConfig) ? "bg-blue-500 text-white" : calendar.isSameMonth(day, monthDate, dateConfig) ? "text-primary hover:bg-zinc-100 dark:hover:bg-zinc-800" : "text-zinc-300 dark:text-zinc-700"}`}
                  >
                    {calendar.formatDayNumber(day, dateConfig)}
                    <Show when={events.length > 0}>
                      <span
                        class={`absolute bottom-1 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full ${events[0]!.colorHex ? "" : yearIndicatorClass(day, events[0]!.color ?? "blue", dateConfig)}`}
                        style={
                          events[0]!.colorHex
                            ? { "background-color": calendar.isToday(day, dateConfig) ? "white" : events[0]!.colorHex }
                            : undefined
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
  const dateConfig = () => ownerDateConfig(props.owner);
  const selectedEvents = () => props.events.filter((event) => event.dayKey === calendar.formatDateKey(props.selectedDate, dateConfig()));
  return (
    <div class="mx-auto max-w-md p-3">
      <MonthView owner={{ ...props.owner, withWeekNumbers: false }} date={props.date} events={props.events} labels={props.labels} />
      <div class="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800/70">
        <div class="mb-2 text-sm font-semibold text-primary">
          {props.selectedDate.toLocaleDateString(dateConfig().locale ?? "en", {
            weekday: "long",
            month: "long",
            day: "numeric",
            timeZone: dateConfig().timeZone,
          })}
        </div>
        <Show when={selectedEvents().length > 0} fallback={<div class="py-6 text-center text-xs text-dimmed">{props.labels.noEvents}</div>}>
          <div class="flex flex-col gap-1">
            <For each={selectedEvents()}>
              {(event) => <EventChip event={event} owner={props.owner} href={eventHref(props.owner, event)} />}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};

const Calendar = (props: CalendarProps): JSX.Element => {
  const view = () => props.view ?? "month";
  const dateConfig = () => ownerDateConfig(props);
  const date = () => parseDate(props.date);
  const selectedDate = () => parseDate(props.selectedDate ?? props.date);
  const normalizedEvents = () => normalizeEvents(props.events, dateConfig());
  const mergedLabels = () => ({ ...labels, ...props.labels });
  const days = () => {
    if (view() === "day") return [date()];
    return calendar.getWeekDays(date(), dateConfig());
  };

  return (
    <section class={`paper flex min-h-0 flex-col overflow-hidden ${props.class ?? ""}`}>
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
