import { apiClient } from "@/api/client";
import { readErrorMessage } from "./api";

const FAVORITE_EVENT = "contacts:favorite-changed";

type ContactFavoriteChange = {
  bookId: string;
  contactId: string;
  favorite: boolean;
};

export const contactFavoriteKey = (bookId: string, contactId: string): string => `${bookId}:${contactId}`;

export const saveContactFavorite = async (change: ContactFavoriteChange): Promise<void> => {
  const response = await apiClient.favorites[":bookId"][":contactId"].$put({
    param: { bookId: change.bookId, contactId: change.contactId },
    json: { favorite: change.favorite },
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, "Could not update favorite"));
  window.dispatchEvent(new CustomEvent<ContactFavoriteChange>(FAVORITE_EVENT, { detail: change }));
};

export const listenForContactFavoriteChanges = (listener: (change: ContactFavoriteChange) => void): (() => void) => {
  const handler = (event: Event) => listener((event as CustomEvent<ContactFavoriteChange>).detail);
  window.addEventListener(FAVORITE_EVENT, handler);
  return () => window.removeEventListener(FAVORITE_EVENT, handler);
};
