import { describe, expect, test } from "bun:test";
import { dashboardHelp } from ".";

describe("dashboardHelp", () => {
  test("serves the existing Dashboard help as Markdown", async () => {
    expect(dashboardHelp.manifest.map((document) => document.id)).toEqual(["dashboard-start"]);

    const response = await dashboardHelp.router.request("/dashboard-start");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("Dashboard is your personal start page.");
    expect(payload.markdown).toContain("Dashboard settings require a user-backed session.");
    expect(payload.html).toContain("<h2>Overview</h2>");
  });
});
