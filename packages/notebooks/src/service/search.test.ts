import { expect, test } from "bun:test";
import { isBm25CapabilityError } from "./search";

test("BM25 fallback accepts only capability errors", () => {
  expect(isBm25CapabilityError({ code: "42883" })).toBe(true);
  expect(isBm25CapabilityError({ code: "0A000" })).toBe(true);
  expect(isBm25CapabilityError({ code: "23505" })).toBe(false);
  expect(isBm25CapabilityError(new Error("connection failed"))).toBe(false);
});
