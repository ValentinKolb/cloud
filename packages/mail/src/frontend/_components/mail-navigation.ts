import { serializeMailSearchState } from "../../search-state";
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

export const senderDomainFromAddress = (address: string): string | null => {
  const separator = address.lastIndexOf("@");
  const domain =
    separator >= 0
      ? address
          .slice(separator + 1)
          .trim()
          .toLowerCase()
      : "";
  return domain.includes(".") ? domain : null;
};

export const buildExactSenderSearchHref = (requestUrl: URL, address: string): string | null => {
  const serialized = serializeMailSearchState({
    expression: { type: "text", field: "from", query: address, match: "exact" },
    sort: "newest",
  });
  if (!serialized.ok) return null;
  const next = new URL(buildMailListHref(requestUrl, true), requestUrl.origin);
  next.searchParams.set("search", serialized.value);
  return `${next.pathname}${next.search}`;
};

export const isMailListItemActive = (
  item: Pick<MailListItem, "id" | "conversationId">,
  selectedConversationId: string | null,
  selectedMessageId: string | null,
): boolean => (item.conversationId ? item.conversationId === selectedConversationId : item.id === selectedMessageId);
