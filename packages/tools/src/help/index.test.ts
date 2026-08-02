import { describe, expect, test } from "bun:test";
import { toolsHelp } from ".";

describe("toolsHelp", () => {
  test("owns the existing Tools help as Markdown", () => {
    expect(toolsHelp.documents.map((document) => document.id)).toEqual(["tools-start", "tools-choose", "tools-safety"]);

    expect(toolsHelp.getMarkdown("tools-start")).toContain("Tools is a workspace for small generators");
    expect(toolsHelp.getMarkdown("tools-start")).toContain("The tester redacts sensitive headers");
    expect(toolsHelp.getMarkdown("tools-choose")).toContain("The Tools overview groups utilities");
    expect(toolsHelp.getMarkdown("tools-safety")).toContain("Generators, encoders, color conversion");
  });
});
