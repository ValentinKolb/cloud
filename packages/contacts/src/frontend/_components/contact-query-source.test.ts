import { describe, expect, test } from "bun:test";
import { createContactQuerySource, isCurrentQuerySnapshot, parseContactQuerySource } from "./contact-query-source";

describe("contact query sources", () => {
  test("round-trips identifiers without delimiter ambiguity", () => {
    const source = createContactQuerySource({ bookId: "book:shared", contactId: "contact/ada", revision: 4 });

    expect(parseContactQuerySource(source)).toEqual({ bookId: "book:shared", contactId: "contact/ada", revision: 4 });
  });

  test("exposes data only for the exact active source", () => {
    const first = createContactQuerySource({ bookId: "book", contactId: "ada", revision: 1 });
    const second = createContactQuerySource({ bookId: "book", contactId: "grace", revision: 2 });
    const snapshot = { source: first, value: "Ada" };

    expect(isCurrentQuerySnapshot(snapshot, first)).toBe(true);
    expect(isCurrentQuerySnapshot(snapshot, second)).toBe(false);
    expect(isCurrentQuerySnapshot(snapshot, null)).toBe(false);
  });
});
