import type { ContactServiceEvent } from "../../live-events";

export const CONTACTS_LIVE_INVALIDATION_EVENT = "contacts:live-invalidation";

export type ContactsLiveInvalidation = ContactServiceEvent | { type: "scope.changed" };

type ContactsLiveInvalidationDispatch = {
  invalidation: ContactsLiveInvalidation;
  waitUntil: (work: Promise<void>) => void;
};

export const dispatchContactsLiveInvalidation = async (invalidation: ContactsLiveInvalidation): Promise<void> => {
  const pending: Promise<void>[] = [];
  window.dispatchEvent(
    new CustomEvent<ContactsLiveInvalidationDispatch>(CONTACTS_LIVE_INVALIDATION_EVENT, {
      detail: {
        invalidation,
        waitUntil: (work) => pending.push(work),
      },
    }),
  );
  const results = await Promise.allSettled(pending);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
};

export const listenForContactsLiveInvalidation = (listener: (event: ContactsLiveInvalidation) => void | Promise<void>): (() => void) => {
  const handler = (event: Event) => {
    const dispatch = (event as CustomEvent<ContactsLiveInvalidationDispatch>).detail;
    try {
      const work = listener(dispatch.invalidation);
      if (work) dispatch.waitUntil(work);
    } catch (error) {
      dispatch.waitUntil(Promise.reject(error));
    }
  };
  window.addEventListener(CONTACTS_LIVE_INVALIDATION_EVENT, handler);
  return () => window.removeEventListener(CONTACTS_LIVE_INVALIDATION_EVENT, handler);
};

export const requiresContactsShellRefresh = (event: ContactsLiveInvalidation): boolean =>
  event.type === "scope.changed" || event.type.startsWith("book.") || event.type === "access.changed" || event.type === "tags.changed";

export const requiresContactsResultsRefresh = (event: ContactsLiveInvalidation): boolean =>
  event.type.startsWith("contact.") || event.type === "contacts.imported";
