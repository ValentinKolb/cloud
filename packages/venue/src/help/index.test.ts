import { describe, expect, test } from "bun:test";
import { venueHelp } from ".";

describe("venueHelp", () => {
  test("serves the existing Venue help topics as Markdown", async () => {
    expect(venueHelp.manifest.map((document) => document.id)).toEqual([
      "venue-start",
      "venue-work",
      "venue-troubleshooting",
    ]);

    const startResponse = await venueHelp.router.request("/venue-start");
    const startPayload = await startResponse.json();
    expect(startResponse.status).toBe(200);
    expect(startPayload.markdown).toContain("Venues manages staffed places");

    const workResponse = await venueHelp.router.request("/venue-work");
    const workPayload = await workResponse.json();
    expect(workPayload.markdown).toContain("The venue workspace separates daily staffing");

    const troubleshootingResponse = await venueHelp.router.request("/venue-troubleshooting");
    const troubleshootingPayload = await troubleshootingResponse.json();
    expect(troubleshootingPayload.markdown).toContain("The public page shows the wrong opening status");
  });
});
