import { describe, expect, test } from "bun:test";
import { spacesHelp } from ".";

describe("spacesHelp", () => {
  test("serves the existing Spaces help topics as Markdown", async () => {
    expect(spacesHelp.manifest.map((document) => document.id)).toEqual([
      "spaces-start",
      "spaces-views",
      "spaces-workflow",
      "spaces-sharing",
    ]);

    const response = await spacesHelp.router.request("/spaces-start");
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("Spaces is for shared work");
  });
});
