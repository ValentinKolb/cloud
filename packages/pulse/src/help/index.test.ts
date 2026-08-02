import { describe, expect, test } from "bun:test";
import { pulseHelp } from ".";

describe("pulse help", () => {
  test("keeps the existing topics in their established order", () => {
    expect(pulseHelp.documents.map((document) => document.id)).toEqual([
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
    const queryHelp = pulseHelp.getMarkdown("pulse-query-language");
    const dashboardHelp = pulseHelp.getMarkdown("pulse-dashboard-dsl");
    expect(queryHelp).toContain("metric http_requests_total rate every 1m since 1h");
    expect(queryHelp).toContain("more than 2,000 time windows");
    expect(queryHelp).toContain("Metric queries use two reduction stages");
    expect(queryHelp).toContain("group by resource");
    expect(queryHelp).toContain("Shared clauses may follow");
    expect(queryHelp).toContain("backslash escapes the next character");
    expect(queryHelp).toContain("Query text is limited to 2,000 characters");
    expect(dashboardHelp).toContain("Public displays use control defaults");
    expect(dashboardHelp).toContain("Cards cannot contain nested cards or sections");
    expect(dashboardHelp).toContain("dashboard, section, row, card");
    expect(dashboardHelp).toContain('An empty `dashboard "Name" {}` document is valid');
    expect(dashboardHelp).toContain("Dashboard statements and visual names are case-sensitive");
    expect(dashboardHelp).toContain("`visual <type>`");
    expect(dashboardHelp).toContain('map "Recent engagement"');
    expect(dashboardHelp).toContain("latitude attribute geo.latitude");
    expect(dashboardHelp).toContain("Sensitive fields cannot be selected");
    expect(dashboardHelp).toContain("at most 1,000 aggregated points");
    expect(dashboardHelp).toContain("Dashboard DSL is limited to 40,000 characters");
  });

  test("keeps implementation details out of end-user help", () => {
    const help = pulseHelp.documents.map((document) => pulseHelp.getMarkdown(document.id)).join("\n");
    expect(help).not.toMatch(
      /\bPostgres(?:QL)?\b|\bTimescaleDB\b|\bSQL\b|background jobs?|hourly metric rollups?|continuous aggregates?|time_bucket|\bKiB\b|\bMiB\b|storage engine|source of truth|\bcanonical\b|\bparser\b|\bcompiler\b|raw events?|high-cardinality/i,
    );
  });
});
