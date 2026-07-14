import type { AppSearchInput, AppSearchResult } from "@valentinkolb/cloud/contracts";
import { getSearchUser } from "@/actor";
import { contactsService } from "./service";
import { resolveContactName } from "./shared";

const SEARCH_TAGS = ["contact", "addressbook", "phone", "email"] as const;
const SEARCH_HELP = "Find people and contact data from your address books.";
const SEARCH_TAG_HELP = [
  { tag: "contact", help: "Show contact cards." },
  { tag: "addressbook", help: "Show contact cards (alias of #contact)." },
  { tag: "phone", help: "Show contacts that have a phone number." },
  { tag: "email", help: "Show contacts that have an email address." },
] as const;
const supportsContactsApp = (roles: string[]) => roles.includes("user");

const contactPreview = (emails: { email: string }[], phones: { phone: string }[]) => {
  const firstEmail = emails[0]?.email;
  if (firstEmail) return firstEmail;
  const firstPhone = phones[0]?.phone;
  if (firstPhone) return firstPhone;
  return undefined;
};

// Over-fetch multiplier when post-filtering by tag facets (#phone / #email).
// The service ranks/limits BEFORE we apply these facets, so without headroom
// we'd silently drop matches that fell outside the first `limit` rows. 5×
// (capped at 200) is enough for realistic address books and avoids changing
// the contact.search contract just for the global search dialog.
const FACET_OVERFETCH_MULTIPLIER = 5;
const FACET_OVERFETCH_CAP = 200;

const search = async (input: AppSearchInput): Promise<AppSearchResult[]> => {
  const user = getSearchUser(input.ctx);
  if (!supportsContactsApp(user.roles)) return [];

  const tags = new Set(input.tags);
  const requirePhone = tags.has("phone");
  const requireEmail = tags.has("email");
  const facetFilterActive = requirePhone || requireEmail;

  const fetchLimit = facetFilterActive ? Math.min(FACET_OVERFETCH_CAP, input.limit * FACET_OVERFETCH_MULTIPLIER) : input.limit;

  const page = await contactsService.contact.search({
    subject: { type: "user", userId: user.id },
    pagination: { page: 1, perPage: fetchLimit },
    filter: { query: input.query, includeSystem: true },
  });

  return page.items
    .filter((entry) => {
      if (requirePhone && entry.phones.length === 0) return false;
      if (requireEmail && entry.emails.length === 0) return false;
      return true;
    })
    .slice(0, input.limit)
    .map((entry) => {
      const primary = contactPreview(entry.emails, entry.phones);
      return {
        id: entry.id,
        title: resolveContactName(entry),
        href: `/app/contacts/${entry.bookId}?contact=${entry.id}&contactBook=${entry.bookId}`,
        preview: primary,
        icon: "ti ti-address-book",
        priority: 7 as const,
        metadata: [
          { label: "Type", value: "Contact" },
          { label: "Book", value: entry.bookId },
          ...(primary ? [{ label: "Primary", value: primary }] : []),
        ],
      };
    });
};

export const contactsCapabilities = {
  search: {
    tags: [...SEARCH_TAGS],
    help: SEARCH_HELP,
    tagHelp: [...SEARCH_TAG_HELP],
    run: search,
  },
} as const;
