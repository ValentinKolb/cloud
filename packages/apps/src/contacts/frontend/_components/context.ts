import { detailPanel, type DetailSelectPayload } from "@valentinkolb/cloud/lib/browser";
import type { Contact } from "../../service";

export const CONTACT_DETAIL_EVENT = "contacts-detail-select";

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
export const dispatchContactDetailSelect = (contact: Contact | null, contactId: string | null, bookId: string | null) => {
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

/** Updates detail params without navigation and notifies detail/list islands. */
export const setSelectedContactInUrl = (config: { contactId: string | null; bookId: string | null; contact?: Contact | null }) => {
  withViewTransition(() => {
    detailPanel.setUrlParam("contact", config.contactId);
    detailPanel.setUrlParam("contactBook", config.bookId);
    dispatchContactDetailSelect(config.contact ?? null, config.contactId, config.bookId);
  });
};

/** Clears selected contact params from URL and closes the detail panel. */
export const clearSelectedContactInUrl = () => {
  setSelectedContactInUrl({ contactId: null, bookId: null, contact: null });
};

export const buildContactEditUrl = (bookId: string, contactId: string) => `/app/contacts/${bookId}/e/${contactId}`;
