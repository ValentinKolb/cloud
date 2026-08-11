import { describe, expect, test } from "bun:test";
import { assertCursorProgress } from "./pagination";

describe("mail pagination", () => {
  test("rejects repeated cursors, including an empty cursor", () => {
    expect(() => assertCursorProgress("next", "next", "mailbox")).toThrow("The server returned the same mailbox page twice");
    expect(() => assertCursorProgress("", "", "mailbox")).toThrow("The server returned the same mailbox page twice");
  });

  test("accepts the first page, progress, and the end of pagination", () => {
    expect(() => assertCursorProgress(undefined, "next", "mailbox")).not.toThrow();
    expect(() => assertCursorProgress("current", "next", "mailbox")).not.toThrow();
    expect(() => assertCursorProgress("current", null, "mailbox")).not.toThrow();
  });
});
