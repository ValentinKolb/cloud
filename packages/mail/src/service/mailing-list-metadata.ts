import type { MailSubscriptionSummary } from "../contracts";
import type { MessageProtocolFacts } from "./message-protocol";

export const normalizeListId = (value: string): { key: string; name: string; address: string } | null => {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) return null;
  const bracketed = /^(.*?)\s*<([^<>]+)>\s*$/u.exec(normalized);
  const originalAddress = (bracketed?.[2] ?? normalized).trim();
  const address = originalAddress.toLowerCase();
  if (!address || address.length > 4096) return null;
  const rawName = bracketed?.[1]?.trim().replace(/^"|"$/gu, "") ?? "";
  return {
    key: address,
    name: rawName || originalAddress,
    address,
  };
};

export const allowedExternalHref = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (!["https:", "mailto:"].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const firstAllowedHref = (values: readonly string[]): string | null => {
  for (const value of values) {
    const href = allowedExternalHref(value);
    if (href) return href;
  }
  return null;
};

export const oneClickEnabled = (value: string | null): boolean =>
  value?.split(",").some((part) => part.trim().toLowerCase() === "list-unsubscribe=one-click") ?? false;

export const subscriptionLink = (
  unsubscribe: readonly string[],
  unsubscribePost: string | null,
): MailSubscriptionSummary["unsubscribe"] => {
  const links = unsubscribe.map(allowedExternalHref).filter((value): value is string => value !== null);
  if (oneClickEnabled(unsubscribePost)) {
    const oneClick = links.find((href) => new URL(href).protocol === "https:");
    if (oneClick) return { kind: "one_click", href: oneClick };
  }
  const web = links.find((href) => new URL(href).protocol === "https:");
  if (web) return { kind: "web", href: web };
  const email = links.find((href) => new URL(href).protocol === "mailto:");
  return email ? { kind: "email", href: email } : null;
};

export const mailingListMetadata = (
  facts: MessageProtocolFacts,
): {
  listKey: string;
  name: string;
  address: string;
  unsubscribe: MailSubscriptionSummary["unsubscribe"];
  postHref: string | null;
  helpHref: string | null;
  archiveHref: string | null;
} | null => {
  const listId = facts.list.id ? normalizeListId(facts.list.id) : null;
  if (!listId) return null;
  return {
    listKey: listId.key,
    name: listId.name,
    address: listId.address,
    unsubscribe: subscriptionLink(facts.list.unsubscribe, facts.list.unsubscribePost),
    postHref: firstAllowedHref(facts.list.post),
    helpHref: firstAllowedHref(facts.list.help),
    archiveHref: firstAllowedHref(facts.list.archive),
  };
};
