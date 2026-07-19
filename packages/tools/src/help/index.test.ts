import { describe, expect, test } from "bun:test";
import { toolsHelp } from ".";

describe("toolsHelp", () => {
  test("serves the existing Tools help as Markdown", async () => {
    expect(toolsHelp.manifest.map((document) => document.id)).toEqual([
      "tools-start",
      "tools-choose",
      "tools-safety",
    ]);

    const response = await toolsHelp.router.request("/tools-start");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("Tools is a workspace for small generators");
    expect(payload.markdown).toContain("The tester redacts sensitive headers");

    const chooseResponse = await toolsHelp.router.request("/tools-choose");
    const choosePayload = await chooseResponse.json();
    expect(choosePayload.markdown).toContain("The Tools overview groups utilities");

    const safetyResponse = await toolsHelp.router.request("/tools-safety");
    const safetyPayload = await safetyResponse.json();
    expect(safetyPayload.markdown).toContain("Generators, encoders, color conversion");
  });
});
