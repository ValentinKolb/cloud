import { describe, expect, test } from "bun:test";
import {
  DEFAULT_DISPLAY_REFRESH_SECONDS,
  displayRefreshBackoffMs,
  MIN_DISPLAY_REFRESH_SECONDS,
  parseDisplayCoordinate,
  parseDisplayRefreshSeconds,
} from "./runtime";

describe("weather display refresh", () => {
  test("accepts only coordinates inside the requested range", () => {
    expect(parseDisplayCoordinate("52.52", -90, 90)).toBe("52.52");
    expect(parseDisplayCoordinate("-181", -180, 180)).toBeNull();
    expect(parseDisplayCoordinate("not-a-number", -90, 90)).toBeNull();
    expect(parseDisplayCoordinate(undefined, -90, 90)).toBeNull();
  });

  test("uses a safe default and minimum interval", () => {
    expect(parseDisplayRefreshSeconds(undefined)).toBe(DEFAULT_DISPLAY_REFRESH_SECONDS);
    expect(parseDisplayRefreshSeconds("invalid")).toBe(DEFAULT_DISPLAY_REFRESH_SECONDS);
    expect(parseDisplayRefreshSeconds("1")).toBe(MIN_DISPLAY_REFRESH_SECONDS);
    expect(parseDisplayRefreshSeconds("45")).toBe(45);
  });

  test("backs off failed refreshes without delaying recovery indefinitely", () => {
    expect(displayRefreshBackoffMs(60, 0)).toBe(60_000);
    expect(displayRefreshBackoffMs(60, 1)).toBe(120_000);
    expect(displayRefreshBackoffMs(60, 4)).toBe(300_000);
    expect(displayRefreshBackoffMs(600, 3)).toBe(600_000);
  });
});
