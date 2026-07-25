import { describe, expect, test } from "bun:test";
import { createUrlFilter, flag, list, oneOf, page, text } from "./url-filter";

const filter = createUrlFilter("/admin/things", {
  range: oneOf("range", ["1h", "24h", "7d"] as const, "24h"),
  search: text("search"),
  sources: list("source"),
  errorsOnly: flag("errors"),
  page: page(),
});

const parse = (query: string) => filter.parse(new URL(`http://cloud/admin/things${query}`));

describe("parse", () => {
  test("falls back on an empty query", () => {
    expect(parse("")).toEqual({ range: "24h", search: "", sources: [], errorsOnly: false, page: 1 });
  });

  test("reads every field", () => {
    expect(parse("?range=7d&search=timeout&source=a&source=b&errors=1&page=3")).toEqual({
      range: "7d",
      search: "timeout",
      sources: ["a", "b"],
      errorsOnly: true,
      page: 3,
    });
  });

  test("rejects values outside the allowed set", () => {
    // A hand-edited URL must not reach SQL as an unvalidated interval.
    expect(parse("?range=all-time").range).toBe("24h");
    expect(parse("?page=-4").page).toBe(1);
  });

  test("de-duplicates repeated list values", () => {
    expect(parse("?source=a&source=a&source=b").sources).toEqual(["a", "b"]);
  });
});

describe("build", () => {
  test("omits defaults", () => {
    expect(filter.build(parse(""))).toBe("/admin/things");
  });

  test("round-trips through the parser", () => {
    const state = parse("?range=7d&search=x&source=a&errors=1&page=2");
    expect(filter.parse(new URL(`http://cloud${filter.build(state)}`))).toEqual(state);
  });

  test("applies a patch over the current state", () => {
    const url = filter.build(parse("?search=x"), { range: "1h" });
    expect(url).toContain("range=1h");
    expect(url).toContain("search=x");
  });
});

describe("paginationBase", () => {
  test("always ends in a usable separator", () => {
    // Eight pages derived this by hand and disagreed on ? versus &.
    expect(filter.paginationBase(parse(""), "page")).toBe("/admin/things?page=");
    expect(filter.paginationBase(parse("?range=7d"), "page")).toBe("/admin/things?range=7d&page=");
  });

  test("drops the current page so the base is reusable", () => {
    expect(filter.paginationBase(parse("?page=5"), "page")).not.toContain("page=5");
  });
});

describe("isActive and clear", () => {
  test("defaults are not active", () => {
    expect(filter.isActive(parse(""))).toBe(false);
  });

  test("any non-default field counts", () => {
    expect(filter.isActive(parse("?search=x"))).toBe(true);
    expect(filter.isActive(parse("?errors=1"))).toBe(true);
  });

  test("fields can be excluded from the active check", () => {
    // A time window is a scope, not a filter — it should not light up "clear".
    expect(filter.isActive(parse("?range=7d"), ["range"])).toBe(false);
  });

  test("clear keeps what it is told to keep", () => {
    const url = filter.clear(parse("?range=7d&search=x&errors=1"), ["range"]);
    expect(url).toBe("/admin/things?range=7d");
  });
});
