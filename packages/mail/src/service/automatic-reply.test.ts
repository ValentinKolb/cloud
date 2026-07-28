import { describe, expect, test } from "bun:test";
import type { ResponseScheduleDefinitionInput } from "../contracts";
import { resolveAutomaticReplySchedule } from "./automatic-reply";

const schedule: ResponseScheduleDefinitionInput = {
  mode: "windows",
  timeZone: "Europe/Berlin",
  activeRanges: [{ from: "2026-07-20", to: "2026-07-24" }],
  weeklyWindows: [
    { weekday: 1, start: "09:00", end: "17:00" },
    { weekday: 2, start: "09:00", end: "17:00" },
    { weekday: 3, start: "09:00", end: "17:00" },
    { weekday: 4, start: "09:00", end: "17:00" },
    { weekday: 5, start: "09:00", end: "17:00" },
  ],
  exceptions: [],
};

describe("automatic reply schedule behavior", () => {
  test("keeps always-on replies immediate", () => {
    const instant = new Date("2026-07-18T10:00:00.000Z");
    expect(resolveAutomaticReplySchedule({ mode: "always" }, instant, "defer")).toEqual({ state: "scheduled", scheduledAt: instant });
  });

  test("suppresses messages outside an out-of-office window", () => {
    expect(resolveAutomaticReplySchedule(schedule, new Date("2026-07-18T10:00:00.000Z"), "skip")).toEqual({
      state: "suppressed",
      reason: "outside_response_schedule",
    });
  });

  test("defers messages to the next active office-hours window", () => {
    const decision = resolveAutomaticReplySchedule(schedule, new Date("2026-07-20T05:00:00.000Z"), "defer");
    expect(decision.state).toBe("scheduled");
    if (decision.state === "scheduled") expect(decision.scheduledAt.toISOString()).toBe("2026-07-20T07:00:00.000Z");
  });

  test("keeps messages received during an active window immediate", () => {
    const instant = new Date("2026-07-20T10:00:00.000Z");
    expect(resolveAutomaticReplySchedule(schedule, instant, "skip")).toEqual({ state: "scheduled", scheduledAt: instant });
  });
});
