import { describe, expect, test } from "bun:test";
import { migrateDashboardValueFormats } from "./dashboard-value-format-migration";

describe("dashboard value format migration", () => {
  test("converts every legacy value format without changing unrelated widgets", () => {
    const markdown = { id: "m", kind: "markdown", markdown: "format stays content" };
    const migrated = migrateDashboardValueFormats({
      rows: [
        {
          id: "r",
          kind: "row",
          height: "sm",
          cells: [
            { id: "currency", kind: "stat", format: "currency" },
            { id: "percent", kind: "chart", format: "percent" },
            { id: "integer", kind: "stat", format: "integer" },
            { id: "plain", kind: "chart", format: "plain" },
            markdown,
          ],
        },
      ],
    });

    expect(migrated).toEqual({
      rows: [
        {
          id: "r",
          kind: "row",
          height: "sm",
          cells: [
            {
              id: "currency",
              kind: "stat",
              valueFormat: { style: "number", decimalPlaces: 2, unit: "EUR", unitPosition: "suffix" },
            },
            { id: "percent", kind: "chart", valueFormat: { style: "percent" } },
            { id: "integer", kind: "stat", valueFormat: { style: "integer" } },
            { id: "plain", kind: "chart", valueFormat: { style: "number" } },
            markdown,
          ],
        },
      ],
    });
  });

  test("keeps an existing valueFormat and is idempotent", () => {
    const config = {
      rows: [
        {
          cells: [
            {
              kind: "stat",
              format: "currency",
              valueFormat: { style: "number", unit: "CHF", unitPosition: "prefix" },
            },
          ],
        },
      ],
    };
    const once = migrateDashboardValueFormats(config);
    const twice = migrateDashboardValueFormats(once);

    expect(once).toEqual({
      rows: [{ cells: [{ kind: "stat", valueFormat: { style: "number", unit: "CHF", unitPosition: "prefix" } }] }],
    });
    expect(twice).toBe(once);
  });

  test("leaves malformed dashboard data untouched", () => {
    const config = { rows: "not-an-array" };
    expect(migrateDashboardValueFormats(config)).toBe(config);
  });
});
