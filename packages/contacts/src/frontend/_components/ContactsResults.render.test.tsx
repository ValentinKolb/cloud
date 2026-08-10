import { describe, expect, test } from "bun:test";
import { renderToString } from "solid-js/web";
import type { Contact } from "../../service";
import "./ssr-test-plugin";

const { default: ContactsResults } = await import("./ContactsResults.island.tsx");

const now = "2026-08-10T10:00:00.000Z";
const contact: Contact = {
  id: "ada",
  bookId: "team",
  label: null,
  firstName: "Ada",
  lastName: "Lovelace",
  companyName: null,
  department: null,
  jobTitle: null,
  vatId: null,
  birthday: null,
  salutation: null,
  pronouns: null,
  preferredLanguage: null,
  source: null,
  createdAt: now,
  updatedAt: now,
  emails: [],
  phones: [],
  addresses: [],
  websites: [],
  bankAccounts: [],
  parentContactId: null,
  parent: null,
  members: [],
  tags: [],
};

describe("Contacts results", () => {
  test("renders the exact SSR snapshot without treating detail params as result source", () => {
    const html = renderToString(() => (
      <ContactsResults
        bookId="team"
        initialSearch="Ada"
        initialHref="/app/contacts/team?search=Ada&contact=ada&contactBook=team"
        initialContacts={[contact]}
        initialTotal={1}
        initialPage={1}
        initialTotalPages={1}
        perPage={100}
        bookNames={{ team: "Team contacts" }}
        initialSelectedContactId={contact.id}
        initialSelectedBookId={contact.bookId}
        searchPlaceholder="Filter contacts"
        initialFavoriteKeys={[]}
        canWrite={false}
        writableBooks={[]}
      />
    ));

    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("1 result for “Ada”");
    expect(html).not.toContain("Loading contacts…");
    expect(html).toContain("/app/contacts/team?search=Ada&amp;contact=ada&amp;contactBook=team");
  });
});
