import { describe, expect, test } from "bun:test";
import { filesHelp } from ".";

describe("filesHelp", () => {
  test("serves the existing Files help topics as Markdown", async () => {
    expect(filesHelp.documents.map((document) => document.id)).toEqual(["files-start", "files-work", "files-troubleshooting"]);
    expect(filesHelp.getMarkdown("files-start")).toContain("Files browses the home and group file bases");
    expect(filesHelp.getMarkdown("files-work")).toContain("Most file work happens from the toolbar");
    expect(filesHelp.getMarkdown("files-troubleshooting")).toContain("A home or group base is missing");
  });
});
