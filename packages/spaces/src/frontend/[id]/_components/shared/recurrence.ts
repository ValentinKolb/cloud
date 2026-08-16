import { type DateContext, dates } from "@k2b/stdlib";
import type { Recurrence } from "@/contracts";

export type RecurrencePreset = "never" | "daily" | "weekly" | "monthly" | "yearly" | "custom";
export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type RecurrenceEndMode = "never" | "on" | "after";

export type RecurrenceFormState = {
  preset: RecurrencePreset;
  frequency: RecurrenceFrequency;
  interval: number;
  byDay: string[];
  endMode: RecurrenceEndMode;
  until: string;
  count: number | null;
};

export type RecurrenceSummaryOptions = {
  startsAt?: string | null;
  allDay?: boolean;
  dateConfig?: DateContext;
};

const FREQ_TO_PRESET: Record<string, RecurrencePreset> = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  YEARLY: "yearly",
};

const PRESET_TO_FREQ: Record<Exclude<RecurrencePreset, "never">, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
  custom: "WEEKLY",
};

export const weekdayOptions = [
  { id: "MO", label: "M", fullLabel: "Monday" },
  { id: "TU", label: "T", fullLabel: "Tuesday" },
  { id: "WE", label: "W", fullLabel: "Wednesday" },
  { id: "TH", label: "T", fullLabel: "Thursday" },
  { id: "FR", label: "F", fullLabel: "Friday" },
  { id: "SA", label: "S", fullLabel: "Saturday" },
  { id: "SU", label: "S", fullLabel: "Sunday" },
] as const;

export const recurrencePresetOptions = [
  { id: "never", label: "Does not repeat", description: "Single event only.", icon: "ti ti-calendar-event" },
  { id: "daily", label: "Daily", description: "Repeats every day.", icon: "ti ti-repeat" },
  { id: "weekly", label: "Weekly", description: "Repeats on this weekday.", icon: "ti ti-calendar-week" },
  { id: "monthly", label: "Monthly", description: "Repeats on this day of month.", icon: "ti ti-calendar-month" },
  { id: "yearly", label: "Yearly", description: "Repeats on this date each year.", icon: "ti ti-calendar" },
  { id: "custom", label: "Custom", description: "Choose frequency and interval.", icon: "ti ti-adjustments" },
];

export const recurrenceFrequencyOptions = [
  { id: "daily", label: "Daily", description: "Every N days.", icon: "ti ti-repeat" },
  { id: "weekly", label: "Weekly", description: "Every N weeks.", icon: "ti ti-calendar-week" },
  { id: "monthly", label: "Monthly", description: "Every N months.", icon: "ti ti-calendar-month" },
  { id: "yearly", label: "Yearly", description: "Every N years.", icon: "ti ti-calendar" },
];

export const recurrenceEndOptions = [
  { id: "never", label: "No end", description: "Continues until changed.", icon: "ti ti-infinity" },
  { id: "on", label: "On date", description: "Stops after a date.", icon: "ti ti-calendar-due" },
  { id: "after", label: "After count", description: "Stops after occurrences.", icon: "ti ti-list-numbers" },
];

export const emptyRecurrenceState = (): RecurrenceFormState => ({
  preset: "never",
  frequency: "weekly",
  interval: 1,
  byDay: [],
  endMode: "never",
  until: "",
  count: null,
});

const parseRrule = (rrule: string) =>
  Object.fromEntries(
    rrule
      .split(";")
      .map((part) => part.split("="))
      .filter((part): part is [string, string] => Boolean(part[0] && part[1]))
      .map(([key, value]) => [key.toUpperCase(), value]),
  );

export const recurrenceToFormState = (recurrence: Recurrence | null | undefined, dateConfig?: DateContext): RecurrenceFormState => {
  if (!recurrence?.rrule) return emptyRecurrenceState();
  const parts = parseRrule(recurrence.rrule);
  const frequency = (FREQ_TO_PRESET[parts.FREQ ?? ""] ?? "weekly") as RecurrenceFrequency;
  const interval = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
  const byDay = parts.BYDAY?.split(",").filter(Boolean) ?? [];
  const preset = interval > 1 || byDay.length > 0 ? "custom" : frequency;
  const count = parts.COUNT ? Number(parts.COUNT) : null;
  return {
    preset,
    frequency,
    interval: Number.isFinite(interval) && interval > 0 ? interval : 1,
    byDay,
    endMode: parts.UNTIL ? "on" : count ? "after" : "never",
    until: parts.UNTIL ? untilToDateInput(parts.UNTIL, dateConfig) : "",
    count: count && Number.isFinite(count) ? count : null,
  };
};

export const recurrenceFromFormState = (state: RecurrenceFormState, startsAt: string, dateConfig?: DateContext): Recurrence | null => {
  if (state.preset === "never") return null;
  const freq = state.preset === "custom" ? PRESET_TO_FREQ[state.frequency] : PRESET_TO_FREQ[state.preset];
  const parts = [`FREQ=${freq}`];
  if (state.preset === "custom" && state.interval > 1) parts.push(`INTERVAL=${Math.floor(state.interval)}`);
  if (state.preset === "custom" && state.frequency === "weekly" && state.byDay.length > 0) parts.push(`BYDAY=${state.byDay.join(",")}`);
  if (state.endMode === "on" && state.until) parts.push(`UNTIL=${dateInputToUntil(state.until, dateConfig)}`);
  if (state.endMode === "after" && state.count && state.count > 0) parts.push(`COUNT=${Math.floor(state.count)}`);
  return { rrule: parts.join(";"), dtstart: startsAt ? new Date(startsAt).toISOString() : null, exdate: [] };
};

const joinWords = (values: string[]): string => {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
};

const validDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatStartTime = (value: string | null | undefined, date: Date, dateConfig?: DateContext): string => {
  const localTime = dateConfig?.timeZone ? undefined : value?.match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/)?.[1];
  return localTime ?? dates.formatTime(date, dateConfig);
};

const dateInputInstant = (value: string, dateConfig?: DateContext): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  try {
    return new Date(
      dateConfig?.timeZone
        ? dates.zonedDateTimeToInstant(`${value}T12:00:00`, dateConfig.timeZone, { disambiguation: "compatible" })
        : `${value}T12:00:00.000Z`,
    );
  } catch {
    return null;
  }
};

const weekdayLabels = (byDay: string[]): string[] =>
  byDay.map((value) => weekdayOptions.find((option) => option.id === value)?.fullLabel ?? value);

const formatWeekdayShort = (date: Date, dateConfig?: DateContext): string =>
  new Intl.DateTimeFormat(dateConfig?.locale ?? "en", {
    weekday: "short",
    timeZone: dateConfig?.timeZone ?? "UTC",
  }).format(date);

const recurrenceBase = (state: RecurrenceFormState, startsAt: Date | null, dateConfig?: DateContext): string => {
  const interval = Math.max(1, Math.floor(state.interval));
  if (state.frequency === "daily") return interval === 1 ? "Repeats every day" : `Repeats every ${interval} days`;

  if (state.frequency === "weekly") {
    const weekdays = weekdayLabels(state.byDay);
    if (weekdays.length === 0 && startsAt) weekdays.push(dates.formatWeekdayLong(startsAt, dateConfig));
    if (interval === 1 && weekdays.length > 0) return `Repeats every ${joinWords(weekdays)}`;
    return `Repeats every ${interval === 1 ? "week" : `${interval} weeks`}${weekdays.length > 0 ? ` on ${joinWords(weekdays)}` : ""}`;
  }

  if (state.frequency === "monthly") {
    const day = startsAt ? dates.formatDayNumber(startsAt, dateConfig) : null;
    return `Repeats every ${interval === 1 ? "month" : `${interval} months`}${day ? ` on day ${day}` : ""}`;
  }

  const yearlyDate = startsAt
    ? new Intl.DateTimeFormat(dateConfig?.locale ?? "en", {
        day: "numeric",
        month: "long",
        timeZone: dateConfig?.timeZone ?? "UTC",
      }).format(startsAt)
    : null;
  return `Repeats every ${interval === 1 ? "year" : `${interval} years`}${yearlyDate ? ` on ${yearlyDate}` : ""}`;
};

export const summarizeRecurrenceState = (state: RecurrenceFormState, options: RecurrenceSummaryOptions = {}): string | null => {
  if (state.preset === "never") return null;
  const startsAt = validDate(options.startsAt);
  const time = !options.allDay && startsAt ? ` at ${formatStartTime(options.startsAt, startsAt, options.dateConfig)}` : "";
  const until = state.endMode === "on" ? dateInputInstant(state.until, options.dateConfig) : null;
  const end = until
    ? ` until ${formatWeekdayShort(until, options.dateConfig)} ${dates.formatDate(until, options.dateConfig)}`
    : state.endMode === "after" && state.count
      ? ` for ${state.count} ${state.count === 1 ? "occurrence" : "occurrences"}`
      : "";
  return `${recurrenceBase(state, startsAt, options.dateConfig)}${time}${end}`;
};

export const summarizeRecurrence = (recurrence: Recurrence | null | undefined, options: RecurrenceSummaryOptions = {}): string | null =>
  summarizeRecurrenceState(recurrenceToFormState(recurrence, options.dateConfig), options);

const compactUtc = (date: Date): string =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}T${String(
    date.getUTCHours(),
  ).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}${String(date.getUTCSeconds()).padStart(2, "0")}Z`;

const untilToDateInput = (until: string, dateConfig?: DateContext): string => {
  if (/^\d{8}/.test(until)) return `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
  const date = new Date(until);
  return Number.isNaN(date.getTime()) ? "" : dates.formatDateKey(date, dateConfig);
};

const dateInputToUntil = (value: string, dateConfig?: DateContext): string => {
  if (dateConfig?.timeZone) {
    return compactUtc(new Date(dates.zonedDateTimeToInstant(`${value}T23:59:59`, dateConfig.timeZone, { disambiguation: "compatible" })));
  }
  return compactUtc(new Date(`${value}T23:59:59.999Z`));
};
