import { type DetailSelectPayload, detailPanel } from "@valentinkolb/stdlib/solid";
import type { Contact } from "../../service";

export const CONTACT_DETAIL_EVENT = "contacts-detail-select";
export const CONTACT_NOTE_COMPOSE_EVENT = "contacts:note-compose";
export const shouldHandleContactDetailClick = detailPanel.shouldHandleClick;

export type ContactDetailPayload = DetailSelectPayload<Contact> & {
  bookId: string | null;
};

type TransitionDoc = Document & {
  startViewTransition?: (callback: () => void) => void;
};

const withViewTransition = (callback: () => void) => {
  const doc = document as TransitionDoc;
  if (doc.startViewTransition) {
    doc.startViewTransition(callback);
    return;
  }
  callback();
};

/** Reads selected contact identifiers from URL query params. */
export const getSelectedContactFromUrl = () => ({
  contactId: detailPanel.getUrlParam("contact"),
  bookId: detailPanel.getUrlParam("contactBook"),
});

/** Dispatches detail selection updates to all listening contacts islands. */
const dispatchContactDetailSelect = (contact: Contact | null, contactId: string | null, bookId: string | null) => {
  window.dispatchEvent(
    new CustomEvent(CONTACT_DETAIL_EVENT, {
      detail: {
        item: contact,
        itemKey: contactId,
        bookId,
      } as ContactDetailPayload,
    }),
  );
};

/** Reconciles mounted list/detail islands after another owner commits the URL. */
export const syncContactDetailFromUrl = () => {
  const selected = getSelectedContactFromUrl();
  dispatchContactDetailSelect(null, selected.contactId, selected.bookId);
};

const pushSelectedContactUrl = (contactId: string | null, bookId: string | null) => {
  const url = new URL(window.location.href);
  if (contactId) {
    url.searchParams.set("contact", contactId);
  } else {
    url.searchParams.delete("contact");
  }
  if (bookId) {
    url.searchParams.set("contactBook", bookId);
  } else {
    url.searchParams.delete("contactBook");
  }
  if (url.toString() !== window.location.href) history.pushState({}, "", url.toString());
};

/** Updates detail params without navigation and notifies detail/list islands. */
export const setSelectedContactInUrl = (config: { contactId: string | null; bookId: string | null; contact?: Contact | null }) => {
  withViewTransition(() => {
    pushSelectedContactUrl(config.contactId, config.bookId);
    dispatchContactDetailSelect(config.contact ?? null, config.contactId, config.bookId);
  });
};

/** Clears selected contact params from URL and closes the detail panel. */
export const clearSelectedContactInUrl = () => {
  setSelectedContactInUrl({ contactId: null, bookId: null, contact: null });
};

/** Opens the notes composer in the currently mounted detail panel. */
export const requestContactNoteComposer = (contactId: string) => {
  window.dispatchEvent(new CustomEvent(CONTACT_NOTE_COMPOSE_EVENT, { detail: { contactId } }));
};
