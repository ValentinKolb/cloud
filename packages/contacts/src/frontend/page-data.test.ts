import { describe, expect, test } from "bun:test";
import { buildContactsPaginationBaseUrl, parseContactsPage } from "./page-data";

describe("contacts page state", () => {
  test("normalizes invalid page values", () => {
    expect(parseContactsPage(undefined)).toBe(1);
    expect(parseContactsPage("0")).toBe(1);
    expect(parseContactsPage("2.5")).toBe(1);
    expect(parseContactsPage("3")).toBe(3);
  });

  test("preserves search and tag filters across pagination", () => {
    expect(
      buildContactsPaginationBaseUrl({
        basePath: "/app/contacts/book-1",
        search: "  Alice & Bob  ",
        tagId: "tag-1",
      }),
    ).toBe("/app/contacts/book-1?search=Alice+%26+Bob&tag_id=tag-1&page=");
  });

  test("keeps the unfiltered pagination URL compact", () => {
    expect(buildContactsPaginationBaseUrl({ basePath: "/app/contacts", search: "" })).toBe("/app/contacts?page=");
  });
});
