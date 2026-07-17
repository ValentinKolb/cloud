import { describe, expect, test } from "bun:test";
import { uiLabHelp } from ".";

describe("uiLabHelp", () => {
  test("serves the existing UI Lab help topics as Markdown", async () => {
    expect(uiLabHelp.manifest.map((document) => document.id)).toEqual(["ui-lab-start", "ui-lab-reference"]);

    const response = await uiLabHelp.router.request("/ui-lab-start");
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("UI Lab is the shared Cloud component showcase");
  });
});
