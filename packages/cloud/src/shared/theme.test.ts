import { describe, expect, test } from "bun:test";
import { readThemeFromCookieHeader } from "./theme";

describe("readThemeFromCookieHeader", () => {
  test("defaults to light", () => {
    expect(readThemeFromCookieHeader("")).toBe("light");
    expect(readThemeFromCookieHeader(null)).toBe("light");
  });

  test("reads light and dark theme cookies", () => {
    expect(readThemeFromCookieHeader("theme=dark")).toBe("dark");
    expect(readThemeFromCookieHeader("session=abc; theme=light; other=1")).toBe("light");
  });

  test("uses the last valid duplicate theme cookie", () => {
    expect(readThemeFromCookieHeader("theme=dark; theme=light")).toBe("light");
    expect(readThemeFromCookieHeader("theme=light; theme=dark")).toBe("dark");
  });

  test("ignores invalid theme cookie values", () => {
    expect(readThemeFromCookieHeader("theme=dark; theme=broken")).toBe("dark");
    expect(readThemeFromCookieHeader("theme=broken; theme=light")).toBe("light");
  });
});
