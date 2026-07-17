import { describe, expect, test } from "bun:test";
import {
  dispatchContactsLiveInvalidation,
  listenForContactsLiveInvalidation,
  requiresContactsResultsRefresh,
  requiresContactsShellRefresh,
  requiresSelectedContactRefresh,
} from "./contacts-live";

const BOOK_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "33333333-3333-4333-8333-333333333333";
const AT = "2026-07-16T12:00:00.000Z";

describe("Contacts live invalidation routing", () => {
  test("keeps contact and note changes inside their domain islands", () => {
    const contact = { type: "contact.updated", bookId: BOOK_ID, contactId: CONTACT_ID, at: AT } as const;
    const note = { type: "notes.changed", bookId: BOOK_ID, contactId: CONTACT_ID, at: AT } as const;
    expect(requiresContactsResultsRefresh(contact)).toBe(true);
    expect(requiresContactsShellRefresh(contact)).toBe(false);
    expect(requiresContactsResultsRefresh(note)).toBe(false);
    expect(requiresContactsShellRefresh(note)).toBe(false);
  });

  test("refreshes the SSR shell for visibility and metadata changes", () => {
    expect(requiresContactsShellRefresh({ type: "scope.changed" })).toBe(true);
    expect(requiresContactsShellRefresh({ type: "access.changed", bookId: BOOK_ID, at: AT })).toBe(true);
    expect(requiresContactsShellRefresh({ type: "tags.changed", bookId: BOOK_ID, at: AT })).toBe(true);
  });

  test("refreshes an open detail for bulk, tag, and permission changes in its book", () => {
    const otherBookId = "22222222-2222-4222-8222-222222222222";
    expect(requiresSelectedContactRefresh({ type: "contacts.changed", bookId: BOOK_ID, at: AT }, BOOK_ID)).toBe(true);
    expect(requiresSelectedContactRefresh({ type: "tags.changed", bookId: BOOK_ID, at: AT }, BOOK_ID)).toBe(true);
    expect(requiresSelectedContactRefresh({ type: "access.changed", bookId: BOOK_ID, at: AT }, BOOK_ID)).toBe(true);
    expect(requiresSelectedContactRefresh({ type: "contacts.changed", bookId: otherBookId, at: AT }, BOOK_ID)).toBe(false);
  });

  test("waits for every domain refresh before acknowledging an invalidation", async () => {
    const originalWindow = globalThis.window;
    const target = new EventTarget();
    (globalThis as unknown as { window: EventTarget }).window = target;
    const applied: string[] = [];
    const stopFirst = listenForContactsLiveInvalidation(async () => {
      await Promise.resolve();
      applied.push("first");
    });
    const stopSecond = listenForContactsLiveInvalidation(() => {
      applied.push("second");
    });

    try {
      await dispatchContactsLiveInvalidation({ type: "contact.updated", bookId: BOOK_ID, contactId: CONTACT_ID, at: AT });
      expect(applied).toEqual(["second", "first"]);
    } finally {
      stopFirst();
      stopSecond();
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
  });

  test("rejects only after all domain refreshes have settled", async () => {
    const originalWindow = globalThis.window;
    const target = new EventTarget();
    (globalThis as unknown as { window: EventTarget }).window = target;
    let completed = false;
    const stopFailing = listenForContactsLiveInvalidation(async () => {
      throw new Error("refresh failed");
    });
    const stopCompleting = listenForContactsLiveInvalidation(async () => {
      await Promise.resolve();
      completed = true;
    });

    try {
      await expect(
        dispatchContactsLiveInvalidation({ type: "contact.updated", bookId: BOOK_ID, contactId: CONTACT_ID, at: AT }),
      ).rejects.toThrow("refresh failed");
      expect(completed).toBe(true);
    } finally {
      stopFailing();
      stopCompleting();
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
  });
});
