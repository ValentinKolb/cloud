import type { MailboxPageData } from "../../service/workspace";

/**
 * Merge a fresh first page into the currently loaded cursor window.
 * The server page wins for changed rows; older pages stay mounted so live
 * activity cannot collapse a list that the user has already scrolled through.
 */
export const mergeMailLiveSnapshot = (
  current: MailboxPageData,
  fresh: MailboxPageData,
  preservedItemIds: ReadonlySet<string>,
): MailboxPageData => {
  const freshIds = new Set(fresh.listItems.map((item) => item.id));
  const loadedTail = current.listItems.filter((item) => preservedItemIds.has(item.id) && !freshIds.has(item.id));
  const preservesTail = preservedItemIds.size > 0;

  return {
    ...fresh,
    listItems: [...fresh.listItems, ...loadedTail],
    listCursor: preservesTail ? current.listCursor : fresh.listCursor,
    nextListCursor: preservesTail ? current.nextListCursor : fresh.nextListCursor,
  };
};
