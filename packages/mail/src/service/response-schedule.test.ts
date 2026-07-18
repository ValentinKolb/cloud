import { describe, expect, test } from "bun:test";
import {
  evaluateResponseSchedule,
  nextResponseScheduleInstant,
  type ResponseScheduleDefinition,
  validateResponseSchedule,
} from "./response-schedule";

const schedule: ResponseScheduleDefinition = {
  timeZone: "Europe/Berlin",
  activeRanges: [{ from: "2026-01-01", to: null }],
  weeklyWindows: [
    { weekday: 1, start: "09:00", end: "17:00" },
    { weekday: 2, start: "09:00", end: "17:00" },
    { weekday: 3, start: "09:00", end: "17:00" },
    { weekday: 4, start: "09:00", end: "17:00" },
    { weekday: 5, start: "09:00", end: "17:00" },
  ],
  exceptions: [
    { date: "2026-07-17", closed: true, windows: [] },
    { date: "2026-07-18", closed: false, windows: [{ start: "10:00", end: "12:00" }] },
  ],
};

describe("Mail response schedules", () => {
  test("evaluates weekly office hours in the configured time zone", () => {
    expect(evaluateResponseSchedule(schedule, new Date("2026-07-16T08:00:00.000Z"))).toMatchObject({
      active: true,
      localTime: "10:00",
      reason: "office_hours",
    });
    expect(evaluateResponseSchedule(schedule, new Date("2026-07-16T18:00:00.000Z"))).toMatchObject({
      active: false,
      localTime: "20:00",
      reason: "outside_office_hours",
    });
  });

  test("gives explicit date exceptions precedence", () => {
    expect(evaluateResponseSchedule(schedule, new Date("2026-07-17T09:00:00.000Z"))).toMatchObject({ active: false, reason: "holiday" });
    expect(evaluateResponseSchedule(schedule, new Date("2026-07-18T09:00:00.000Z"))).toMatchObject({ active: true, reason: "exception" });
  });

  test("handles daylight-saving transitions by evaluating the instant", () => {
    const sunday: ResponseScheduleDefinition = {
      ...schedule,
      weeklyWindows: [{ weekday: 7, start: "03:00", end: "04:00" }],
      exceptions: [],
    };
    expect(evaluateResponseSchedule(sunday, new Date("2026-03-29T01:30:00.000Z"))).toMatchObject({ active: true, localTime: "03:30" });
  });

  test("supports an explicit full local day ending at 24:00", () => {
    const fullDay: ResponseScheduleDefinition = {
      timeZone: "Europe/Berlin",
      activeRanges: [],
      weeklyWindows: [{ weekday: 4, start: "00:00", end: "24:00" }],
      exceptions: [],
    };
    expect(validateResponseSchedule(fullDay)).toEqual([]);
    expect(evaluateResponseSchedule(fullDay, new Date("2026-07-16T21:59:00.000Z"))).toMatchObject({
      active: true,
      localTime: "23:59",
    });
    expect(validateResponseSchedule({ ...fullDay, weeklyWindows: [{ weekday: 4, start: "24:00", end: "24:00" }] })).toContain(
      "Weekly windows must be ordered HH:mm ranges within one local day",
    );
  });

  test("finds the next active instant across holidays and weekends", () => {
    expect(nextResponseScheduleInstant(schedule, new Date("2026-07-16T18:00:00.000Z"))?.toISOString()).toBe("2026-07-18T08:00:00.000Z");
    expect(nextResponseScheduleInstant(schedule, new Date("2026-07-18T10:30:00.000Z"))?.toISOString()).toBe("2026-07-20T07:00:00.000Z");
  });

  test("rejects ambiguous overnight and duplicate exception definitions", () => {
    expect(
      validateResponseSchedule({
        ...schedule,
        weeklyWindows: [{ weekday: 1, start: "17:00", end: "09:00" }],
        exceptions: [
          { date: "2026-07-17", closed: true, windows: [] },
          { date: "2026-07-17", closed: false, windows: [{ start: "10:00", end: "12:00" }] },
        ],
      }),
    ).toEqual(["Weekly windows must be ordered HH:mm ranges within one local day", "Each exception date may appear only once"]);
  });

  test("rejects invalid dates and overlapping windows", () => {
    const errors = validateResponseSchedule({
      ...schedule,
      activeRanges: [{ from: "2026-02-30", to: null }],
      weeklyWindows: [
        { weekday: 1, start: "08:00", end: "12:00" },
        { weekday: 1, start: "11:59", end: "13:00" },
      ],
      exceptions: [{ date: "2026-13-01", closed: false, windows: [] }],
    });
    expect(errors).toContain("Active date ranges must use ordered YYYY-MM-DD dates");
    expect(errors).toContain("Weekly windows cannot overlap on the same weekday");
    expect(errors).toContain("Exception dates must use YYYY-MM-DD");
  });
});
