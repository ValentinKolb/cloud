import { describe, expect, test } from "bun:test";
import { contactsHelp } from ".";

describe("contactsHelp", () => {
  test("serves the existing Contacts help topics as Markdown", async () => {
    expect(contactsHelp.documents.map((document) => document.id)).toEqual([
      "contacts-start",
      "contacts-work",
      "contacts-hierarchy",
      "contacts-books-sharing",
    ]);
    expect(contactsHelp.getMarkdown("contacts-start")).toContain("Contacts keeps manual address books");
    expect(contactsHelp.getMarkdown("contacts-work")).toContain("The Contacts overview is a working view");
    expect(contactsHelp.getMarkdown("contacts-hierarchy")).toContain("Contact hierarchy links records");
    expect(contactsHelp.getMarkdown("contacts-books-sharing")).toContain("Contact book settings control metadata");
  });
});
