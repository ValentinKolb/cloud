import { dates, type DateContext } from "@valentinkolb/stdlib";

export type RecurringFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type RecurrenceRule = {
  freq: RecurringFrequency;
  interval: number;
  count?: number;
  until?: Date;
  byDay?: number[];
};

export type RecurringEvent = {
  id: string;
  title: string;
  start: string | Date;
  end: string | Date;
  allDay?: boolean;
  recurrence?: {
    rrule: string;
    dtstart?: string | Date;
    exdate?: Array<string | Date>;
  };
};

export type RecurringOverride = Omit<RecurringEvent, "recurrence"> & {
  recurringEventId: string;
  recurrenceId: string | Date;
};

export type ExpandedRecurringEvent = RecurringEvent & {
  recurringInstance?: {
    isRecurringInstance: true;
    recurringEventId: string;
    recurrenceId: string;
    originalStart: string;
    originalEnd: string;
  };
};

type ExpandRecurringEventsParams = {
  events: RecurringEvent[];
  overrides?: RecurringOverride[];
  rangeStart: string | Date;
  rangeEnd: string | Date;
  expansionLimit?: number;
  dateConfig?: DateContext;
};

const DEFAULT_EXPANSION_LIMIT = 2000;
const WEEKDAY_INDEX: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

const toDate = (value: string | Date): Date => (value instanceof Date ? new Date(value) : new Date(value));
const toIso = (date: Date): string => date.toISOString();
const sameInstantKey = (value: string | Date): string => toIso(toDate(value));

const addWallTime = (
  date: Date,
  context: DateContext | undefined,
  options: { years?: number; months?: number; weeks?: number; days?: number },
): Date => {
  if (context?.timeZone) {
    return new Date(dates.addZonedInstant(date, { timeZone: context.timeZone, ...options, disambiguation: "compatible" }));
  }
  return new Date(
    date.getFullYear() + (options.years ?? 0),
    date.getMonth() + (options.months ?? 0),
    date.getDate() + (options.weeks ?? 0) * 7 + (options.days ?? 0),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
};

const parseUntil = (value: string): Date => {
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const year = value.slice(0, 4);
    const month = value.slice(4, 6);
    const day = value.slice(6, 8);
    const hour = value.slice(9, 11);
    const minute = value.slice(11, 13);
    const second = value.slice(13, 15);
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  }
  if (/^\d{8}$/.test(value)) {
    return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T23:59:59.999Z`);
  }
  return new Date(value);
};

export const parseRecurrenceRule = (rrule: string): RecurrenceRule => {
  const parts = new Map<string, string>();
  for (const part of rrule.split(";")) {
    const [key, value] = part.split("=");
    if (!key || !value) continue;
    parts.set(key.toUpperCase(), value);
  }

  const freq = parts.get("FREQ") as RecurringFrequency | undefined;
  if (!freq || !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) {
    throw new Error("Recurrence rule requires FREQ=DAILY|WEEKLY|MONTHLY|YEARLY");
  }

  const interval = Number(parts.get("INTERVAL") ?? "1");
  if (!Number.isInteger(interval) || interval < 1) {
    throw new Error("Recurrence INTERVAL must be a positive integer");
  }

  const countRaw = parts.get("COUNT");
  const count = countRaw === undefined ? undefined : Number(countRaw);
  if (count !== undefined && (!Number.isInteger(count) || count < 1)) {
    throw new Error("Recurrence COUNT must be a positive integer");
  }

  const byDay = parts
    .get("BYDAY")
    ?.split(",")
    .map((day) => WEEKDAY_INDEX[day])
    .filter((day): day is number => day !== undefined);

  return {
    freq,
    interval,
    count,
    until: parts.has("UNTIL") ? parseUntil(parts.get("UNTIL")!) : undefined,
    byDay: byDay && byDay.length > 0 ? byDay : undefined,
  };
};

const zonedWeekday = (date: Date, context?: DateContext): number => {
  if (!context?.timeZone) return date.getDay();
  const key = dates.formatDateKey(date, context);
  const [year = "1970", month = "1", day = "1"] = key.split("-");
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
};

const nextCursor = (date: Date, rule: RecurrenceRule, context?: DateContext): Date => {
  if (rule.freq === "DAILY") return addWallTime(date, context, { days: rule.interval });
  if (rule.freq === "WEEKLY") return addWallTime(date, context, { weeks: rule.interval });
  if (rule.freq === "MONTHLY") return addWallTime(date, context, { months: rule.interval });
  return addWallTime(date, context, { years: rule.interval });
};

const weeklyCandidates = (weekStart: Date, rule: RecurrenceRule, fallbackDay: number, context?: DateContext): Date[] => {
  const days = rule.byDay ?? [fallbackDay];
  return days
    .map((day) => addWallTime(weekStart, context, { days: day - zonedWeekday(weekStart, context) }))
    .sort((a, b) => a.getTime() - b.getTime());
};

const overlapsRange = (start: Date, end: Date, rangeStart: Date, rangeEnd: Date): boolean => start < rangeEnd && end > rangeStart;

export const expandRecurringEvents = (params: ExpandRecurringEventsParams): ExpandedRecurringEvent[] => {
  const rangeStart = toDate(params.rangeStart);
  const rangeEnd = toDate(params.rangeEnd);
  const dateConfig = params.dateConfig;
  const expansionLimit = params.expansionLimit ?? DEFAULT_EXPANSION_LIMIT;
  const overrides = new Map(
    (params.overrides ?? []).map((event) => [`${event.recurringEventId}:${sameInstantKey(event.recurrenceId)}`, event]),
  );
  const output: ExpandedRecurringEvent[] = [];

  for (const event of params.events) {
    const start = toDate(event.start);
    const end = toDate(event.end);
    const duration = end.getTime() - start.getTime();

    if (!event.recurrence) {
      if (overlapsRange(start, end, rangeStart, rangeEnd)) output.push(event);
      continue;
    }

    const rule = parseRecurrenceRule(event.recurrence.rrule);
    const seriesStart = event.recurrence.dtstart ? toDate(event.recurrence.dtstart) : start;
    const exdates = new Set((event.recurrence.exdate ?? []).map(sameInstantKey));
    let emitted = 0;
    let generated = 0;
    let cursor = seriesStart;
    let done = false;

    while (!done && emitted < expansionLimit) {
      const candidates =
        rule.freq === "WEEKLY" ? weeklyCandidates(cursor, rule, zonedWeekday(seriesStart, dateConfig), dateConfig) : [cursor];

      for (const candidate of candidates) {
        if (candidate < seriesStart) continue;
        if (rule.until && candidate > rule.until) {
          done = true;
          break;
        }
        generated += 1;
        if (rule.count && generated > rule.count) {
          done = true;
          break;
        }

        const occurrenceEnd = new Date(candidate.getTime() + duration);
        if (occurrenceEnd <= rangeStart) continue;
        if (candidate >= rangeEnd) {
          done = true;
          break;
        }

        const recurrenceId = toIso(candidate);
        if (exdates.has(recurrenceId)) continue;

        const override = overrides.get(`${event.id}:${recurrenceId}`);
        if (override) {
          output.push({ ...override, recurringInstance: undefined });
        } else if (overlapsRange(candidate, occurrenceEnd, rangeStart, rangeEnd)) {
          output.push({
            ...event,
            id: `${event.id}:${recurrenceId}`,
            start: recurrenceId,
            end: toIso(occurrenceEnd),
            recurringInstance: {
              isRecurringInstance: true,
              recurringEventId: event.id,
              recurrenceId,
              originalStart: recurrenceId,
              originalEnd: toIso(occurrenceEnd),
            },
          });
        }

        emitted += 1;
        if (emitted >= expansionLimit) break;
      }

      cursor = nextCursor(cursor, rule, dateConfig);
    }
  }

  return output.sort((a, b) => toDate(a.start).getTime() - toDate(b.start).getTime());
};
