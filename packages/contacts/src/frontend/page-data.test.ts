import { describe, expect, test } from "bun:test";
import { parseContactsPage, parseContactsQueryOptions } from "./page-data";

describe("contacts page state", () => {
  test("normalizes invalid page values", () => {
    expect(parseContactsPage(undefined)).toBe(1);
    expect(parseContactsPage("0")).toBe(1);
    expect(parseContactsPage("2.5")).toBe(1);
    expect(parseContactsPage("3")).toBe(3);
  });

  test("normalizes list filters for SSR", () => {
    const values = { sort: "company", email: "no", phone: "invalid", favorites: "true" } as Record<string, string>;
    expect(parseContactsQueryOptions((name) => values[name])).toEqual({ sort: "company", email: "no", phone: "all", favorites: true });
  });
});
