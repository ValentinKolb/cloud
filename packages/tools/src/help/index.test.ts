import { describe, expect, test } from "bun:test";
import { toolsHelp } from ".";

describe("toolsHelp", () => {
  test("serves the existing Tools help as Markdown", async () => {
    expect(toolsHelp.manifest.map((document) => document.id)).toEqual(["tools-start"]);

    const response = await toolsHelp.router.request("/tools-start");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("Tools is a workspace for small generators");
    expect(payload.markdown).toContain("The tester redacts sensitive headers");
  });
});
