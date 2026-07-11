const URL_BASE = "http://assistant.local";

const relativeHref = (url: URL): string => `${url.pathname}${url.search}${url.hash}`;

export const assistantConversationHref = (currentHref: string, conversationId: string | null): string => {
  const url = new URL(currentHref, URL_BASE);
  if (conversationId) url.searchParams.set("conversation", conversationId);
  else url.searchParams.delete("conversation");
  return relativeHref(url);
};

export const assistantConversationIdFromHref = (href: string): string | null => new URL(href, URL_BASE).searchParams.get("conversation");
