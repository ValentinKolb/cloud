import { describe, expect, test } from "bun:test";
import { query } from "@k2b/stdlib/solid";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { isServer, render } from "solid-js/web";
import { createDomTestHarness } from "../../ui/test/dom";
import {
  createContactFavoriteProjection,
  listenForContactFavoriteChanges,
  saveContactFavorite,
} from "../src/frontend/_components/contacts-favorites";
import { createContactsResultsNavigation, selectContactsResultsSnapshot } from "../src/frontend/_components/contacts-results-navigation";
import { buildContactsPageHref } from "../src/frontend/_components/contacts-search";
import { CONTACT_DETAIL_EVENT, type ContactDetailPayload, setSelectedContactInUrl } from "../src/frontend/_components/context";
import type { Contact } from "../src/service";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("Contacts results query navigation", () => {
  if (isServer) {
    test.skip("runs in the dedicated browser-conditions test process", () => {});
    return;
  }

  test("rebases a clamped source before later invalidation", async () => {
    const dom = createDomTestHarness();
    const initialHref = "/app/contacts?page=1";
    const requestedHref = "/app/contacts?page=9";
    const canonicalHref = "/app/contacts?page=3";
    const requests: string[] = [];
    let totalPages = 3;
    let navigateTo!: (href: string) => Promise<unknown>;
    let invalidate!: () => Promise<void>;
    let sourceValue = initialHref;

    const dispose = render(() => {
      const [source, setSource] = createSignal(initialHref);
      const navigation = createContactsResultsNavigation({
        initialSource: initialHref,
        initialHref,
        setSource: (next) => {
          sourceValue = next;
          setSource(next);
        },
      });
      const results = query.create<string, { source: string; href: string }>({
        source,
        initial: { source: initialHref, data: { source: initialHref, href: initialHref } },
        load: async (requestedSource) => {
          requests.push(requestedSource);
          const requestedPage = Number(new URL(requestedSource, "http://contacts.local").searchParams.get("page") ?? "1");
          return {
            source: requestedSource,
            href: requestedPage > totalPages ? buildContactsPageHref(requestedSource, totalPages) : requestedSource,
          };
        },
      });
      createEffect(() => {
        const snapshot = results.data();
        if (snapshot?.source === source() && !results.stale()) navigation.apply(snapshot.source, snapshot.href, () => {});
      });
      navigateTo = navigation.navigate;
      invalidate = results.invalidate;
      return dom.document.createTextNode("");
    }, dom.root);

    await navigateTo(requestedHref);
    await flush();
    expect(sourceValue).toBe(canonicalHref);
    expect(requests).toEqual([requestedHref, canonicalHref]);

    totalPages = 9;
    await invalidate();
    expect(requests.at(-1)).toBe(canonicalHref);
    expect(requests.slice(1)).not.toContain(requestedHref);

    dispose();
    dom.cleanup();
  });

  test("does not render committed A below popstate URL B while B is pending", async () => {
    const dom = createDomTestHarness();
    const sourceA = "/app/contacts?search=A";
    const sourceB = "/app/contacts?search=B";
    const next = deferred<{ source: string; href: string; label: string }>();
    let popstateToB!: Promise<unknown>;

    const dispose = render(() => {
      const [source, setSource] = createSignal(sourceA);
      const navigation = createContactsResultsNavigation({ initialSource: sourceA, initialHref: sourceA, setSource });
      const results = query.create<string, { source: string; href: string; label: string }>({
        source,
        initial: { source: sourceA, data: { source: sourceA, href: sourceA, label: "A" } },
        load: () => next.promise,
      });
      const output = dom.document.createElement("output");
      createEffect(() => {
        const snapshot = selectContactsResultsSnapshot({
          loaded: results.data(),
          source: source(),
          committedSource: navigation.committedSource(),
          canRenderCommitted: navigation.canRenderCommitted(),
        });
        output.textContent = snapshot?.label ?? "loading";
        if (snapshot?.source === source() && !results.stale()) navigation.apply(snapshot.source, snapshot.href, () => {});
      });
      popstateToB = navigation.navigate(sourceB, { retainCommitted: false });
      return output;
    }, dom.root);

    await flush();
    expect(dom.root.textContent).toBe("loading");

    next.resolve({ source: sourceB, href: sourceB, label: "B" });
    await popstateToB;
    await flush();
    expect(dom.root.textContent).toBe("B");

    dispose();
    dom.cleanup();
  });

  test("seeds a later detail selection from a favorite toggled before the detail listener mounts", async () => {
    const dom = createDomTestHarness();
    const originalFetch = globalThis.fetch;
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
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      emails: [],
      phones: [],
      websites: [],
      addresses: [],
      bankAccounts: [],
      parentContactId: null,
      parent: null,
      members: [],
      tags: [],
    };
    globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 204 }))) as typeof fetch;

    const dispose = render(() => {
      const projection = createContactFavoriteProjection(() => []);
      const stopFavoriteChanges = listenForContactFavoriteChanges(projection.apply);
      onCleanup(stopFavoriteChanges);

      const owner = dom.document.createElement("div");
      const favoriteButton = dom.document.createElement("button");
      favoriteButton.type = "button";
      favoriteButton.textContent = "Favorite";
      favoriteButton.addEventListener("click", () => {
        void saveContactFavorite({ bookId: contact.bookId, contactId: contact.id, favorite: true }, new AbortController().signal);
      });
      const selectButton = dom.document.createElement("button");
      selectButton.type = "button";
      selectButton.textContent = "Select";
      selectButton.addEventListener("click", () => {
        setSelectedContactInUrl({
          contactId: contact.id,
          bookId: contact.bookId,
          contact,
          favorite: projection.favoriteFor(contact),
        });
      });
      owner.append(favoriteButton, selectButton);
      return owner;
    }, dom.root);

    try {
      await flush();
      const favoriteChanged = new Promise<void>((resolve) => {
        window.addEventListener("contacts:favorite-changed", () => resolve(), { once: true });
      });
      const [favoriteButton, selectButton] = dom.root.querySelectorAll<HTMLButtonElement>("button");
      favoriteButton!.click();
      await favoriteChanged;
      await flush();

      let selection: ContactDetailPayload | undefined;
      window.addEventListener(
        CONTACT_DETAIL_EVENT,
        (event) => {
          selection = (event as CustomEvent<ContactDetailPayload>).detail;
        },
        { once: true },
      );
      selectButton!.click();

      expect(selection?.favorite).toBe(true);
      expect(selection?.item).toBe(contact);
    } finally {
      dispose();
      globalThis.fetch = originalFetch;
      dom.cleanup();
    }
  });
});
