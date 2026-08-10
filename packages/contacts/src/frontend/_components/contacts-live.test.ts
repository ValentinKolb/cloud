import { describe, expect, test } from "bun:test";
import {
  createContactsLiveApplyQueue,
  dispatchContactsLiveInvalidation,
  listenForContactsLiveInvalidation,
  requiresContactsResultsRefresh,
  requiresContactsShellRefresh,
  requiresSelectedContactRefresh,
} from "./contacts-live";

const BOOK_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "33333333-3333-4333-8333-333333333333";
const AT = "2026-07-16T12:00:00.000Z";
const NO_SELECTION = { bookId: null, contactId: null };

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

  test("refreshes an open detail for contact changes inside its current book", () => {
    const otherBookId = "22222222-2222-4222-8222-222222222222";
    expect(requiresSelectedContactRefresh({ type: "contacts.changed", bookId: BOOK_ID, at: AT }, BOOK_ID)).toBe(true);
    expect(requiresSelectedContactRefresh({ type: "contact.updated", bookId: BOOK_ID, contactId: CONTACT_ID, at: AT }, BOOK_ID)).toBe(true);
    expect(requiresSelectedContactRefresh({ type: "notes.changed", bookId: BOOK_ID, contactId: CONTACT_ID, at: AT }, BOOK_ID)).toBe(false);
    expect(requiresSelectedContactRefresh({ type: "contacts.changed", bookId: otherBookId, at: AT }, BOOK_ID)).toBe(false);
  });

  test("waits for every domain refresh before acknowledging an invalidation", async () => {
    const originalWindow = globalThis.window;
    const target = new EventTarget();
    (globalThis as unknown as { window: EventTarget }).window = target;
    const applied: string[] = [];
    const stopFirst = listenForContactsLiveInvalidation("results", async () => {
      await Promise.resolve();
      applied.push("first");
    });
    const stopSecond = listenForContactsLiveInvalidation("detail", async () => {
      applied.push("second");
    });

    try {
      await dispatchContactsLiveInvalidation(
        { type: "contact.updated", bookId: BOOK_ID, contactId: CONTACT_ID, at: AT },
        { bookId: BOOK_ID, contactId: CONTACT_ID },
      );
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
    const stopFailing = listenForContactsLiveInvalidation("results", async () => {
      throw new Error("refresh failed");
    });
    const stopCompleting = listenForContactsLiveInvalidation("detail", async () => {
      await Promise.resolve();
      completed = true;
    });

    try {
      await expect(
        dispatchContactsLiveInvalidation(
          { type: "contact.updated", bookId: BOOK_ID, contactId: CONTACT_ID, at: AT },
          { bookId: BOOK_ID, contactId: CONTACT_ID },
        ),
      ).rejects.toThrow("refresh failed");
      expect(completed).toBe(true);
    } finally {
      stopFailing();
      stopCompleting();
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
  });

  test("rejects replayed result events until the results owner registers coverage", async () => {
    const originalWindow = globalThis.window;
    const target = new EventTarget();
    (globalThis as unknown as { window: EventTarget }).window = target;
    const stopDetail = listenForContactsLiveInvalidation("detail", async () => {});

    try {
      await expect(
        dispatchContactsLiveInvalidation({ type: "contact.updated", bookId: BOOK_ID, contactId: CONTACT_ID, at: AT }, NO_SELECTION),
      ).rejects.toThrow("Contacts live results coverage is not ready");

      const order: string[] = [];
      const queue = createContactsLiveApplyQueue({
        apply: (event) => dispatchContactsLiveInvalidation(event, NO_SELECTION),
        onFailure: (error) => {
          order.push(`failed:${error instanceof Error ? error.message : "unknown"}`);
        },
      });
      await queue.enqueue({ type: "contact.updated", bookId: BOOK_ID, contactId: CONTACT_ID, at: AT }, "7-1", {
        markApplied: (cursor) => order.push(`mark:${cursor}`),
        terminate: () => order.push("terminated"),
      });
      expect(order).toEqual(["failed:Contacts live results coverage is not ready"]);
    } finally {
      stopDetail();
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
  });

  test("accepts a note event without coverage when that contact is not selected", async () => {
    const originalWindow = globalThis.window;
    const target = new EventTarget();
    (globalThis as unknown as { window: EventTarget }).window = target;

    try {
      await expect(
        dispatchContactsLiveInvalidation({ type: "notes.changed", bookId: BOOK_ID, contactId: CONTACT_ID, at: AT }, NO_SELECTION),
      ).resolves.toBeUndefined();
    } finally {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
  });

  test("requires notes coverage when the changed contact is selected", async () => {
    const originalWindow = globalThis.window;
    const target = new EventTarget();
    (globalThis as unknown as { window: EventTarget }).window = target;

    try {
      await expect(
        dispatchContactsLiveInvalidation(
          { type: "notes.changed", bookId: BOOK_ID, contactId: CONTACT_ID, at: AT },
          { bookId: BOOK_ID, contactId: CONTACT_ID },
        ),
      ).rejects.toThrow("Contacts live notes coverage is not ready");
    } finally {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
  });

  test("applies events serially and advances each cursor only after coverage", async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstCoverage = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const queue = createContactsLiveApplyQueue({
      apply: async (event) => {
        order.push(`apply:${event.type}`);
        if (event.type === "contact.updated") await firstCoverage;
        order.push(`covered:${event.type}`);
      },
      onFailure: () => {
        order.push("failed");
      },
    });
    const controls = {
      markApplied: (cursor: string) => order.push(`mark:${cursor}`),
      terminate: () => order.push("terminated"),
    };

    const first = queue.enqueue({ type: "contact.updated", bookId: BOOK_ID, contactId: CONTACT_ID, at: AT }, "7-1", controls);
    const second = queue.enqueue({ type: "notes.changed", bookId: BOOK_ID, contactId: CONTACT_ID, at: AT }, "7-2", controls);
    await Promise.resolve();
    expect(order).toEqual(["apply:contact.updated"]);

    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual([
      "apply:contact.updated",
      "covered:contact.updated",
      "mark:7-1",
      "apply:notes.changed",
      "covered:notes.changed",
      "mark:7-2",
    ]);
  });

  test("stops the queue without acknowledging the failing event or later events", async () => {
    const order: string[] = [];
    const queue = createContactsLiveApplyQueue({
      apply: async (event) => {
        order.push(`apply:${event.type}`);
        throw new Error("coverage failed");
      },
      onFailure: (error) => {
        order.push(`failed:${error instanceof Error ? error.message : "unknown"}`);
      },
    });
    const controls = {
      markApplied: (cursor: string) => order.push(`mark:${cursor}`),
      terminate: () => order.push("terminated"),
    };

    const first = queue.enqueue({ type: "contact.updated", bookId: BOOK_ID, contactId: CONTACT_ID, at: AT }, "7-1", controls);
    const second = queue.enqueue({ type: "notes.changed", bookId: BOOK_ID, contactId: CONTACT_ID, at: AT }, "7-2", controls);
    await Promise.all([first, second]);

    expect(order).toEqual(["apply:contact.updated", "failed:coverage failed"]);
  });
});
