import { describe, expect, test } from "bun:test";
import { filesHelp } from ".";

describe("filesHelp", () => {
  test("serves the existing Files help topics as Markdown", async () => {
    expect(filesHelp.manifest.map((document) => document.id)).toEqual(["files-start", "files-work"]);

    const startResponse = await filesHelp.router.request("/files-start");
    const startPayload = await startResponse.json();
    expect(startResponse.status).toBe(200);
    expect(startPayload.markdown).toContain("Files browses the home and group file bases");

    const workResponse = await filesHelp.router.request("/files-work");
    const workPayload = await workResponse.json();
    expect(workPayload.markdown).toContain("Most file work happens from the toolbar");
  });
});
