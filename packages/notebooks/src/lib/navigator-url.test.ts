import { describe, expect, test } from "bun:test";
import { hasOnlyNavigatorQuery, parseNavigatorQuery, withNavigatorQuery } from "./navigator-url";

describe("notebook navigator URLs", () => {
  test("parses supported views and normalizes tags", () => {
    expect(parseNavigatorQuery(new URLSearchParams("view=favorites"))).toEqual({ view: "favorites" });
    expect(parseNavigatorQuery(new URLSearchParams("view=folder&folder=abc123"))).toEqual({ view: "folder", folder: "abc123" });
    expect(parseNavigatorQuery(new URLSearchParams("view=tag&tag=Recipe"))).toEqual({ view: "tag", tag: "recipe" });
  });

  test("falls back for incomplete or unsupported views", () => {
    expect(parseNavigatorQuery(new URLSearchParams("view=folder"))).toEqual({});
    expect(parseNavigatorQuery(new URLSearchParams("view=unknown"))).toEqual({});
  });

  test("replaces navigator state without retaining stale fields", () => {
    const href = withNavigatorQuery("/app/notebooks/book/notes/note?view=tag&tag=old", {
      view: "folder",
      folder: "folder1",
    });
    expect(href).toBe("/app/notebooks/book/notes/note?view=folder&folder=folder1");
    expect(withNavigatorQuery(href, {})).toBe("/app/notebooks/book/notes/note");
  });

  test("recognizes navigator-only searches", () => {
    expect(hasOnlyNavigatorQuery(new URLSearchParams("view=recents"))).toBe(true);
    expect(hasOnlyNavigatorQuery(new URLSearchParams("mode=versions"))).toBe(false);
  });
});
