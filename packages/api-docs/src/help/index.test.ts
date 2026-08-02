import { describe, expect, test } from "bun:test";
import { apiDocsHelp } from ".";

describe("apiDocsHelp", () => {
  test("owns the API Docs overview guidance as Markdown", () => {
    expect(apiDocsHelp.documents.map((document) => document.id)).toEqual(["api-docs-start"]);

    expect(apiDocsHelp.getMarkdown("api-docs-start")).toContain("Start here before choosing an app");
    expect(apiDocsHelp.getMarkdown("api-docs-start")).toContain("cld api-docs search");
  });
});
