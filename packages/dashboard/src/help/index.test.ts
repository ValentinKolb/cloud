import { describe, expect, test } from "bun:test";
import { dashboardHelp } from ".";

describe("dashboardHelp", () => {
  test("owns the existing Dashboard help as Markdown", () => {
    expect(dashboardHelp.documents.map((document) => document.id)).toEqual(["dashboard-start", "dashboard-troubleshooting"]);

    expect(dashboardHelp.getMarkdown("dashboard-start")).toContain("Dashboard is your personal start page and overview");
    expect(dashboardHelp.getMarkdown("dashboard-start")).toContain("Dashboard settings require a user-backed session.");
    const startHtml = dashboardHelp.documents.find((document) => document.id === "dashboard-start")?.html;
    expect(startHtml).toContain('<h2 id="overview" class="help-section-title"');
    expect(startHtml).toContain("<span>Overview</span>");
    expect(dashboardHelp.getMarkdown("dashboard-troubleshooting")).toContain("App shortcuts can disappear");
  });
});
