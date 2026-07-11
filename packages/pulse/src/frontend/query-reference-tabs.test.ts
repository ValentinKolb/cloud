import { describe, expect, test } from "bun:test";
import { defaultReferenceTab, isAvailableReferenceTab, readReferenceTab, referenceTabs } from "./query-reference-tabs";

describe("Pulse query reference tabs", () => {
  test("defaults to overview for query reference and dashboard for dashboard DSL reference", () => {
    expect(defaultReferenceTab(false)).toBe("overview");
    expect(defaultReferenceTab(true)).toBe("dashboard");
  });

  test("only allows the dashboard tab when dashboard DSL help is included", () => {
    expect(referenceTabs(false).map((tab) => tab.value)).toEqual(["overview", "query", "inventory"]);
    expect(referenceTabs(true).map((tab) => tab.value)).toEqual(["overview", "query", "dashboard", "inventory"]);
    expect(isAvailableReferenceTab("dashboard", false)).toBe(false);
    expect(isAvailableReferenceTab("dashboard", true)).toBe(true);
  });

  test("reads query params with stable fallbacks", () => {
    expect(readReferenceTab("query", false)).toBe("query");
    expect(readReferenceTab("inventory", true)).toBe("inventory");
    expect(readReferenceTab("dashboard", false)).toBe("overview");
    expect(readReferenceTab("unknown", true)).toBe("dashboard");
    expect(readReferenceTab(null, false)).toBe("overview");
  });
});
