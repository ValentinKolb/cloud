import { describe, expect, test } from "bun:test";
import { parseQuotePayload } from "./index";

describe("parseQuotePayload", () => {
  test("accepts the ZenQuotes array payload", () => {
    expect(parseQuotePayload([{ q: "  Keep it simple.  ", a: "  Unknown  ", h: "<blockquote>ignored</blockquote>" }])).toEqual({
      text: "Keep it simple.",
      author: "Unknown",
    });
  });

  test("rejects empty or unexpected provider payloads", () => {
    expect(parseQuotePayload([])).toBeNull();
    expect(parseQuotePayload({ error: "too many requests" })).toBeNull();
    expect(parseQuotePayload([{ q: "", a: "Author" }])).toBeNull();
    expect(parseQuotePayload([{ q: "Quote", a: "" }])).toBeNull();
  });
});
