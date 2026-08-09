import { expect, test } from "bun:test";
import { clearSelectedContactInUrl } from "./context";
import { setDesktopDetailVisibility } from "./DesktopDetailLayoutSync.island";

test("opens and closes the AppWorkspace detail through its hidden state", () => {
  const originalDocument = globalThis.document;
  const detail = { hidden: true } as HTMLElement;
  const requestedIds: string[] = [];
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => {
      requestedIds.push(id);
      return detail;
    },
  };

  try {
    setDesktopDetailVisibility("contacts-detail-panel", true);
    expect(detail.hidden).toBe(false);
    setDesktopDetailVisibility("contacts-detail-panel", false);
    expect(detail.hidden).toBe(true);
    expect(requestedIds).toEqual(["k2b-workspace-detail-contacts-detail-panel", "k2b-workspace-detail-contacts-detail-panel"]);
  } finally {
    (globalThis as unknown as { document: unknown }).document = originalDocument;
  }
});

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
