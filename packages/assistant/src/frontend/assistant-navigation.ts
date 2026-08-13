const URL_BASE = "http://assistant.local";

const relativeHref = (url: URL): string => `${url.pathname}${url.search}${url.hash}`;
export type ConversationOpenResult = "opened" | "unchanged" | "stale";

export const shouldCommitConversationNavigation = (result: ConversationOpenResult, currentHref: string, targetHref: string): boolean =>
  result === "opened" ||
  (result === "unchanged" && relativeHref(new URL(currentHref, URL_BASE)) !== relativeHref(new URL(targetHref, URL_BASE)));

/** A Project page must reopen its underlying active chat so the visible view can change back to that chat. */
export const shouldOpenProjectConversation = (
  activeProjectId: string | null | undefined,
  activeConversationId: string | null,
  targetConversationId: string,
): boolean => Boolean(activeProjectId) || activeConversationId !== targetConversationId;

export const assistantConversationHref = (currentHref: string, conversationId: string | null): string => {
  const url = new URL(currentHref, URL_BASE);
  const previousConversationId = url.searchParams.get("conversation");
  if (conversationId) url.searchParams.set("conversation", conversationId);
  else url.searchParams.delete("conversation");
  url.searchParams.delete("project");
  url.searchParams.delete("q");
  if (previousConversationId !== conversationId) url.searchParams.delete("artifact");
  return relativeHref(url);
};

export const assistantProjectHref = (currentHref: string, projectId: string, query?: string): string => {
  const url = new URL(currentHref, URL_BASE);
  url.searchParams.delete("conversation");
  url.searchParams.delete("artifact");
  url.searchParams.set("project", projectId);
  if (query?.trim()) url.searchParams.set("q", query.trim());
  else url.searchParams.delete("q");
  return relativeHref(url);
};

export const assistantConversationIdFromHref = (href: string): string | null => new URL(href, URL_BASE).searchParams.get("conversation");

export const assistantProjectIdFromHref = (href: string): string | null => new URL(href, URL_BASE).searchParams.get("project");

export const assistantProjectQueryFromHref = (href: string): string => new URL(href, URL_BASE).searchParams.get("q")?.trim() ?? "";

export const assistantArtifactHref = (currentHref: string, path: string | null): string => {
  const url = new URL(currentHref, URL_BASE);
  if (path) url.searchParams.set("artifact", path);
  else url.searchParams.delete("artifact");
  return relativeHref(url);
};

export const assistantArtifactPathFromHref = (href: string): string | null => new URL(href, URL_BASE).searchParams.get("artifact");
