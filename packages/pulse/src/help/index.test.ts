import { describe, expect, test } from "bun:test";
import { pulseHelp } from ".";

describe("pulse help", () => {
  test("keeps the existing topics in their established order", () => {
    expect(pulseHelp.manifest.map((document) => document.id)).toEqual([
      "pulse-start",
      "pulse-data-model",
      "pulse-find-data",
      "pulse-query-language",
      "pulse-dashboard-dsl",
      "pulse-reference",
      "pulse-operate",
    ]);
  });

  test("preserves the query and dashboard reference content", () => {
    expect(pulseHelp.getMarkdown("pulse-query-language")).toContain("metric http_requests_total rate every 1m since 1h");
    expect(pulseHelp.getMarkdown("pulse-dashboard-dsl")).toContain("Public displays use the default values");
  });
});
