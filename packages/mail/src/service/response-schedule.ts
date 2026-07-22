import { dates, err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { type ResponseScheduleDefinitionInput, responseScheduleDefinitionSchema } from "../contracts";
import { validateResponseScheduleDefinition } from "../response-schedule-validation";

type ResponseScheduleWindow = { start: string; end: string };
type ResponseScheduleWeeklyWindow = ResponseScheduleWindow & { weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7 };
type ResponseScheduleException = { date: string; closed: boolean; windows: ResponseScheduleWindow[] };

export type ResponseScheduleDefinition = {
  timeZone: string;
  activeRanges: Array<{ from: string; to: string | null }>;
  weeklyWindows: ResponseScheduleWeeklyWindow[];
  exceptions: ResponseScheduleException[];
};

type ResponseScheduleEvaluation = {
  active: boolean;
  localDate: string;
  localTime: string;
  reason: "outside_active_range" | "holiday" | "exception" | "office_hours" | "outside_office_hours";
};

const minuteOfDay = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

export const validateResponseSchedule = validateResponseScheduleDefinition;

const localParts = (instant: Date, timeZone: string): { date: string; time: string; weekday: ResponseScheduleWeeklyWindow["weekday"] } => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  const utcWeekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  const weekday = (utcWeekday === 0 ? 7 : utcWeekday) as ResponseScheduleWeeklyWindow["weekday"];
  return { date, time: `${value("hour")}:${value("minute")}`, weekday };
};

const withinWindow = (time: string, window: ResponseScheduleWindow): boolean => {
  const minute = minuteOfDay(time);
  return minute >= minuteOfDay(window.start) && minute < minuteOfDay(window.end);
};

export const evaluateResponseSchedule = (schedule: ResponseScheduleDefinition, instant: Date): ResponseScheduleEvaluation => {
  const errors = validateResponseSchedule(schedule);
  if (errors.length > 0) throw new Error(errors.join("; "));
  if (!Number.isFinite(instant.getTime())) throw new Error("Schedule evaluation instant is invalid");
  const timeZone = dates.normalizeTimeZone(schedule.timeZone, "UTC");
  const local = localParts(instant, timeZone);
  const insideActiveRange =
    schedule.activeRanges.length === 0 ||
    schedule.activeRanges.some((range) => local.date >= range.from && (range.to === null || local.date <= range.to));
  if (!insideActiveRange) return { active: false, localDate: local.date, localTime: local.time, reason: "outside_active_range" };

  const exception = schedule.exceptions.find((item) => item.date === local.date);
  if (exception?.closed) return { active: false, localDate: local.date, localTime: local.time, reason: "holiday" };
  if (exception) {
    const active = exception.windows.some((window) => withinWindow(local.time, window));
    return { active, localDate: local.date, localTime: local.time, reason: active ? "exception" : "outside_office_hours" };
  }
  const active = schedule.weeklyWindows
    .filter((window) => window.weekday === local.weekday)
    .some((window) => withinWindow(local.time, window));
  return { active, localDate: local.date, localTime: local.time, reason: active ? "office_hours" : "outside_office_hours" };
};

const addCalendarDays = (date: string, days: number): string => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days, 12)).toISOString().slice(0, 10);
};

export const nextResponseScheduleInstant = (schedule: ResponseScheduleDefinition, after: Date, maxDays = 366): Date | null => {
  const errors = validateResponseSchedule(schedule);
  if (errors.length > 0) throw new Error(errors.join("; "));
  if (!Number.isFinite(after.getTime())) throw new Error("Schedule search instant is invalid");
  const timeZone = dates.normalizeTimeZone(schedule.timeZone, "UTC");
  const initial = localParts(after, timeZone);
  for (let offset = 0; offset <= maxDays; offset += 1) {
    const date = addCalendarDays(initial.date, offset);
    const insideActiveRange =
      schedule.activeRanges.length === 0 ||
      schedule.activeRanges.some((range) => date >= range.from && (range.to === null || date <= range.to));
    if (!insideActiveRange) continue;
    const exception = schedule.exceptions.find((item) => item.date === date);
    if (exception?.closed) continue;
    const weekday = localParts(
      new Date(dates.zonedDateTimeToInstant(`${date}T12:00`, timeZone, { disambiguation: "compatible" })),
      timeZone,
    ).weekday;
    const windows = exception ? exception.windows : schedule.weeklyWindows.filter((window) => window.weekday === weekday);
    for (const window of [...windows].sort((left, right) => minuteOfDay(left.start) - minuteOfDay(right.start))) {
      const candidate = new Date(dates.zonedDateTimeToInstant(`${date}T${window.start}`, timeZone, { disambiguation: "compatible" }));
      if (candidate.getTime() <= after.getTime()) continue;
      if (evaluateResponseSchedule(schedule, candidate).active) return candidate;
    }
  }
  return null;
};

export const decodeStoredResponseScheduleDefinition = (value: unknown): Result<ResponseScheduleDefinition> => {
  let source = value;
  if (typeof value === "string") {
    try {
      source = JSON.parse(value);
    } catch {
      return fail(err.internal("Stored response schedule definition is invalid"));
    }
  }
  const parsed = responseScheduleDefinitionSchema.safeParse(source);
  if (!parsed.success) return fail(err.internal("Stored response schedule definition is invalid"));
  const definition: ResponseScheduleDefinition = parsed.data;
  return validateResponseSchedule(definition).length === 0
    ? ok(definition)
    : fail(err.internal("Stored response schedule definition is invalid"));
};
export const normalizeResponseScheduleDefinition = (definition: ResponseScheduleDefinitionInput): Result<ResponseScheduleDefinition> => {
  const normalized: ResponseScheduleDefinition = {
    timeZone: definition.timeZone.trim(),
    activeRanges: definition.activeRanges,
    weeklyWindows: definition.weeklyWindows,
    exceptions: definition.exceptions,
  };
  const errors = validateResponseSchedule(normalized);
  return errors.length === 0 ? ok(normalized) : fail(err.badInput(errors.join("; ")));
};
