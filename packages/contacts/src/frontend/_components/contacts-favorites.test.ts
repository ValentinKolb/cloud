import { afterEach, describe, expect, test } from "bun:test";
import { createContactFavoriteMutationLifecycle, listenForContactFavoriteChanges, saveContactFavorite } from "./contacts-favorites";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as unknown as { window: unknown }).window = originalWindow;
});

describe("contact favorites", () => {
  test("rejects a same-tick second toggle before mutation loading becomes reactive", () => {
    const lifecycle = createContactFavoriteMutationLifecycle("book-1:contact-1");

    expect(lifecycle.begin("book-1:contact-1")).toBe(true);
    expect(lifecycle.begin("book-1:contact-1")).toBe(false);
    expect(lifecycle.busy()).toBe(true);
  });

  test("keeps a new source busy when the old source abort settles late", () => {
    const lifecycle = createContactFavoriteMutationLifecycle("book-1:contact-1");
    expect(lifecycle.begin("book-1:contact-1")).toBe(true);
    expect(lifecycle.switchSource("book-1:contact-2")).toBe(true);
    expect(lifecycle.owns("book-1:contact-1")).toBe(false);

    expect(lifecycle.begin("book-1:contact-2")).toBe(true);
    expect(lifecycle.settle("book-1:contact-1")).toBe(false);
    expect(lifecycle.busy()).toBe(true);
    expect(lifecycle.settle("book-1:contact-2")).toBe(true);
    expect(lifecycle.busy()).toBe(false);
  });

  test("passes the owner abort signal and publishes only the saved immutable intent", async () => {
    const target = new EventTarget();
    (globalThis as unknown as { window: EventTarget }).window = target;
    const controller = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requestSignal = input instanceof Request ? input.signal : init?.signal;
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;

    const changes: Array<{ bookId: string; contactId: string; favorite: boolean }> = [];
    const stop = listenForContactFavoriteChanges((change) => changes.push(change));

    try {
      await saveContactFavorite({ bookId: "book-1", contactId: "contact-1", favorite: true }, controller.signal);
      expect(requestSignal).toBe(controller.signal);
      expect(changes).toEqual([{ bookId: "book-1", contactId: "contact-1", favorite: true }]);
    } finally {
      stop();
    }
  });
});
