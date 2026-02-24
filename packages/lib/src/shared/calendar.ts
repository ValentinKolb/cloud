import dayjs, { type Dayjs } from "dayjs";
import "dayjs/locale/de";
import isoWeek from "dayjs/plugin/isoWeek";

export type CalendarItemLike = {
  startsAt: string | null;
  endsAt: string | null;
  deadline: string | null;
};

dayjs.extend(isoWeek);
dayjs.locale("de");

// =============================================================================
// Date Grid Generation
// =============================================================================

/** Get all days for a month grid (includes padding from adjacent months) */
export const getMonthGrid = (year: number, month: number): Date[][] => {
  const first = dayjs().year(year).month(month).startOf("month");
  const start = first.startOf("isoWeek");

  const weeks: Date[][] = [];
  let current = start;

  for (let w = 0; w < 6; w++) {
    const week = Array.from({ length: 7 }, (_, d) => {
      const day = current.add(d, "day").toDate();
      return day;
    });
    weeks.push(week);
    current = current.add(7, "day");

    // Stop early if we've filled the month
    if (current.month() !== month && w >= 3) break;
  }

  return weeks;
};

/** Get 7 days starting from Monday of the week containing the given date */
export const getWeekDays = (date: Date): Date[] => {
  const start = dayjs(date).startOf("isoWeek");
  return Array.from({ length: 7 }, (_, i) => start.add(i, "day").toDate());
};

// =============================================================================
// Date Range Calculation
// =============================================================================

/** Get the date range for fetching calendar items */
export const getDateRange = (view: "month" | "week", date: Date): { from: Date; to: Date } => {
  const d = dayjs(date);

  if (view === "month") {
    // Include padding days from adjacent months
    const first = d.startOf("month").startOf("isoWeek");
    const last = d.endOf("month").endOf("isoWeek");
    return { from: first.toDate(), to: last.toDate() };
  }

  // week
  const start = d.startOf("isoWeek");
  const end = d.endOf("isoWeek");
  return { from: start.toDate(), to: end.toDate() };
};

// =============================================================================
// Item Filtering
// =============================================================================

/** Check if an item falls on a specific date */
export const itemOnDate = (item: CalendarItemLike, date: Date): boolean => {
  const d = dayjs(date);
  const dayStart = d.startOf("day");
  const dayEnd = d.endOf("day");

  // Event with time range
  if (item.startsAt && item.endsAt) {
    const start = dayjs(item.startsAt);
    const end = dayjs(item.endsAt);
    return start.isBefore(dayEnd) && end.isAfter(dayStart);
  }

  // Task with deadline
  if (item.deadline) {
    return dayjs(item.deadline).isSame(d, "day");
  }

  return false;
};

/** Get all items for a specific date */
export const getDayItems = <T extends CalendarItemLike>(items: T[], date: Date): T[] => items.filter((item) => itemOnDate(item, date));

// =============================================================================
// Date Checks
// =============================================================================

export const isToday = (date: Date): boolean => dayjs(date).isSame(dayjs(), "day");

export const isSameMonth = (date: Date, refDate: Date): boolean => dayjs(date).isSame(dayjs(refDate), "month");

export const isSameDay = (a: Date, b: Date): boolean => dayjs(a).isSame(dayjs(b), "day");

// =============================================================================
// Formatting
// =============================================================================

export const formatMonthYear = (date: Date): string => dayjs(date).format("MMMM YYYY");

export const formatDayNumber = (date: Date): string => dayjs(date).format("D");

export const formatWeekdayShort = (date: Date): string => dayjs(date).format("dd");

export const formatWeekdayLong = (date: Date): string => dayjs(date).format("dddd");

export const formatFullDate = (date: Date): string => dayjs(date).format("D. MMMM YYYY");

export const formatDateShort = (date: Date): string => dayjs(date).format("D.M.");

/** Format date as YYYY-MM-DD key (for weather lookup etc.) */
export const formatDateKey = (date: Date): string => dayjs(date).format("YYYY-MM-DD");

/** Format time from ISO string */
export const formatTime = (iso: string): string => dayjs(iso).format("HH:mm");

// =============================================================================
// Navigation Helpers
// =============================================================================

export const addMonths = (date: Date, n: number): Date => dayjs(date).add(n, "month").toDate();

export const addWeeks = (date: Date, n: number): Date => dayjs(date).add(n, "week").toDate();

export const addDays = (date: Date, n: number): Date => dayjs(date).add(n, "day").toDate();

export const startOfMonth = (date: Date): Date => dayjs(date).startOf("month").toDate();

export const startOfWeek = (date: Date): Date => dayjs(date).startOf("isoWeek").toDate();

/** Get today's date at start of day */
export const today = (): Date => dayjs().startOf("day").toDate();

// =============================================================================
// Constants
// =============================================================================

export const WEEKDAYS_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

/** Generate year options for dropdown (current ±5 years) */
export const getYearOptions = (): number[] => {
  const current = dayjs().year();
  return Array.from({ length: 11 }, (_, i) => current - 5 + i);
};

// =============================================================================
// URL Helpers
// =============================================================================

export type CalendarUrlParams = {
  view?: "month" | "week";
  date?: Date;
  item?: string;
};

/**
 * Build calendar URL with parameters.
 * Preserves existing query params from baseUrl and adds/overrides calendar-specific ones.
 */
export const buildCalendarUrl = (baseUrl: string, params: CalendarUrlParams): string => {
  const [path, query] = baseUrl.split("?");
  const searchParams = new URLSearchParams(query ?? "");

  searchParams.set("view", "calendar");

  if (params.view) {
    searchParams.set("cv", params.view);
  } else {
    searchParams.delete("cv");
  }

  if (params.date) {
    searchParams.set("cd", dayjs(params.date).format("YYYY-MM-DD"));
  } else {
    searchParams.delete("cd");
  }

  if (params.item) {
    searchParams.set("item", params.item);
  } else {
    searchParams.delete("item");
  }

  return `${path}?${searchParams.toString()}`;
};

/** Parse calendar date from URL parameter */
export const parseCalendarDate = (param: string | undefined): Date => {
  if (!param) return today();
  const parsed = dayjs(param);
  return parsed.isValid() ? parsed.toDate() : today();
};

export const calendar = {
  getMonthGrid,
  getWeekDays,
  getDateRange,
  itemOnDate,
  getDayItems,
  isToday,
  isSameMonth,
  isSameDay,
  formatMonthYear,
  formatDayNumber,
  formatWeekdayShort,
  formatWeekdayLong,
  formatFullDate,
  formatDateShort,
  formatDateKey,
  formatTime,
  addMonths,
  addWeeks,
  addDays,
  startOfMonth,
  startOfWeek,
  today,
  WEEKDAYS_SHORT,
  MONTHS,
  getYearOptions,
  buildCalendarUrl,
  parseCalendarDate,
} as const;
