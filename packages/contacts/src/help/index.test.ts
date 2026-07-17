import { describe, expect, test } from "bun:test";
import { contactsHelp } from ".";

describe("contactsHelp", () => {
  test("serves the existing Contacts help topics as Markdown", async () => {
    expect(contactsHelp.manifest.map((document) => document.id)).toEqual([
      "contacts-start",
      "contacts-hierarchy",
      "contacts-books-sharing",
    ]);

    const startResponse = await contactsHelp.router.request("/contacts-start");
    const startPayload = await startResponse.json();
    expect(startResponse.status).toBe(200);
    expect(startPayload.markdown).toContain("Contacts keeps manual address books");

    const hierarchyResponse = await contactsHelp.router.request("/contacts-hierarchy");
    const hierarchyPayload = await hierarchyResponse.json();
    expect(hierarchyPayload.markdown).toContain("Contact hierarchy links records");

    const booksResponse = await contactsHelp.router.request("/contacts-books-sharing");
    const booksPayload = await booksResponse.json();
    expect(booksPayload.markdown).toContain("Contact book settings control metadata");
  });
});
