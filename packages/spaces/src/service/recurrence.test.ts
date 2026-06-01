import { describe, expect, test } from "bun:test";
import { expandRecurringEvents, parseRecurrenceRule } from "./recurrence";

const baseEvent = {
  id: "weekly",
  title: "Weekly planning",
  start: "2026-05-04T09:00:00.000Z",
  end: "2026-05-04T10:30:00.000Z",
};

describe("parseRecurrenceRule", () => {
  test("parses common RFC 5545 recurrence parts", () => {
    expect(parseRecurrenceRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5")).toEqual({
      freq: "WEEKLY",
      interval: 2,
      count: 5,
      byDay: [1, 3],
      until: undefined,
    });
  });

  test("rejects unsupported or invalid rules", () => {
    expect(() => parseRecurrenceRule("FREQ=HOURLY")).toThrow("Recurrence rule requires");
    expect(() => parseRecurrenceRule("FREQ=DAILY;INTERVAL=0")).toThrow("INTERVAL");
    expect(() => parseRecurrenceRule("FREQ=DAILY;COUNT=0")).toThrow("COUNT");
  });
});

describe("expandRecurringEvents", () => {
  test("expands daily series and preserves duration", () => {
    const events = expandRecurringEvents({
      events: [{ ...baseEvent, recurrence: { rrule: "FREQ=DAILY;COUNT=3" } }],
      rangeStart: "2026-05-04T00:00:00.000Z",
      rangeEnd: "2026-05-08T00:00:00.000Z",
    });

    expect(events.map((event) => event.start)).toEqual([
      "2026-05-04T09:00:00.000Z",
      "2026-05-05T09:00:00.000Z",
      "2026-05-06T09:00:00.000Z",
    ]);
    expect(events[0]?.end).toBe("2026-05-04T10:30:00.000Z");
  });

  test("expands weekly BYDAY series inside the requested range", () => {
    const events = expandRecurringEvents({
      events: [{ ...baseEvent, recurrence: { rrule: "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4" } }],
      rangeStart: "2026-05-04T00:00:00.000Z",
      rangeEnd: "2026-05-14T00:00:00.000Z",
    });

    expect(events.map((event) => event.start)).toEqual([
      "2026-05-04T09:00:00.000Z",
      "2026-05-06T09:00:00.000Z",
      "2026-05-11T09:00:00.000Z",
      "2026-05-13T09:00:00.000Z",
    ]);
  });

  test("expands custom weekly interval with selected weekdays", () => {
    const events = expandRecurringEvents({
      events: [{ ...baseEvent, recurrence: { rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=4" } }],
      rangeStart: "2026-05-04T00:00:00.000Z",
      rangeEnd: "2026-06-01T00:00:00.000Z",
    });

    expect(events.map((event) => event.start)).toEqual([
      "2026-05-04T09:00:00.000Z",
      "2026-05-08T09:00:00.000Z",
      "2026-05-18T09:00:00.000Z",
      "2026-05-22T09:00:00.000Z",
    ]);
  });

  test("honors UNTIL, EXDATE, and overrides", () => {
    const events = expandRecurringEvents({
      events: [
        {
          ...baseEvent,
          recurrence: {
            rrule: "FREQ=DAILY;UNTIL=20260507T090000Z",
            exdate: ["2026-05-05T09:00:00.000Z"],
          },
        },
      ],
      overrides: [
        {
          ...baseEvent,
          id: "weekly-override",
          title: "Weekly planning moved",
          start: "2026-05-06T14:00:00.000Z",
          end: "2026-05-06T15:30:00.000Z",
          recurringEventId: "weekly",
          recurrenceId: "2026-05-06T09:00:00.000Z",
        },
      ],
      rangeStart: "2026-05-04T00:00:00.000Z",
      rangeEnd: "2026-05-09T00:00:00.000Z",
    });

    expect(events.map((event) => [event.id, event.title, event.start])).toEqual([
      ["weekly:2026-05-04T09:00:00.000Z", "Weekly planning", "2026-05-04T09:00:00.000Z"],
      ["weekly-override", "Weekly planning moved", "2026-05-06T14:00:00.000Z"],
      ["weekly:2026-05-07T09:00:00.000Z", "Weekly planning", "2026-05-07T09:00:00.000Z"],
    ]);
  });

  test("caps unbounded recurrence expansion", () => {
    const events = expandRecurringEvents({
      events: [{ ...baseEvent, recurrence: { rrule: "FREQ=DAILY" } }],
      rangeStart: "2026-05-04T00:00:00.000Z",
      rangeEnd: "2026-06-04T00:00:00.000Z",
      expansionLimit: 5,
    });

    expect(events).toHaveLength(5);
  });

  test("keeps expanding later series after one series ends", () => {
    const events = expandRecurringEvents({
      events: [
        { ...baseEvent, id: "short", recurrence: { rrule: "FREQ=DAILY;COUNT=1" } },
        {
          ...baseEvent,
          id: "later",
          start: "2026-05-06T12:00:00.000Z",
          end: "2026-05-06T13:00:00.000Z",
          recurrence: { rrule: "FREQ=DAILY;COUNT=2" },
        },
      ],
      rangeStart: "2026-05-04T00:00:00.000Z",
      rangeEnd: "2026-05-09T00:00:00.000Z",
    });

    expect(events.map((event) => event.id)).toEqual([
      "short:2026-05-04T09:00:00.000Z",
      "later:2026-05-06T12:00:00.000Z",
      "later:2026-05-07T12:00:00.000Z",
    ]);
  });
});
