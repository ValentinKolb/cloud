import type { MailListItem } from "../../service/workspace";

export type { MailListItem } from "../../service/workspace";

export const buildMailListHref = (requestUrl: URL, clearSearch = false): string => {
  const next = new URL(requestUrl);
  next.searchParams.delete("conversation");
  next.searchParams.delete("message");
  if (clearSearch) {
    for (const parameter of [
      "q",
      "qFields",
      "from",
      "to",
      "subject",
      "body",
      "attachment",
      "comment",
      "reference",
      "folderName",
      "tag",
      "keyword",
      "combine",
      "search",
      "cursor",
      "savedView",
    ]) {
      next.searchParams.delete(parameter);
    }
  }
  return `${next.pathname}${next.search}`;
};

export const buildMailSelectionHref = (requestUrl: URL, item: MailListItem): string => {
  const next = new URL(buildMailListHref(requestUrl), requestUrl.origin);
  if (item.conversationId) next.searchParams.set("conversation", item.conversationId);
  else next.searchParams.set("message", item.id);
  return `${next.pathname}${next.search}`;
};

export const isMailListItemActive = (
  item: Pick<MailListItem, "id" | "conversationId">,
  selectedConversationId: string | null,
  selectedMessageId: string | null,
): boolean => (item.conversationId ? item.conversationId === selectedConversationId : item.id === selectedMessageId);
