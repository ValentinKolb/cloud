import { test, expect } from "bun:test";
import {
  fileHandler,
  jsonHandler,
} from "./tier3";

// ── json ──────────────────────────────────────────────────────────
test("json: parses valid JSON string", () => {
  expect(jsonHandler.validate('{"a":1}', {}, false)).toEqual({ ok: true, value: { a: 1 } });
});
test("json: passes already-parsed object", () => {
  expect(jsonHandler.validate({ x: [1, 2] }, {}, false)).toEqual({ ok: true, value: { x: [1, 2] } });
});
test("json: rejects malformed string", () => {
  expect(jsonHandler.validate("{not json", {}, false).ok).toBe(false);
});

// ── file ──────────────────────────────────────────────────────────
test("file: config accepts maxFiles and accept list", () => {
  expect(fileHandler.configSchema.safeParse({
    maxFiles: 3,
    accept: ["image/*", "application/pdf", ".txt"],
  }).success).toBe(true);
});

test("file: is managed by the external file API", () => {
  expect(fileHandler.kind).toBe("external");
  expect("validate" in fileHandler).toBe(false);
});
