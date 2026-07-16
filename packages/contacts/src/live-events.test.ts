import { describe, expect, test } from "bun:test";
import {
  CONTACTS_LIVE_WS_TYPE,
  ContactLiveClientMessageSchema,
  classifyContactScopeChange,
  contactEventBookIds,
  parseContactLiveServerMessage,
  projectContactEvent,
} from "./live-events";

const BOOK_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_BOOK_ID = "22222222-2222-4222-8222-222222222222";
const CONTACT_ID = "33333333-3333-4333-8333-333333333333";
const AT = "2026-07-16T12:00:00.000Z";

describe("Contacts live protocol", () => {
  test("accepts all and manual-book subscriptions", () => {
    expect(
      ContactLiveClientMessageSchema.safeParse({
        type: CONTACTS_LIVE_WS_TYPE.subscribe,
        payload: { scope: { kind: "all" }, fromCursor: "4-2" },
      }).success,
    ).toBe(true);
    expect(
      ContactLiveClientMessageSchema.safeParse({
        type: CONTACTS_LIVE_WS_TYPE.subscribe,
        payload: { scope: { kind: "book", bookId: BOOK_ID }, fromCursor: null },
      }).success,
    ).toBe(true);
  });

  test("rejects malformed cursors and book ids", () => {
    expect(
      ContactLiveClientMessageSchema.safeParse({
        type: CONTACTS_LIVE_WS_TYPE.subscribe,
        payload: { scope: { kind: "book", bookId: "system" }, fromCursor: "latest" },
      }).success,
    ).toBe(false);
  });

  test("rejects unknown server messages", () => {
    expect(parseContactLiveServerMessage(JSON.stringify({ type: "contacts.live.checkpoint", payload: { cursor: "8-1" } }))).toBeNull();
    expect(parseContactLiveServerMessage("not-json")).toBeNull();
  });

  test("classifies scope changes without exposing book identifiers", () => {
    expect(
      parseContactLiveServerMessage(JSON.stringify({ type: CONTACTS_LIVE_WS_TYPE.scopeChanged, payload: { change: "lost" } })),
    ).toEqual({ type: CONTACTS_LIVE_WS_TYPE.scopeChanged, payload: { change: "lost" } });
    expect(
      parseContactLiveServerMessage(
        JSON.stringify({ type: CONTACTS_LIVE_WS_TYPE.scopeChanged, payload: { change: "unknown", bookId: BOOK_ID } }),
      ),
    ).toBeNull();
  });

  test("identifies both books affected by a move", () => {
    expect(
      contactEventBookIds({
        type: "contact.moved",
        sourceBookId: BOOK_ID,
        targetBookId: OTHER_BOOK_ID,
        contactId: CONTACT_ID,
        at: AT,
      }),
    ).toEqual([BOOK_ID, OTHER_BOOK_ID]);
    expect(contactEventBookIds({ type: "contacts.imported", bookId: BOOK_ID, at: AT })).toEqual([BOOK_ID]);
  });

  test("does not expose unreadable move endpoints", () => {
    const moved = {
      type: "contact.moved",
      sourceBookId: BOOK_ID,
      targetBookId: OTHER_BOOK_ID,
      contactId: CONTACT_ID,
      at: AT,
    } as const;

    expect(projectContactEvent(moved, new Set([BOOK_ID]))).toEqual({
      type: "contact.deleted",
      bookId: BOOK_ID,
      contactId: CONTACT_ID,
      at: AT,
    });
    expect(projectContactEvent(moved, new Set([OTHER_BOOK_ID]))).toEqual({
      type: "contact.created",
      bookId: OTHER_BOOK_ID,
      contactId: CONTACT_ID,
      at: AT,
    });
    expect(projectContactEvent(moved, new Set())).toBeNull();
    expect(projectContactEvent(moved, new Set([BOOK_ID, OTHER_BOOK_ID]))).toEqual(moved);
  });

  test("distinguishes gained and lost collection access", () => {
    expect(classifyContactScopeChange(new Set([BOOK_ID]), new Set([BOOK_ID, OTHER_BOOK_ID]))).toBe("gained");
    expect(classifyContactScopeChange(new Set([BOOK_ID, OTHER_BOOK_ID]), new Set([BOOK_ID]))).toBe("lost");
    expect(classifyContactScopeChange(new Set([BOOK_ID]), new Set([OTHER_BOOK_ID]))).toBe("mixed");
  });
});
