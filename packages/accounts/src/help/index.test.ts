import { describe, expect, test } from "bun:test";
import { accountsHelp } from ".";

describe("accountsHelp", () => {
  test("serves the existing Accounts help topics as Markdown", async () => {
    expect(accountsHelp.documents.map((document) => document.id)).toEqual([
      "accounts-start",
      "accounts-admin",
      "accounts-lifecycle",
      "accounts-cli",
    ]);
    expect(accountsHelp.getMarkdown("accounts-start")).toContain("Accounts shows your own account context");
    expect(accountsHelp.getMarkdown("accounts-admin")).toContain("Admin pages are server-rendered lists");
    expect(accountsHelp.getMarkdown("accounts-lifecycle")).toContain("Direct membership");
    expect(accountsHelp.getMarkdown("accounts-cli")).toContain("The Accounts CLI uses the same");
  });
});
