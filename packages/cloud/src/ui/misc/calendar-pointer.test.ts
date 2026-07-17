import { describe, expect, test } from "bun:test";
import { calendarAutoScrollSpeed, calendarDayIndexAtPoint, calendarMinuteAtPoint, snapCalendarMinutes } from "./calendar-pointer";

describe("calendar pointer geometry", () => {
  test("snaps to quarter-hour boundaries", () => {
    expect(snapCalendarMinutes(607)).toBe(600);
    expect(snapCalendarMinutes(608)).toBe(615);
  });

  test("maps horizontal points to bounded day columns", () => {
    expect(calendarDayIndexAtPoint(100, 100, 700, 7)).toBe(0);
    expect(calendarDayIndexAtPoint(799, 100, 700, 7)).toBe(6);
    expect(calendarDayIndexAtPoint(800, 100, 700, 7)).toBeNull();
  });

  test("maps vertical points to visible snapped minutes", () => {
    expect(calendarMinuteAtPoint(100, 100, 600, 8, 17)).toBe(480);
    expect(calendarMinuteAtPoint(250, 100, 600, 8, 17)).toBe(630);
    expect(calendarMinuteAtPoint(700, 100, 600, 8, 17)).toBe(1080);
  });

  test("scrolls only near viewport edges", () => {
    expect(calendarAutoScrollSpeed(120, 100, 600)).toBeLessThan(0);
    expect(calendarAutoScrollSpeed(350, 100, 600)).toBe(0);
    expect(calendarAutoScrollSpeed(590, 100, 600)).toBeGreaterThan(0);
  });
});
