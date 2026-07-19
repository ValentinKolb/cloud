import { describe, expect, test } from "bun:test";
import { contactsHelp } from ".";

describe("contactsHelp", () => {
  test("serves the existing Contacts help topics as Markdown", async () => {
    expect(contactsHelp.manifest.map((document) => document.id)).toEqual([
      "contacts-start",
      "contacts-work",
      "contacts-hierarchy",
      "contacts-books-sharing",
    ]);

    const startResponse = await contactsHelp.router.request("/contacts-start");
    const startPayload = await startResponse.json();
    expect(startResponse.status).toBe(200);
    expect(startPayload.markdown).toContain("Contacts keeps manual address books");

    const workResponse = await contactsHelp.router.request("/contacts-work");
    const workPayload = await workResponse.json();
    expect(workPayload.markdown).toContain("The Contacts overview is a working view");

    const hierarchyResponse = await contactsHelp.router.request("/contacts-hierarchy");
    const hierarchyPayload = await hierarchyResponse.json();
    expect(hierarchyPayload.markdown).toContain("Contact hierarchy links records");

    const booksResponse = await contactsHelp.router.request("/contacts-books-sharing");
    const booksPayload = await booksResponse.json();
    expect(booksPayload.markdown).toContain("Contact book settings control metadata");
  });
});
