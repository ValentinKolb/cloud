import { expect, test } from "bun:test";
import { clearSelectedContactInUrl } from "./context";

test("live reconciliation replaces invalid detail history", () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalHistory = globalThis.history;
  const calls: string[] = [];
  const target = new EventTarget();
  (globalThis as unknown as { window: unknown }).window = Object.assign(target, {
    location: { href: "http://localhost/app/contacts/book?contact=contact-id&contactBook=book-id" },
  });
  (globalThis as unknown as { document: unknown }).document = {};
  (globalThis as unknown as { history: unknown }).history = {
    pushState: () => calls.push("push"),
    replaceState: () => calls.push("replace"),
  };

  try {
    clearSelectedContactInUrl("replace");
    expect(calls).toEqual(["replace"]);
  } finally {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
    (globalThis as unknown as { document: unknown }).document = originalDocument;
    (globalThis as unknown as { history: unknown }).history = originalHistory;
  }
});
