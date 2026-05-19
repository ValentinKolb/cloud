import { describe, expect, test } from "bun:test";
import { materializeFieldDefault, validateDefaultValue } from "./fields";
import type { Field } from "./types";

const dateField = (defaultValue: unknown, includeTime = false): Field => ({
  id: "date",
  shortId: "date",
  tableId: "table",
  name: "date",
  description: null,
  type: "date",
  config: { includeTime },
  position: 0,
  required: false,
  presentable: false,
  hideInTable: false,
  defaultValue,
  indexed: false,
  uniqueConstraint: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("date defaults", () => {
  test("accepts dynamic now as the only object default for date fields", () => {
    expect(validateDefaultValue("date", {}, { kind: "now" }).ok).toBe(true);
    expect(validateDefaultValue("date", {}, { kind: "now", value: "2026-01-01" }).ok).toBe(false);
    expect(validateDefaultValue("date", {}, { kind: "fixed", value: "2026-01-01" }).ok).toBe(false);
  });

  test("materializes now server-side", () => {
    const value = materializeFieldDefault(dateField({ kind: "now" }));
    expect(typeof value).toBe("string");
    expect(String(value)).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const timed = materializeFieldDefault(dateField({ kind: "now" }, true));
    expect(typeof timed).toBe("string");
    expect(String(timed)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(String(timed)).not.toMatch(/Z|[+-]\d{2}:\d{2}$/);
  });
});
