export const buildContactsSearchHref = (href: string, search: string): string => {
  const url = new URL(href, "http://contacts.local");
  const query = search.trim();
  if (query) url.searchParams.set("search", query);
  else url.searchParams.delete("search");
  url.searchParams.delete("page");
  url.searchParams.delete("contact");
  url.searchParams.delete("contactBook");
  return `${url.pathname}${url.search}`;
};

export const contactsResultSignature = (href: string): string => {
  const url = new URL(href, "http://contacts.local");
  return [
    url.pathname,
    url.searchParams.get("search") ?? "",
    url.searchParams.get("tag_id") ?? "",
    url.searchParams.get("page") ?? "1",
  ].join("\u0000");
};

export const buildContactsPaginationBaseHref = (href: string): string => {
  const url = new URL(href, "http://contacts.local");
  url.searchParams.delete("page");
  url.searchParams.delete("contact");
  url.searchParams.delete("contactBook");
  const query = url.searchParams.toString();
  return `${url.pathname}?${query ? `${query}&` : ""}page=`;
};

export const buildContactDetailHref = (href: string, contactId: string, bookId: string): string => {
  const url = new URL(href, "http://contacts.local");
  url.searchParams.set("contact", contactId);
  url.searchParams.set("contactBook", bookId);
  return `${url.pathname}${url.search}`;
};
