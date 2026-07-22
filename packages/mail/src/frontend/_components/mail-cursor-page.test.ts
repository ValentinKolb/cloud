import { describe, expect, test } from "bun:test";
import { mergeMailCursorPage } from "./mail-cursor-page";

describe("mergeMailCursorPage", () => {
  test("appends only new rows and advances the cursor", () => {
    expect(
      mergeMailCursorPage({
        currentItems: [{ id: "one" }, { id: "two" }],
        currentNextCursor: "cursor-1",
        pageItems: [{ id: "two" }, { id: "three" }],
        pageNextCursor: "cursor-2",
      }),
    ).toEqual({
      ok: true,
      items: [{ id: "one" }, { id: "two" }, { id: "three" }],
      nextCursor: "cursor-2",
    });
  });

  test("rejects a repeated page with no new rows", () => {
    expect(
      mergeMailCursorPage({
        currentItems: [{ id: "one" }],
        currentNextCursor: "cursor-1",
        pageItems: [{ id: "one" }],
        pageNextCursor: "cursor-1",
      }),
    ).toEqual({ ok: false, reason: "repeated_page" });
  });
});
