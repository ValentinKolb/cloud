import { expect, test } from "bun:test";
import { booleanHandler } from "./boolean";

test("boolean: native booleans pass through", () => {
  expect(booleanHandler.validate(true, {}, false)).toEqual({ ok: true, value: true });
  expect(booleanHandler.validate(false, {}, false)).toEqual({ ok: true, value: false });
});

test("boolean: coerces common form encodings", () => {
  expect(booleanHandler.validate("true", {}, false)).toEqual({ ok: true, value: true });
  expect(booleanHandler.validate("false", {}, false)).toEqual({ ok: true, value: false });
  expect(booleanHandler.validate(1, {}, false)).toEqual({ ok: true, value: true });
  expect(booleanHandler.validate(0, {}, false)).toEqual({ ok: true, value: false });
});

test("boolean: required rejects null", () => {
  expect(booleanHandler.validate(null, {}, true).ok).toBe(false);
});

test("boolean: rejects garbage strings", () => {
  expect(booleanHandler.validate("yes", {}, false).ok).toBe(false);
  expect(booleanHandler.validate("nope", {}, false).ok).toBe(false);
});
