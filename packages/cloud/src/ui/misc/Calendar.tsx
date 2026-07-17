import { Link, type LinkNavigateEvent } from "@valentinkolb/ssr/nav";
import { dates as calendar, type DateContext } from "@valentinkolb/stdlib";
import type { JSX, ParentProps } from "solid-js";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import SegmentedControl from "../input/SegmentedControl";
import { calendarDayIndexAtPoint, calendarMinuteAtPoint, startCalendarPointerSession } from "./calendar-pointer";

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

export type CalendarEventRenderContext = {
  compact: boolean;
  fill: boolean;
  start: Date;
  end: Date;
  allDay: boolean;
  durationHours: number;
  timeLabel: string;
};

export type CalendarProps = {
  date: Date | string;
  events: CalendarEvent[];
  view?: CalendarView;
  views?: CalendarView[];
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
  hideAllDay?: boolean;
  selectedDate?: Date | string;
  selectedEventId?: string;
  dayBadges?: Record<string, CalendarDayBadge>;
  getViewHref?: (view: CalendarView) => string;
  getDateHref?: (date: Date, view: CalendarView) => string;
  getEventHref?: (event: CalendarEvent) => string | undefined;
  renderEvent?: (event: CalendarEvent, context: CalendarEventRenderContext) => JSX.Element;
  /** Progressively enhance canonical calendar links after the app has loaded their target state. */
  onNavigate?: (event: LinkNavigateEvent) => void | Promise<void>;
  /** Progressively enhance canonical links without a document view transition. */
  onNavigateHref?: (href: string) => void;
  /** Optionally preload the target behind a canonical calendar link. */
  onPrefetch?: (href: string) => void;
  navigationPending?: boolean;
  onViewChange?: (view: CalendarView) => void;
  onDateChange?: (date: Date, view: CalendarView) => void;
  onEventClick?: (event: CalendarEvent) => void;
  onEventDrop?: (event: CalendarEvent, next: CalendarEventTimeChange) => void;
  onEventResize?: (event: CalendarEvent, next: CalendarEventTimeChange) => void;
  onEventDoubleClick?: (event: CalendarEvent) => void;
  onSlotClick?: (slot: CalendarEventTimeChange) => void;
  onSlotDoubleClick?: (slot: CalendarEventTimeChange) => void;
  toolbarActions?: JSX.Element;
  toolbarContent?: JSX.Element;
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
  groupId: number;
  groupStartDate: Date;
  groupEndDate: Date;
};

type TimedOverflowLayout = {
  groupId: number;
  hiddenEvents: NormalizedEvent[];
  groupStartDate: Date;
  groupEndDate: Date;
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

const eventColorClass: Record<CalendarEventColor, string> = {
  blue: "border-blue-200/80 bg-blue-50 text-blue-950 dark:border-blue-400/25 dark:bg-blue-400/[0.14] dark:text-blue-100",
  emerald:
    "border-emerald-200/80 bg-emerald-50 text-emerald-950 dark:border-emerald-400/25 dark:bg-emerald-400/[0.14] dark:text-emerald-100",
  amber: "border-amber-200/80 bg-amber-50 text-amber-950 dark:border-amber-400/25 dark:bg-amber-400/[0.14] dark:text-amber-100",
  red: "border-red-200/80 bg-red-50 text-red-950 dark:border-red-400/25 dark:bg-red-400/[0.14] dark:text-red-100",
  violet: "border-violet-200/80 bg-violet-50 text-violet-950 dark:border-violet-400/25 dark:bg-violet-400/[0.14] dark:text-violet-100",
  cyan: "border-cyan-200/80 bg-cyan-50 text-cyan-950 dark:border-cyan-400/25 dark:bg-cyan-400/[0.14] dark:text-cyan-100",
  zinc: "border-zinc-200 bg-zinc-100/80 text-zinc-900 dark:border-zinc-600/40 dark:bg-zinc-700/30 dark:text-zinc-100",
};

const selectedEventColorClass: Record<CalendarEventColor, string> = {
  blue: "border-blue-500 bg-blue-100 text-blue-950 ring-2 ring-inset ring-blue-500/70 dark:border-blue-300/70 dark:bg-blue-400/30 dark:text-blue-50 dark:ring-blue-300/70",
  emerald:
    "border-emerald-500 bg-emerald-100 text-emerald-950 ring-2 ring-inset ring-emerald-500/70 dark:border-emerald-300/70 dark:bg-emerald-400/30 dark:text-emerald-50 dark:ring-emerald-300/70",
  amber:
    "border-amber-500 bg-amber-100 text-amber-950 ring-2 ring-inset ring-amber-500/70 dark:border-amber-300/70 dark:bg-amber-400/30 dark:text-amber-50 dark:ring-amber-300/70",
  red: "border-red-500 bg-red-100 text-red-950 ring-2 ring-inset ring-red-500/70 dark:border-red-300/70 dark:bg-red-400/30 dark:text-red-50 dark:ring-red-300/70",
  violet:
    "border-violet-500 bg-violet-100 text-violet-950 ring-2 ring-inset ring-violet-500/70 dark:border-violet-300/70 dark:bg-violet-400/30 dark:text-violet-50 dark:ring-violet-300/70",
  cyan: "border-cyan-500 bg-cyan-100 text-cyan-950 ring-2 ring-inset ring-cyan-500/70 dark:border-cyan-300/70 dark:bg-cyan-400/30 dark:text-cyan-50 dark:ring-cyan-300/70",
  zinc: "border-zinc-500 bg-zinc-200 text-zinc-950 ring-2 ring-inset ring-zinc-500/70 dark:border-zinc-300/60 dark:bg-zinc-600/55 dark:text-zinc-50 dark:ring-zinc-300/70",
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

const yearIndicatorClass = (isToday: boolean, color: CalendarEventColor): string => (isToday ? "bg-white" : dotClass[color]);

const parseDate = (value: Date | string): Date => {
  if (value instanceof Date) return new Date(value);
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const [year, month = "1", day = "1"] = value.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day), 12);
};

const validDate = (value: Date): boolean => !Number.isNaN(value.getTime());

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
  return zonedMinuteSlot(day, hour * 60, context);
};
const zonedMinuteSlot = (day: Date, minuteOfDay: number, context?: DateContext): Date => {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, minuteOfDay));
  const hour = Math.floor(bounded / 60);
  const minute = bounded % 60;
  const value = `${calendar.formatDateKey(day, context)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (!context?.timeZone) return parseDate(value);
  return new Date(calendar.zonedDateTimeToInstant(value, context.timeZone, { disambiguation: "compatible" }));
};
const normalizeEvents = (events: CalendarEvent[], context?: DateContext): NormalizedEvent[] =>
  events.flatMap((event) => {
    const startDate = parseDate(event.start);
    if (!validDate(startDate)) return [];
    const parsedEnd = event.end ? parseDate(event.end) : null;
    const endDate = parsedEnd && validDate(parsedEnd) ? parsedEnd : new Date(startDate.getTime() + 60 * 60 * 1000);
    const duration = Math.max(60 * 60 * 1000, endDate.getTime() - startDate.getTime());
    const rangeEnd = endDate > startDate ? endDate : new Date(startDate.getTime() + duration);
    const startKey = calendar.formatDateKey(startDate, context);
    const endKey = calendar.formatDateKey(rangeEnd, context);
    if (!event.allDay && startKey === endKey) {
      return [
        {
          ...event,
          startDate,
          endDate: rangeEnd,
          sourceStartDate: startDate,
          sourceEndDate: rangeEnd,
          dayKey: startKey,
        },
      ];
    }
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

const moveEventTo = (event: NormalizedEvent, target: Date, allDay = false, context?: DateContext): CalendarEventTimeChange => {
  const duration = Math.max(30 * 60 * 1000, event.sourceEndDate.getTime() - event.sourceStartDate.getTime());
  const start = allDay ? startOfDay(target, context) : new Date(target);
  start.setSeconds(0, 0);
  return { start, end: new Date(start.getTime() + duration), allDay };
};

const moveEventToDay = (event: NormalizedEvent, day: Date, context?: DateContext): CalendarEventTimeChange => {
  if (event.allDay) return moveEventTo(event, startOfDay(day, context), true, context);
  const localStart = context?.timeZone ? calendar.instantToZonedInput(event.sourceStartDate, context.timeZone) : null;
  const hour = localStart ? Number(localStart.slice(11, 13)) : event.sourceStartDate.getHours();
  const minute = localStart ? Number(localStart.slice(14, 16)) : event.sourceStartDate.getMinutes();
  return moveEventTo(event, zonedMinuteSlot(day, hour * 60 + minute, context), false, context);
};

const eventTimeChanged = (event: NormalizedEvent, next: CalendarEventTimeChange): boolean =>
  event.sourceStartDate.getTime() !== next.start.getTime() ||
  event.sourceEndDate.getTime() !== next.end.getTime() ||
  Boolean(event.allDay) !== Boolean(next.allDay);

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

  return groups.flatMap((group, groupId) => {
    const laneEnds: number[] = [];
    const assigned = group.map((event) => {
      const start = event.startDate.getTime();
      const lane = laneEnds.findIndex((end) => end <= start);
      const nextLane = lane >= 0 ? lane : laneEnds.length;
      laneEnds[nextLane] = event.endDate.getTime();
      return { event, lane: nextLane };
    });
    const lanes = Math.max(1, laneEnds.length);
    const groupStartDate = new Date(Math.min(...group.map((event) => event.startDate.getTime())));
    const groupEndDate = new Date(Math.max(...group.map((event) => event.endDate.getTime())));
    return assigned.map((item) => ({ ...item, lanes, groupId, groupStartDate, groupEndDate }));
  });
};

const EventChip = (props: {
  event: NormalizedEvent;
  owner: CalendarProps;
  href?: string;
  compact?: boolean;
  fill?: boolean;
  moving?: boolean;
  onMovePointerDown?: (event: PointerEvent, onActivate: () => void) => void;
}): JSX.Element => {
  const dateConfig = () => ownerDateConfig(props.owner);
  const color = () => props.event.color ?? "blue";
  const selected = () => Boolean(props.owner.selectedEventId) && props.owner.selectedEventId === props.event.id;
  const style = () =>
    props.event.colorHex
      ? {
          "background-color": `color-mix(in srgb, ${props.event.colorHex} ${selected() ? 32 : 21}%, var(--ui-surface-raised))`,
          "border-color": `color-mix(in srgb, ${props.event.colorHex} ${selected() ? 88 : 48}%, var(--ui-border))`,
          ...(selected() ? { "box-shadow": `0 0 0 2px color-mix(in srgb, ${props.event.colorHex} 78%, transparent)` } : {}),
        }
      : undefined;
  const isInteractive = () => Boolean(props.owner.onEventClick || props.owner.onEventDoubleClick);
  const className = () =>
    `block min-w-0 rounded-[var(--ui-radius-control)] border text-left leading-tight shadow-none transition-[background-color,border-color,box-shadow,filter,opacity] ${props.compact ? "px-1.5 py-1" : "px-2 py-1.5"} ${props.fill ? "h-full" : ""} ${props.moving ? "cursor-grabbing opacity-30" : isInteractive() ? "cursor-pointer" : ""} ${props.event.display === "background" ? "opacity-60" : ""} ${props.event.colorHex ? "text-primary" : selected() ? selectedEventColorClass[color()] : eventColorClass[color()]} ${selected() ? "" : "hover:brightness-[0.98] dark:hover:brightness-110"}`;
  const durationHours = () => (props.event.endDate.getTime() - props.event.startDate.getTime()) / 3_600_000;
  const showTime = () => !props.event.allDay && !props.compact && durationHours() >= 0.75;
  const showLocation = () => Boolean(props.event.location && !props.compact && durationHours() >= 1.25);
  const timeLabel = () => `${formatTime(props.event.startDate, dateConfig())} - ${formatTime(props.event.endDate, dateConfig())}`;
  const renderedEvent = () =>
    props.owner.renderEvent?.(props.event, {
      compact: props.compact ?? false,
      fill: props.fill ?? false,
      start: props.event.startDate,
      end: props.event.endDate,
      allDay: props.event.allDay ?? false,
      durationHours: durationHours(),
      timeLabel: timeLabel(),
    });
  const defaultContent = (
    <>
      <span class="block truncate text-[11px] font-semibold text-current">{props.event.title}</span>
      <Show when={showTime()}>
        <span class="block truncate text-[10px] text-current opacity-70">{timeLabel()}</span>
      </Show>
      <Show when={showLocation()}>
        <span class="block truncate text-[10px] text-current opacity-70">{props.event.location}</span>
      </Show>
    </>
  );
  const content = () => renderedEvent() ?? defaultContent;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  let suppressClickUntil = 0;
  onCleanup(() => {
    if (clickTimer) clearTimeout(clickTimer);
  });
  const onClick = (event: MouseEvent) => {
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
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
  const onButtonKeyDown = (event: KeyboardEvent) => {
    if (!isInteractive() || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    (props.owner.onEventClick ?? props.owner.onEventDoubleClick)?.(props.event);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    if (props.onMovePointerDown) event.stopPropagation();
    props.onMovePointerDown?.(event, () => {
      suppressClickUntil = performance.now() + 400;
    });
  };

  return props.href ? (
    <a
      href={props.href}
      class={className()}
      data-calendar-event=""
      data-space-item-id={props.event.dataSpaceItemId}
      style={style()}
      draggable={props.onMovePointerDown ? false : undefined}
      onClick={onClick}
      onDblClick={onDoubleClick}
      onDragStart={props.onMovePointerDown ? (event) => event.preventDefault() : undefined}
      onPointerDown={onPointerDown}
      aria-label={`${props.event.title}${props.event.allDay ? "" : `, ${formatTime(props.event.startDate, dateConfig())} to ${formatTime(props.event.endDate, dateConfig())}`}`}
    >
      {content()}
    </a>
  ) : (
    <div
      class={className()}
      data-calendar-event=""
      style={style()}
      role="button"
      tabIndex={isInteractive() ? 0 : undefined}
      onClick={onClick}
      onDblClick={onDoubleClick}
      onPointerDown={onPointerDown}
      onKeyDown={onButtonKeyDown}
      aria-label={`${props.event.title}${props.event.allDay ? "" : `, ${formatTime(props.event.startDate, dateConfig())} to ${formatTime(props.event.endDate, dateConfig())}`}`}
    >
      {content()}
    </div>
  );
};

const slotInteractionProps = (owner: CalendarProps, slot: () => CalendarEventTimeChange, suppressed?: () => boolean) => {
  const isSlotChild = (event: MouseEvent) =>
    event.target instanceof Element && Boolean(event.target.closest("a,button,[data-calendar-event]"));
  return {
    onClick: (event: MouseEvent) => {
      if (!owner.onSlotClick || isSlotChild(event) || suppressed?.()) return;
      owner.onSlotClick(slot());
    },
    onDblClick: (event: MouseEvent) => {
      if (!owner.onSlotDoubleClick || isSlotChild(event) || suppressed?.()) return;
      owner.onSlotDoubleClick(slot());
    },
  };
};

type CalendarNavigationLinkProps = ParentProps<{
  owner: CalendarProps;
  href: string;
  anchorProps?: Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "href" | "onClick"> & {
    "data-divider"?: string;
  };
}>;

/** A real anchor is the baseline; the optional handler only enhances it after hydration. */
const CalendarNavigationLink = (props: CalendarNavigationLinkProps): JSX.Element => {
  const preload = () => props.owner.onPrefetch?.(props.href);
  const navigateHref: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    const anchor = event.currentTarget;
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (anchor.target && anchor.target !== "_self") ||
      anchor.hasAttribute("download") ||
      new URL(anchor.href).origin !== window.location.origin
    ) {
      return;
    }
    event.preventDefault();
    props.owner.onNavigateHref?.(props.href);
  };
  return props.owner.onNavigateHref ? (
    <a {...props.anchorProps} href={props.href} onClick={navigateHref} onPointerEnter={preload} onFocus={preload}>
      {props.children}
    </a>
  ) : props.owner.onNavigate ? (
    <Link
      {...props.anchorProps}
      href={props.href}
      scroll="preserve"
      onNavigate={props.owner.onNavigate}
      onPointerEnter={preload}
      onFocus={preload}
    >
      {props.children}
    </Link>
  ) : (
    <a {...props.anchorProps} href={props.href} onPointerEnter={preload} onFocus={preload}>
      {props.children}
    </a>
  );
};

const CalendarViewLinks = (props: {
  owner: CalendarProps;
  view: CalendarView;
  options: Array<{ value: CalendarView; label: string }>;
}): JSX.Element => {
  const refs: HTMLAnchorElement[] = [];
  const selectRelative = (currentIndex: number, direction: -1 | 1) => {
    if (props.options.length === 0) return;
    refs[(currentIndex + direction + props.options.length) % props.options.length]?.click();
  };
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectRelative(index, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectRelative(index, -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      refs[event.key === "Home" ? 0 : props.options.length - 1]?.click();
    }
  };

  return (
    <div role="radiogroup" aria-label="Calendar view" aria-orientation="horizontal" class="segmented-control">
      <For each={props.options}>
        {(option, index) => {
          const active = () => (props.view === "mobile-month" ? "month" : props.view) === option.value;
          const href = () => props.owner.getViewHref?.(option.value) ?? "#";
          return (
            <CalendarNavigationLink
              owner={props.owner}
              href={href()}
              anchorProps={{
                ref: (element) => {
                  refs[index()] = element;
                },
                role: "radio",
                "aria-checked": active(),
                tabIndex: active() ? 0 : -1,
                class: "segmented-control-item",
                "data-divider":
                  index() < props.options.length - 1 &&
                  !active() &&
                  (props.view === "mobile-month" ? "month" : props.view) !== props.options[index() + 1]?.value
                    ? "true"
                    : undefined,
                onKeyDown: (event) => onKeyDown(event, index()),
              }}
            >
              {option.label}
            </CalendarNavigationLink>
          );
        }}
      </For>
    </div>
  );
};

const adjacentCalendarDate = (date: Date, view: CalendarView, direction: -1 | 1, dateConfig: DateContext) => {
  if (view === "year") return calendar.addMonths(date, direction * 12, dateConfig);
  if (view === "month" || view === "mobile-month") return calendar.addMonths(date, direction, dateConfig);
  return calendar.addDays(date, direction * (view === "day" ? 1 : 7), dateConfig);
};

const calendarViews = ["day", "week", "month", "year"] as const satisfies readonly CalendarView[];

const CalendarHeader = (props: { date: Date; view: CalendarView; labels: Required<CalendarLabels>; owner: CalendarProps }): JSX.Element => {
  const dateConfig = () => ownerDateConfig(props.owner);
  const previous = () => adjacentCalendarDate(props.date, props.view, -1, dateConfig());
  const next = () => adjacentCalendarDate(props.date, props.view, 1, dateConfig());
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
    return (props.owner.onNavigateHref || props.owner.onNavigate) && href ? (
      <CalendarNavigationLink
        owner={props.owner}
        href={href}
        anchorProps={{ "aria-label": label, title: label, class: "btn-segment-icon" }}
      >
        <i class={`ti ${icon}`} />
      </CalendarNavigationLink>
    ) : props.owner.onDateChange ? (
      <button type="button" aria-label={label} class="btn-segment-icon" onClick={() => goDate(date)}>
        <i class={`ti ${icon}`} />
      </button>
    ) : (
      <CalendarNavigationLink
        owner={props.owner}
        href={href ?? "#"}
        anchorProps={{ "aria-label": label, title: label, class: "btn-segment-icon" }}
      >
        <i class={`ti ${icon}`} />
      </CalendarNavigationLink>
    );
  };
  const todayButton = () => {
    const today = calendar.today(dateConfig());
    const href = props.owner.getDateHref?.(today, props.view);
    return (props.owner.onNavigateHref || props.owner.onNavigate) && href ? (
      <CalendarNavigationLink owner={props.owner} href={href} anchorProps={{ class: "btn-secondary btn-sm shrink-0 whitespace-nowrap" }}>
        {props.labels.today}
      </CalendarNavigationLink>
    ) : props.owner.onDateChange ? (
      <button type="button" class="btn-secondary btn-sm shrink-0 whitespace-nowrap" onClick={() => goDate(today)}>
        {props.labels.today}
      </button>
    ) : (
      <CalendarNavigationLink
        owner={props.owner}
        href={href ?? "#"}
        anchorProps={{ class: "btn-secondary btn-sm shrink-0 whitespace-nowrap" }}
      >
        {props.labels.today}
      </CalendarNavigationLink>
    );
  };
  const viewOptions = () =>
    (
      [
        { value: "day", label: props.labels.day },
        { value: "week", label: props.labels.week },
        { value: "month", label: props.labels.month },
        { value: "year", label: props.labels.year },
      ] satisfies Array<{ value: CalendarView; label: string }>
    ).filter((option) => !props.owner.views || props.owner.views.includes(option.value));

  return (
    <header class="relative flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 bg-white p-2 dark:border-zinc-800/70 dark:bg-zinc-900">
      <div class="flex min-w-0 items-center gap-1.5">
        {navButton(previous(), "ti-chevron-left", props.labels.previous)}
        {navButton(next(), "ti-chevron-right", props.labels.next)}
        <div class="min-w-0 truncate px-2 text-sm font-semibold text-primary sm:min-w-36 sm:text-base">{title()}</div>
      </div>
      <div class="flex w-full items-center justify-end gap-2 sm:w-auto">
        {todayButton()}
        <Show
          when={!props.owner.onViewChange && props.owner.getViewHref}
          fallback={
            <SegmentedControl
              value={() => (props.view === "mobile-month" ? "month" : props.view)}
              onChange={goView}
              ariaLabel="Calendar view"
              options={viewOptions()}
            />
          }
        >
          <CalendarViewLinks owner={props.owner} view={props.view} options={viewOptions()} />
        </Show>
        {props.owner.toolbarActions}
      </div>
      <Show when={props.owner.navigationPending}>
        <span class="calendar-navigation-progress" aria-hidden="true" />
      </Show>
    </header>
  );
};

const MonthView = (props: {
  owner: CalendarProps;
  date: Date;
  now: Date;
  events: NormalizedEvent[];
  labels: Required<CalendarLabels>;
}): JSX.Element => {
  const dateConfig = () => ownerDateConfig(props.owner);
  const [movePreview, setMovePreview] = createSignal<CalendarPreview | null>(null);
  const [movingEventId, setMovingEventId] = createSignal("");
  let cancelInteraction: (() => void) | undefined;
  let suppressSlotClickUntil = 0;
  const month = () => zonedYearMonth(props.date, dateConfig());
  const weeks = () => calendar.getMonthGrid(month().year, month().month, dateConfig());
  const weekdays = () => calendar.weekdays(dateConfig());
  const todayKey = () => calendar.formatDateKey(props.now, dateConfig());
  const eventsByDay = createMemo(() => {
    const grouped = new Map<string, NormalizedEvent[]>();
    for (const event of props.events) {
      const events = grouped.get(event.dayKey);
      if (events) events.push(event);
      else grouped.set(event.dayKey, [event]);
    }
    return grouped;
  });
  const clearMove = () => {
    setMovePreview(null);
    setMovingEventId("");
  };
  const dayAtPoint = (clientX: number, clientY: number): Date | null => {
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-calendar-day-key]");
    const dayKey = target?.dataset.calendarDayKey;
    return dayKey ? calendar.parseCalendarDate(dayKey, dateConfig()) : null;
  };
  const startMove = (pointerEvent: PointerEvent, event: NormalizedEvent, markDragged: () => void) => {
    if (!props.owner.onEventDrop) return;
    cancelInteraction?.();
    cancelInteraction = startCalendarPointerSession({
      event: pointerEvent,
      resolve: (clientX, clientY) => {
        const day = dayAtPoint(clientX, clientY);
        return day ? { id: event.id, ...moveEventToDay(event, day, dateConfig()) } : null;
      },
      onActivate: () => {
        markDragged();
        suppressSlotClickUntil = performance.now() + 400;
        setMovingEventId(event.id);
      },
      onPreview: setMovePreview,
      onCommit: (next) => {
        clearMove();
        if (eventTimeChanged(event, next)) props.owner.onEventDrop?.(event, next);
      },
      onCancel: clearMove,
    });
  };
  onCleanup(() => cancelInteraction?.());
  return (
    <div class="grid h-full min-h-[36rem]" style={{ "grid-template-rows": `auto repeat(${weeks().length}, minmax(5rem, 1fr))` }}>
      <div
        class={`grid ${props.owner.withWeekNumbers ? "grid-cols-[3rem_repeat(7,minmax(0,1fr))]" : "grid-cols-7"} border-b border-zinc-100 bg-white dark:border-zinc-800/70 dark:bg-zinc-900`}
      >
        <Show when={props.owner.withWeekNumbers}>
          <div class="px-2 py-2 text-center text-[11px] font-semibold text-dimmed">Wk</div>
        </Show>
        <For each={weekdays()}>{(day) => <div class="px-2 py-2 text-center text-[11px] font-semibold text-dimmed">{day}</div>}</For>
      </div>
      <For each={weeks()}>
        {(week) => (
          <div
            class={`grid min-h-0 border-b border-zinc-100 last:border-b-0 dark:border-zinc-800/70 ${props.owner.withWeekNumbers ? "grid-cols-[3rem_repeat(7,minmax(0,1fr))]" : "grid-cols-7"} divide-x divide-zinc-100 dark:divide-zinc-800/70`}
          >
            <Show when={props.owner.withWeekNumbers}>
              <div class="flex items-start justify-center px-2 py-2 text-xs font-semibold text-dimmed">
                {zonedWeekNumber(week[0]!, dateConfig())}
              </div>
            </Show>
            <For each={week}>
              {(day) => {
                const dayKey = calendar.formatDateKey(day, dateConfig());
                const events = eventsByDay().get(dayKey) ?? [];
                const href = props.owner.getDateHref?.(day, "day");
                const dayBadge = props.owner.dayBadges?.[dayKey];
                const sameMonth = calendar.isSameMonth(day, props.date, dateConfig());
                const isToday = dayKey === todayKey();
                return (
                  <div
                    class={`relative min-w-0 p-1.5 ${sameMonth ? "" : "bg-zinc-50/60 dark:bg-zinc-950/25"}`}
                    data-calendar-day-key={dayKey}
                    classList={{
                      "bg-blue-500/10 ring-1 ring-inset ring-blue-400": movePreview()?.start
                        ? calendar.formatDateKey(movePreview()!.start, dateConfig()) === dayKey
                        : false,
                      "cursor-pointer hover:bg-blue-500/5": Boolean(props.owner.onSlotClick || props.owner.onSlotDoubleClick),
                    }}
                    {...slotInteractionProps(
                      props.owner,
                      () => {
                        const start = startOfDay(day, dateConfig());
                        return { start, end: calendar.addDays(start, 1, dateConfig()), allDay: true };
                      },
                      () => performance.now() < suppressSlotClickUntil,
                    )}
                  >
                    <div class="flex items-center gap-1">
                      <a
                        href={href ?? "#"}
                        class={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${
                          isToday ? "bg-blue-500 text-white" : sameMonth ? "text-primary" : "text-dimmed"
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
                      <Show when={movePreview() && calendar.formatDateKey(movePreview()!.start, dateConfig()) === dayKey}>
                        <div class="rounded-md border border-dashed border-blue-500 bg-blue-500/10 px-1 py-1 text-[10px] font-semibold text-blue-700 dark:text-blue-200">
                          {props.events.find((event) => event.id === movePreview()!.id)?.title ?? "Move event"}
                        </div>
                      </Show>
                      <For each={events.slice(0, 3)}>
                        {(event) => (
                          <EventChip
                            event={event}
                            owner={props.owner}
                            href={eventHref(props.owner, event)}
                            compact
                            moving={movingEventId() === event.id}
                            onMovePointerDown={
                              props.owner.onEventDrop
                                ? (pointerEvent, markDragged) => startMove(pointerEvent, event, markDragged)
                                : undefined
                            }
                          />
                        )}
                      </For>
                      <Show when={events.length > 3}>
                        <CalendarNavigationLink
                          owner={props.owner}
                          href={href ?? "#"}
                          anchorProps={{ class: "px-1 text-[11px] font-medium text-dimmed hover:text-primary" }}
                        >
                          +{events.length - 3} more
                        </CalendarNavigationLink>
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
  );
};

const TimeGridView = (props: {
  owner: CalendarProps;
  date: Date;
  now: Date;
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
  const [timePreview, setTimePreview] = createSignal<CalendarPreview | null>(null);
  const [movingEventId, setMovingEventId] = createSignal("");
  const [expandedOverflow, setExpandedOverflow] = createSignal("");
  let scrollContainer: HTMLDivElement | undefined;
  let timeGrid: HTMLDivElement | undefined;
  let timeGutter: HTMLDivElement | undefined;
  let defaultHourMarker: HTMLDivElement | undefined;
  let cancelInteraction: (() => void) | undefined;
  let suppressSlotClickUntil = 0;
  const slotEnd = (start: Date) => addMinutes(start, 60);
  const previewEvents = () => previewSegments(timePreview(), props.days, dateConfig());
  const clearInteraction = () => {
    setTimePreview(null);
    setMovingEventId("");
  };
  const dayAtPoint = (clientX: number, clientY: number): Date | null => {
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-calendar-day-key]");
    const dayKey = target?.dataset.calendarDayKey;
    return dayKey ? calendar.parseCalendarDate(dayKey, dateConfig()) : null;
  };
  const timeAtPoint = (clientX: number, clientY: number): Date | null => {
    if (!timeGrid || !timeGutter) return null;
    const gridRect = timeGrid.getBoundingClientRect();
    const gutterRect = timeGutter.getBoundingClientRect();
    const dayIndex = calendarDayIndexAtPoint(clientX, gutterRect.right, gridRect.right - gutterRect.right, props.days.length);
    if (dayIndex === null) return null;
    const minute = Math.min(
      gridEndHour() * 60 + 45,
      calendarMinuteAtPoint(clientY, gridRect.top, gridRect.height, gridStartHour(), gridEndHour()),
    );
    return zonedMinuteSlot(props.days[dayIndex]!, minute, dateConfig());
  };
  const beginInteraction = (options: Parameters<typeof startCalendarPointerSession<CalendarPreview>>[0]) => {
    cancelInteraction?.();
    cancelInteraction = startCalendarPointerSession(options);
  };
  const startTimedMove = (pointerEvent: PointerEvent, event: NormalizedEvent, markDragged: () => void) => {
    if (!props.owner.onEventDrop) return;
    const pointerStart = timeAtPoint(pointerEvent.clientX, pointerEvent.clientY) ?? event.sourceStartDate;
    const duration = Math.max(15 * 60_000, event.sourceEndDate.getTime() - event.sourceStartDate.getTime());
    const offsetMinutes = Math.max(
      0,
      Math.min(duration / 60_000, Math.round((pointerStart.getTime() - event.sourceStartDate.getTime()) / 900_000) * 15),
    );
    beginInteraction({
      event: pointerEvent,
      scrollContainer,
      resolve: (clientX, clientY) => {
        const pointer = timeAtPoint(clientX, clientY);
        if (!pointer) return null;
        const start = new Date(pointer.getTime() - offsetMinutes * 60_000);
        return { id: event.id, start, end: new Date(start.getTime() + duration), allDay: false };
      },
      onActivate: () => {
        markDragged();
        suppressSlotClickUntil = performance.now() + 400;
        setMovingEventId(event.id);
      },
      onPreview: setTimePreview,
      onCommit: (next) => {
        clearInteraction();
        if (eventTimeChanged(event, next)) props.owner.onEventDrop?.(event, next);
      },
      onCancel: clearInteraction,
    });
  };
  const startAllDayMove = (pointerEvent: PointerEvent, event: NormalizedEvent, markDragged: () => void) => {
    if (!props.owner.onEventDrop) return;
    beginInteraction({
      event: pointerEvent,
      resolve: (clientX, clientY) => {
        const day = dayAtPoint(clientX, clientY);
        return day ? { id: event.id, ...moveEventTo(event, startOfDay(day, dateConfig()), true, dateConfig()) } : null;
      },
      onActivate: () => {
        markDragged();
        suppressSlotClickUntil = performance.now() + 400;
        setMovingEventId(event.id);
      },
      onPreview: setTimePreview,
      onCommit: (next) => {
        clearInteraction();
        if (eventTimeChanged(event, next)) props.owner.onEventDrop?.(event, next);
      },
      onCancel: clearInteraction,
    });
  };
  const startRange = (pointerEvent: PointerEvent) => {
    if (!props.owner.onSlotClick || pointerEvent.pointerType === "touch") return;
    const anchor = timeAtPoint(pointerEvent.clientX, pointerEvent.clientY);
    if (!anchor) return;
    beginInteraction({
      event: pointerEvent,
      scrollContainer,
      resolve: (clientX, clientY) => {
        const current = timeAtPoint(clientX, clientY);
        if (!current) return null;
        const start = current < anchor ? current : anchor;
        const endBase = current < anchor ? anchor : current;
        return { id: "calendar-create-preview", start, end: addMinutes(endBase, 15), allDay: false };
      },
      onActivate: () => {
        suppressSlotClickUntil = performance.now() + 400;
      },
      onPreview: setTimePreview,
      onCommit: (next) => {
        clearInteraction();
        props.owner.onSlotClick?.(next);
      },
      onCancel: clearInteraction,
    });
  };
  const timeRangeLayout = (startDate: Date, endDate: Date) => {
    const start = zonedHour(startDate, dateConfig());
    const end = zonedHour(endDate, dateConfig());
    const visibleStart = Math.max(gridStartHour(), start);
    const visibleEnd = Math.min(gridEndHour() + 1, end);
    const total = Math.max(1, gridEndHour() - gridStartHour() + 1);
    return {
      top: Math.max(0, ((visibleStart - gridStartHour()) / total) * 100),
      height: Math.max(1.25, ((visibleEnd - visibleStart) / total) * 100),
    };
  };
  const eventLayout = (event: NormalizedEvent) => timeRangeLayout(event.startDate, event.endDate);
  const isDayView = () => props.days.length === 1;
  const visibleLaneCount = (lanes: number) => (isDayView() ? lanes : Math.min(lanes, 3));
  const overflowLayouts = (layouts: TimedEventLayout[]): TimedOverflowLayout[] => {
    if (isDayView()) return [];
    const groups = new Map<number, TimedOverflowLayout>();
    for (const layout of layouts) {
      if (layout.lane < visibleLaneCount(layout.lanes)) continue;
      const existing = groups.get(layout.groupId);
      if (existing) existing.hiddenEvents.push(layout.event);
      else
        groups.set(layout.groupId, {
          groupId: layout.groupId,
          hiddenEvents: [layout.event],
          groupStartDate: layout.groupStartDate,
          groupEndDate: layout.groupEndDate,
        });
    }
    return [...groups.values()];
  };
  const dayColumnMinWidth = (layouts: TimedEventLayout[]) => {
    if (!isDayView()) return undefined;
    const lanes = Math.max(1, ...layouts.map((layout) => layout.lanes));
    return `${Math.max(32, lanes * 12)}rem`;
  };
  const laneStyle = (layoutItem: TimedEventLayout) => {
    if (isDayView()) {
      const laneWidth = 100 / layoutItem.lanes;
      return {
        left: `calc(${layoutItem.lane * laneWidth}% + 0.25rem)`,
        width: `calc(${laneWidth}% - 0.5rem)`,
      };
    }
    const visibleLanes = visibleLaneCount(layoutItem.lanes);
    return {
      left: `${layoutItem.lanes <= 1 ? 0 : (28 / Math.max(1, visibleLanes - 1)) * layoutItem.lane}%`,
      width: `${layoutItem.lanes <= 1 ? 100 : layoutItem.lanes > visibleLanes ? 68 : 72}%`,
    };
  };
  const currentTimeLine = (day: Date) => {
    const now = props.now;
    if (calendar.formatDateKey(day, dateConfig()) !== calendar.formatDateKey(now, dateConfig())) return null;
    const hour = zonedHour(now, dateConfig());
    if (hour < gridStartHour() || hour > gridEndHour() + 1) return null;
    return ((hour - gridStartHour()) / Math.max(1, gridEndHour() - gridStartHour() + 1)) * 100;
  };
  onCleanup(() => cancelInteraction?.());
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
        class="grid border-b border-zinc-100 bg-white dark:border-zinc-800/70 dark:bg-zinc-900"
        style={{ "grid-template-columns": `4rem repeat(${props.days.length}, minmax(0, 1fr))` }}
      >
        <div />
        <For each={props.days}>
          {(day) => {
            const dayBadge = props.owner.dayBadges?.[calendar.formatDateKey(day, dateConfig())];
            const today = () => calendar.isToday(day, dateConfig());
            return (
              <CalendarNavigationLink
                owner={props.owner}
                href={props.owner.getDateHref?.(day, "day") ?? "#"}
                anchorProps={{ class: "px-2 py-2 text-center text-[11px] font-semibold text-primary hover:text-blue-500" }}
              >
                <span
                  classList={{
                    "inline-flex rounded-full bg-blue-600 px-2.5 py-0.5 text-white": today(),
                  }}
                >
                  {formatDay(day, dateConfig())}
                </span>
                <Show when={dayBadge}>
                  {(badge) => (
                    <span class="mt-0.5 flex items-center justify-center gap-0.5 text-[10px] font-medium text-dimmed">
                      <Show when={badge().icon}>{(icon) => <i class={`ti ti-${icon()} text-[10px]`} />}</Show>
                      {badge().label}
                    </span>
                  )}
                </Show>
              </CalendarNavigationLink>
            );
          }}
        </For>
      </div>
      <Show when={!props.owner.hideAllDay}>
        <div
          class="grid overflow-y-auto border-b border-zinc-200/80 bg-zinc-50/65 dark:border-zinc-800/80 dark:bg-zinc-950/40"
          style={{
            "grid-template-columns": `4rem repeat(${props.days.length}, minmax(0, 1fr))`,
            "max-height": `${props.owner.allDayMaxHeightRem ?? 7}rem`,
          }}
        >
          <div class="sticky top-0 bg-inherit px-2 py-2 text-center text-[11px] font-semibold text-dimmed">{props.labels.allDay}</div>
          <For each={props.days}>
            {(day) => {
              const dayKey = calendar.formatDateKey(day, dateConfig());
              const allDay = () => props.events.filter((event) => event.dayKey === dayKey && event.allDay);
              const previewAllDay = previewEvents().filter((event) => event.dayKey === dayKey && event.allDay);
              return (
                <div
                  class="min-h-10 border-r border-zinc-100 p-1 dark:border-zinc-800/70"
                  data-calendar-day-key={dayKey}
                  classList={{
                    "rounded bg-blue-500/10 ring-1 ring-inset ring-blue-400": timePreview()?.allDay
                      ? calendar.formatDateKey(timePreview()!.start, dateConfig()) === dayKey
                      : false,
                    "cursor-pointer hover:bg-blue-500/5": Boolean(props.owner.onSlotClick || props.owner.onSlotDoubleClick),
                  }}
                  {...slotInteractionProps(
                    props.owner,
                    () => {
                      const start = startOfDay(day, dateConfig());
                      return { start, end: calendar.addDays(start, 1, dateConfig()), allDay: true };
                    },
                    () => performance.now() < suppressSlotClickUntil,
                  )}
                >
                  <div class="flex flex-col gap-1">
                    <For each={previewAllDay}>
                      {(event) => (
                        <div class="rounded-lg border border-dashed border-blue-500 bg-blue-500/10 px-1.5 py-1 text-[10px] font-semibold text-blue-600">
                          {event.title}
                        </div>
                      )}
                    </For>
                    <For each={allDay()}>
                      {(event) => (
                        <EventChip
                          event={event}
                          owner={props.owner}
                          href={eventHref(props.owner, event)}
                          compact
                          moving={movingEventId() === event.id}
                          onMovePointerDown={
                            props.owner.onEventDrop
                              ? (pointerEvent, markDragged) => startAllDayMove(pointerEvent, event, markDragged)
                              : undefined
                          }
                        />
                      )}
                    </For>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
      <div ref={scrollContainer} class="min-h-0 flex-1 overflow-auto bg-white dark:bg-zinc-900">
        <div
          ref={timeGrid}
          class="grid min-h-full"
          style={{ "grid-template-columns": `4rem repeat(${props.days.length}, minmax(0, 1fr))` }}
        >
          <div
            ref={timeGutter}
            class="grid border-r border-zinc-100 dark:border-zinc-800/70"
            style={{ "grid-template-rows": `repeat(${hours().length}, minmax(4rem, 1fr))` }}
          >
            <For each={hours()}>
              {(hour) => (
                <div
                  ref={(element) => {
                    if (hour === businessStartHour()) defaultHourMarker = element;
                  }}
                  class="min-h-16 border-b border-zinc-100 bg-zinc-50/60 pr-2 pt-1 text-right text-[11px] text-dimmed dark:border-zinc-800/70 dark:bg-zinc-950/35"
                  classList={{ "bg-zinc-100/70 dark:bg-zinc-950/70": hour < businessStartHour() || hour > businessEndHour() }}
                >
                  {`${hour}`.padStart(2, "0")}:00
                </div>
              )}
            </For>
          </div>
          <For each={props.days}>
            {(day) => {
              const dayKey = calendar.formatDateKey(day, dateConfig());
              const timed = () => props.events.filter((event) => event.dayKey === dayKey && !event.allDay);
              const layouts = () => timedEventLayouts(timed());
              return (
                <div
                  class="relative grid min-h-full border-r border-zinc-100 dark:border-zinc-800/70"
                  style={{
                    "min-width": dayColumnMinWidth(layouts()),
                    "grid-template-rows": `repeat(${hours().length}, minmax(4rem, 1fr))`,
                  }}
                >
                  <Show when={currentTimeLine(day) !== null}>
                    <div
                      class="pointer-events-none absolute inset-x-0 z-40 border-t border-red-500"
                      style={{ top: `${currentTimeLine(day) ?? 0}%` }}
                    />
                  </Show>
                  <For each={hours()}>
                    {(hour) => (
                      <div
                        class="relative min-h-16 border-b border-zinc-100 dark:border-zinc-800/70"
                        classList={{
                          "bg-zinc-50/70 dark:bg-zinc-950/45": hour < businessStartHour() || hour > businessEndHour(),
                          "cursor-pointer hover:bg-blue-500/5": Boolean(props.owner.onSlotClick || props.owner.onSlotDoubleClick),
                        }}
                        {...slotInteractionProps(
                          props.owner,
                          () => {
                            const start = zonedSlot(day, hour, dateConfig());
                            return { start, end: slotEnd(start), allDay: false };
                          },
                          () => performance.now() < suppressSlotClickUntil,
                        )}
                        onPointerDown={startRange}
                      />
                    )}
                  </For>
                  <For each={previewEvents().filter((event) => event.dayKey === dayKey && !event.allDay)}>
                    {(event) => {
                      const layout = eventLayout(event);
                      return (
                        <div
                          class="pointer-events-none absolute inset-x-1.5 z-30 rounded-lg border border-dashed border-blue-500 bg-blue-500/10"
                          style={{ top: `${layout.top}%`, height: `${layout.height}%` }}
                        >
                          <div class="px-2 py-1 text-[10px] font-semibold text-blue-600">
                            {formatTime(event.startDate, dateConfig())} - {formatTime(event.endDate, dateConfig())}
                          </div>
                        </div>
                      );
                    }}
                  </For>
                  <For each={layouts()}>
                    {(layoutItem) => {
                      if (!isDayView() && layoutItem.lane >= visibleLaneCount(layoutItem.lanes)) return null;
                      const event = layoutItem.event;
                      const layout = eventLayout(event);
                      const position = laneStyle(layoutItem);
                      const resizeStart = (pointerEvent: PointerEvent) => {
                        if (!props.owner.onEventResize) return;
                        pointerEvent.preventDefault();
                        pointerEvent.stopPropagation();
                        beginInteraction({
                          event: pointerEvent,
                          scrollContainer,
                          threshold: 1,
                          resolve: (clientX, clientY) => {
                            const pointer = timeAtPoint(clientX, clientY);
                            if (!pointer) return null;
                            const minimumEnd = addMinutes(event.sourceStartDate, 15);
                            const end = pointer > minimumEnd ? pointer : minimumEnd;
                            return { id: event.id, start: event.sourceStartDate, end, allDay: false };
                          },
                          onActivate: () => {
                            suppressSlotClickUntil = performance.now() + 400;
                            setMovingEventId(event.id);
                          },
                          onPreview: setTimePreview,
                          onCommit: (next) => {
                            clearInteraction();
                            if (eventTimeChanged(event, next)) props.owner.onEventResize?.(event, next);
                          },
                          onCancel: clearInteraction,
                        });
                      };
                      return (
                        <div
                          class="absolute"
                          style={{
                            top: `${layout.top}%`,
                            height: `${layout.height}%`,
                            left: position.left,
                            width: position.width,
                            "z-index": String(20 + layoutItem.lane),
                          }}
                        >
                          <div class="group relative h-full">
                            <EventChip
                              event={event}
                              owner={props.owner}
                              href={eventHref(props.owner, event)}
                              fill
                              moving={movingEventId() === event.id}
                              onMovePointerDown={
                                props.owner.onEventDrop
                                  ? (pointerEvent, markDragged) => startTimedMove(pointerEvent, event, markDragged)
                                  : undefined
                              }
                            />
                            <Show when={props.owner.onEventResize}>
                              <button
                                type="button"
                                aria-label="Resize event"
                                draggable={false}
                                class="absolute inset-x-2 bottom-0 z-20 flex h-2 cursor-ns-resize items-center justify-center rounded-full bg-blue-100/90 text-blue-600 opacity-0 backdrop-blur transition-opacity group-hover:opacity-90 focus:opacity-100 hover:opacity-100 dark:bg-blue-500/20 dark:text-blue-200"
                                onPointerDown={resizeStart}
                                onDragStart={(event) => event.preventDefault()}
                              >
                                <i class="pointer-events-none ti ti-grip-horizontal text-[10px] leading-none" />
                              </button>
                            </Show>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                  <For each={overflowLayouts(layouts())}>
                    {(overflow) => {
                      const layout = timeRangeLayout(overflow.groupStartDate, overflow.groupEndDate);
                      const key = `${dayKey}-${overflow.groupId}`;
                      const hiddenTitle = () =>
                        overflow.hiddenEvents.map((event) => `${formatTime(event.startDate, dateConfig())} ${event.title}`).join("\n");
                      return (
                        <>
                          <button
                            type="button"
                            class="absolute right-1 z-50 flex min-h-9 w-7 items-center justify-center rounded-lg border border-blue-500/35 bg-blue-500/10 text-[10px] font-black text-blue-700 transition-colors hover:bg-blue-500/15 dark:border-blue-300/30 dark:bg-blue-400/10 dark:text-blue-200 dark:hover:bg-blue-400/15"
                            style={{ top: `${layout.top}%`, height: `${layout.height}%` }}
                            title={hiddenTitle()}
                            aria-label={`${overflow.hiddenEvents.length} hidden overlapping events`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpandedOverflow(expandedOverflow() === key ? "" : key);
                            }}
                          >
                            <span class="[writing-mode:vertical-rl]">+{overflow.hiddenEvents.length}</span>
                          </button>
                          <Show when={expandedOverflow() === key}>
                            <div
                              class="absolute right-9 z-[70] flex w-56 flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-950"
                              style={{ top: `${layout.top}%` }}
                            >
                              <div class="px-1 pb-1 text-[10px] font-semibold text-dimmed">
                                {formatTime(overflow.groupStartDate, dateConfig())} - {formatTime(overflow.groupEndDate, dateConfig())}
                              </div>
                              <For each={overflow.hiddenEvents}>
                                {(event) => <EventChip event={event} owner={props.owner} href={eventHref(props.owner, event)} compact />}
                              </For>
                            </div>
                          </Show>
                        </>
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

const YearView = (props: { owner: CalendarProps; date: Date; now: Date; events: NormalizedEvent[] }): JSX.Element => (
  <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
    <For
      each={Array.from({ length: 12 }, (_, month) =>
        zonedMonthDate(zonedYearMonth(props.date, ownerDateConfig(props.owner)).year, month, ownerDateConfig(props.owner)),
      )}
    >
      {(monthDate) => (
        <div class="rounded-[var(--ui-radius-surface)] bg-[var(--ui-surface-subtle)] p-3">
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
                .flat()}
            >
              {(day) => {
                const dateConfig = ownerDateConfig(props.owner);
                const events = props.events.filter((event) => event.dayKey === calendar.formatDateKey(day, dateConfig));
                const isToday = calendar.formatDateKey(day, dateConfig) === calendar.formatDateKey(props.now, dateConfig);
                return (
                  <CalendarNavigationLink
                    owner={props.owner}
                    href={props.owner.getDateHref?.(day, "day") ?? "#"}
                    anchorProps={{
                      class: `relative flex aspect-square items-center justify-center rounded-md ${isToday ? "bg-blue-500 text-white" : calendar.isSameMonth(day, monthDate, dateConfig) ? "text-primary hover:bg-zinc-100 dark:hover:bg-zinc-800" : "text-zinc-300 dark:text-zinc-700"}`,
                    }}
                  >
                    {calendar.formatDayNumber(day, dateConfig)}
                    <Show when={events.length > 0}>
                      <span
                        class={`absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${events[0]!.colorHex ? "" : yearIndicatorClass(isToday, events[0]!.color ?? "blue")}`}
                        style={events[0]!.colorHex ? { "background-color": isToday ? "white" : events[0]!.colorHex } : undefined}
                      />
                    </Show>
                  </CalendarNavigationLink>
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
  now: Date;
  selectedDate: Date;
  events: NormalizedEvent[];
  labels: Required<CalendarLabels>;
}): JSX.Element => {
  const dateConfig = () => ownerDateConfig(props.owner);
  const selectedEvents = () => props.events.filter((event) => event.dayKey === calendar.formatDateKey(props.selectedDate, dateConfig()));
  return (
    <div class="mx-auto max-w-md p-3">
      <MonthView
        owner={{ ...props.owner, withWeekNumbers: false }}
        date={props.date}
        now={props.now}
        events={props.events}
        labels={props.labels}
      />
      <div class="mt-4 rounded-[var(--ui-radius-surface)] bg-[var(--ui-surface-subtle)] p-3">
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

const CalendarBody = (props: { children: JSX.Element }): JSX.Element => (
  <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{props.children}</div>
);

const Calendar = (props: CalendarProps): JSX.Element => {
  const view = () => props.view ?? "month";
  const dateConfig = () => ownerDateConfig(props);
  const safeDate = (value: Date | string) => {
    const parsed = parseDate(value);
    return validDate(parsed) ? parsed : calendar.today(dateConfig());
  };
  const date = () => safeDate(props.date);
  const selectedDate = () => safeDate(props.selectedDate ?? props.date);
  const [now, setNow] = createSignal(new Date());
  const normalizedEvents = () => normalizeEvents(props.events, dateConfig());
  const mergedLabels = () => ({ ...labels, ...props.labels });
  const days = () => {
    if (view() === "day") return [date()];
    return calendar.getWeekDays(date(), dateConfig());
  };
  onMount(() => {
    const updateNow = () => setNow(new Date());
    const interval = window.setInterval(updateNow, 60_000);
    document.addEventListener("visibilitychange", updateNow);
    onCleanup(() => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", updateNow);
    });
  });

  return (
    <section
      class={`calendar-surface paper flex min-h-0 flex-col overflow-hidden ${props.class ?? ""}`}
      aria-busy={props.navigationPending ? "true" : undefined}
    >
      <CalendarHeader date={date()} view={view()} labels={mergedLabels()} owner={props} />
      {props.toolbarContent}
      <Show
        when={view() !== "month"}
        fallback={
          <CalendarBody>
            <MonthView owner={props} date={date()} now={now()} events={normalizedEvents()} labels={mergedLabels()} />
          </CalendarBody>
        }
      >
        <Show
          when={view() !== "year"}
          fallback={
            <CalendarBody>
              <YearView owner={props} date={date()} now={now()} events={normalizedEvents()} />
            </CalendarBody>
          }
        >
          <Show
            when={view() !== "mobile-month"}
            fallback={
              <CalendarBody>
                <MobileMonthView
                  owner={props}
                  date={date()}
                  now={now()}
                  selectedDate={selectedDate()}
                  events={normalizedEvents()}
                  labels={mergedLabels()}
                />
              </CalendarBody>
            }
          >
            <TimeGridView owner={props} date={date()} now={now()} events={normalizedEvents()} labels={mergedLabels()} days={days()} />
          </Show>
        </Show>
      </Show>
    </section>
  );
};

export default Calendar;
