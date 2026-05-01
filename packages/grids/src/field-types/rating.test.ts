import { test, expect } from "bun:test";
import { ratingHandler } from "./rating";

test("rating: accepts integer in range with default scale 5", () => {
  expect(ratingHandler.validate(3, {}, false)).toEqual({ ok: true, value: 3 });
  expect(ratingHandler.validate(5, {}, false)).toEqual({ ok: true, value: 5 });
});

test("rating: 0 collapses to null (= unrated)", () => {
  expect(ratingHandler.validate(0, {}, false)).toEqual({ ok: true, value: null });
});

test("rating: rejects out-of-range", () => {
  expect(ratingHandler.validate(6, {}, false).ok).toBe(false);
  expect(ratingHandler.validate(-1, {}, false).ok).toBe(false);
});

test("rating: respects custom scale", () => {
  expect(ratingHandler.validate(8, { scale: 10 }, false)).toEqual({ ok: true, value: 8 });
  expect(ratingHandler.validate(11, { scale: 10 }, false).ok).toBe(false);
});

test("rating: rejects floats", () => {
  expect(ratingHandler.validate(2.5, {}, false).ok).toBe(false);
});

test("rating: required rejects null/0", () => {
  expect(ratingHandler.validate(null, {}, true).ok).toBe(false);
  expect(ratingHandler.validate(0, {}, true).ok).toBe(false);
});
