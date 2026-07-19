import { describe, expect, test } from "bun:test";
import { spacesHelp } from ".";

describe("spacesHelp", () => {
  test("serves the existing Spaces help topics as Markdown", async () => {
    expect(spacesHelp.manifest.map((document) => document.id)).toEqual([
      "spaces-start",
      "spaces-views",
      "spaces-workflow",
      "spaces-sharing",
      "spaces-troubleshooting",
    ]);

    const response = await spacesHelp.router.request("/spaces-start");
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("Spaces is for shared work");

    const troubleshootingResponse = await spacesHelp.router.request("/spaces-troubleshooting");
    const troubleshootingPayload = await troubleshootingResponse.json();
    expect(troubleshootingPayload.markdown).toContain("A space is missing from the overview");
  });
});
