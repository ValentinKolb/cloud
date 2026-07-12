import { describe, expect, test } from "bun:test";
import {
  buildContactDetailHref,
  buildContactsPaginationBaseHref,
  buildContactsSearchHref,
  contactsResultSignature,
} from "./contacts-search";

describe("Contacts search route state", () => {
  test("keeps the visible scope while replacing search-owned state", () => {
    expect(buildContactsSearchHref("/app/contacts/book-1?tag_id=vip&page=4&contact=contact-1&contactBook=book-1", "  Ada Lovelace  ")).toBe(
      "/app/contacts/book-1?tag_id=vip&search=Ada+Lovelace",
    );
  });

  test("clears an empty search and selected detail", () => {
    expect(buildContactsSearchHref("/app/contacts?search=Ada&contact=contact-1&contactBook=book-1", " ")).toBe("/app/contacts");
  });

  test("tracks only result-affecting state and builds pagination links", () => {
    expect(contactsResultSignature("/app/contacts/book-1?search=Ada&contact=one")).toBe(
      contactsResultSignature("/app/contacts/book-1?search=Ada&contact=two"),
    );
    expect(buildContactsPaginationBaseHref("/app/contacts/book-1?tag_id=vip&search=Ada&page=2&contact=one")).toBe(
      "/app/contacts/book-1?tag_id=vip&search=Ada&page=",
    );
  });

  test("keeps list scope in real contact detail links", () => {
    expect(buildContactDetailHref("/app/contacts/book-1?search=Ada&tag_id=vip", "contact-1", "book-1")).toBe(
      "/app/contacts/book-1?search=Ada&tag_id=vip&contact=contact-1&contactBook=book-1",
    );
  });
});
