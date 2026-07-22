type MailCursorItem = { id: string };

type MailCursorPageMerge<T extends MailCursorItem> =
  | { ok: true; items: T[]; nextCursor: string | null }
  | { ok: false; reason: "repeated_page" };

/** Merge one cursor page without duplicating rows or accepting a stuck cursor. */
export const mergeMailCursorPage = <T extends MailCursorItem>(input: {
  currentItems: T[];
  currentNextCursor: string | null;
  pageItems: T[];
  pageNextCursor: string | null;
}): MailCursorPageMerge<T> => {
  const known = new Set(input.currentItems.map((item) => item.id));
  const appended = input.pageItems.filter((item) => !known.has(item.id));
  if (input.pageNextCursor === input.currentNextCursor && appended.length === 0) {
    return { ok: false, reason: "repeated_page" };
  }
  return {
    ok: true,
    items: [...input.currentItems, ...appended],
    nextCursor: input.pageNextCursor,
  };
};
