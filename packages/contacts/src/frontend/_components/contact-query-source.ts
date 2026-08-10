export type ContactQueryIdentity = {
  bookId: string;
  contactId: string;
  revision?: number;
};

export const createContactQuerySource = (identity: ContactQueryIdentity): string =>
  JSON.stringify(
    identity.revision === undefined ? [identity.bookId, identity.contactId] : [identity.bookId, identity.contactId, identity.revision],
  );

export const parseContactQuerySource = (source: string): ContactQueryIdentity => {
  const [bookId, contactId, revision] = JSON.parse(source) as [string, string, number?];
  return revision === undefined ? { bookId, contactId } : { bookId, contactId, revision };
};

export const isCurrentQuerySnapshot = <T extends { source: string }>(
  snapshot: T | null | undefined,
  source: string | null,
): snapshot is T => source !== null && snapshot?.source === source;
