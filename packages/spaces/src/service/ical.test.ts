import { describe, expect, test } from "bun:test";
import { createICalContent } from "./ical";

const space = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Team Space",
  description: "Shared schedule",
  color: "#3b82f6",
  ical_token: "token",
  created_at: new Date("2026-06-01T08:00:00.000Z"),
  updated_at: new Date("2026-06-01T08:00:00.000Z"),
};

const baseItem = {
  id: "22222222-2222-2222-2222-222222222222",
  title: "Planning",
  description: "Weekly planning",
  location: "Office",
  url: null,
  startsAt: new Date("2026-06-01T07:00:00.000Z"),
  endsAt: new Date("2026-06-01T08:00:00.000Z"),
  allDay: false,
  deadline: null,
  priority: "high" as const,
  recurrenceRrule: null,
  recurrenceDtstart: null,
  recurrenceExdate: [],
  recurringEventId: null,
  recurrenceId: null,
  createdAt: new Date("2026-06-01T08:00:00.000Z"),
  updatedAt: new Date("2026-06-01T08:00:00.000Z"),
};

const unfold = (content: string): string => content.replace(/\r\n[ \t]/g, "");

describe("createICalContent", () => {
  test("uses the provided date timezone", async () => {
    const content = await createICalContent({
      space,
      items: [baseItem],
      baseUrl: "https://cloud.test",
      appName: "Cloud",
      dateConfig: { timeZone: "America/New_York", locale: "en", firstDayOfWeek: 1 },
    });

    expect(content).toContain("X-WR-TIMEZONE:America/New_York");
    expect(content).toContain("DTSTART;TZID=America/New_York:");
    expect(unfold(content)).toContain(
      "https://cloud.test/app/spaces/11111111-1111-1111-1111-111111111111?view=calendar&item=22222222-2222-2222-2222-222222222222",
    );
  });

  test("writes recurring events, exclusions, and occurrence overrides", async () => {
    const content = await createICalContent({
      space,
      items: [
        {
          ...baseItem,
          recurrenceRrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4",
          recurrenceDtstart: baseItem.startsAt,
          recurrenceExdate: [new Date("2026-06-15T07:00:00.000Z")],
        },
        {
          ...baseItem,
          id: "33333333-3333-3333-3333-333333333333",
          title: "Moved planning",
          startsAt: new Date("2026-06-03T11:00:00.000Z"),
          endsAt: new Date("2026-06-03T12:00:00.000Z"),
          recurrenceRrule: null,
          recurrenceDtstart: null,
          recurrenceExdate: [],
          recurringEventId: baseItem.id,
          recurrenceId: new Date("2026-06-03T07:00:00.000Z"),
        },
      ],
      baseUrl: "https://cloud.test",
      appName: "Cloud",
      dateConfig: { timeZone: "Europe/Berlin", locale: "en", firstDayOfWeek: 1 },
    });

    expect(content).toContain("RRULE:FREQ=WEEKLY;COUNT=4;INTERVAL=2;BYDAY=MO,WE");
    expect(content).toContain("EXDATE");
    expect(content).toContain("UID:22222222-2222-2222-2222-222222222222");
    expect(content).toContain("RECURRENCE-ID;TZID=Europe/Berlin:");
    expect(content).toContain("SUMMARY:Moved planning");
  });
});
