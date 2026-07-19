import { describe, expect, test } from "bun:test";
import { apiDocsHelp } from ".";

describe("apiDocsHelp", () => {
  test("serves the API Docs overview guidance as Markdown", async () => {
    expect(apiDocsHelp.manifest.map((document) => document.id)).toEqual(["api-docs-start"]);

    const response = await apiDocsHelp.router.request("/api-docs-start");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("Start here before choosing an app");
    expect(payload.markdown).toContain("cld api-docs search");
  });
});
