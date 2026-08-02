import { describe, expect, test } from "bun:test";
import { coreHelp } from ".";

describe("coreHelp", () => {
  test("owns the existing Core help topics as Markdown", () => {
    expect(coreHelp.documents.map((document) => document.id)).toEqual([
      "core-start",
      "core-profile",
      "core-security",
      "core-notifications",
      "core-admin",
    ]);

    expect(coreHelp.getMarkdown("core-start")).toContain("Core owns platform-level pages and services");
    expect(coreHelp.getMarkdown("core-security")).toContain("The available sign-in methods depend");
    expect(coreHelp.getMarkdown("core-notifications")).toContain("Notifications keep account and app events");
    expect(coreHelp.getMarkdown("core-admin")).toContain("Core admin pages configure platform services");
  });
});
