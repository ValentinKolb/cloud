import { describe, expect, test } from "bun:test";
import type { PulseDashboardCondition } from "../contracts";
import { formatDashboardConditionText, matchDashboardCondition } from "./dashboard-conditions";

describe("Pulse dashboard conditions", () => {
  test("returns the first matching warning condition", () => {
    const conditions: PulseDashboardCondition[] = [
      { level: "warn", operator: ">", value: 80, message: "Memory is high" },
      { level: "critical", operator: ">", value: 95, message: "Memory is critical" },
    ];

    expect(matchDashboardCondition(conditions, 90)).toEqual(conditions[0]!);
  });

  test("prefers a later critical condition over a matching warning", () => {
    const conditions: PulseDashboardCondition[] = [
      { level: "warn", operator: ">", value: 80, message: "Memory is high" },
      { level: "critical", operator: ">", value: 95, message: "Memory is critical" },
    ];

    expect(matchDashboardCondition(conditions, 99)).toEqual(conditions[1]!);
  });

  test("ignores non-numeric condition values for numeric matching", () => {
    const conditions: PulseDashboardCondition[] = [{ level: "warn", operator: ">", value: "not-a-number", message: null }];

    expect(matchDashboardCondition(conditions, 99)).toBeNull();
  });

  test("formats condition fallback text", () => {
    expect(formatDashboardConditionText({ level: "critical", operator: "<", value: 10, message: null })).toBe(
      "Critical when value < 10",
    );
  });
});
