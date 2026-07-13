const URL_BASE = "http://assistant.local";

const relativeHref = (url: URL): string => `${url.pathname}${url.search}${url.hash}`;

export const assistantConversationHref = (currentHref: string, conversationId: string | null): string => {
  const url = new URL(currentHref, URL_BASE);
  const previousConversationId = url.searchParams.get("conversation");
  if (conversationId) url.searchParams.set("conversation", conversationId);
  else url.searchParams.delete("conversation");
  if (previousConversationId !== conversationId) url.searchParams.delete("artifact");
  return relativeHref(url);
};

export const assistantConversationIdFromHref = (href: string): string | null => new URL(href, URL_BASE).searchParams.get("conversation");

export const assistantArtifactHref = (currentHref: string, path: string | null): string => {
  const url = new URL(currentHref, URL_BASE);
  if (path) url.searchParams.set("artifact", path);
  else url.searchParams.delete("artifact");
  return relativeHref(url);
};

export const assistantArtifactPathFromHref = (href: string): string | null => new URL(href, URL_BASE).searchParams.get("artifact");
