import { describe, expect, test } from "bun:test";
import type { MailSearchExpression } from "../contracts";
import { validateSearchComplexity } from "./search";

const term: MailSearchExpression = { field: "subject", query: "invoice", match: "words" };

describe("mail search validation", () => {
  test("accepts a bounded boolean expression", () => {
    const expression: MailSearchExpression = {
      and: [term, { not: { field: "from", query: "spam@example.com", match: "exact" } }],
    };
    expect(validateSearchComplexity(expression).ok).toBe(true);
  });

  test("rejects expressions deeper than the execution limit", () => {
    let expression: MailSearchExpression = term;
    for (let depth = 0; depth < 9; depth += 1) expression = { not: expression };
    expect(validateSearchComplexity(expression).ok).toBe(false);
  });

  test("rejects expressions with more than one hundred nodes", () => {
    const expression: MailSearchExpression = { or: Array.from({ length: 101 }, () => term) };
    expect(validateSearchComplexity(expression).ok).toBe(false);
  });

  test("rejects search expressions with excessive aggregate query text", () => {
    const expression: MailSearchExpression = {
      and: Array.from({ length: 11 }, () => ({
        field: "body" as const,
        query: "x".repeat(500),
        match: "contains" as const,
      })),
    };
    expect(validateSearchComplexity(expression).ok).toBe(false);
  });
});
