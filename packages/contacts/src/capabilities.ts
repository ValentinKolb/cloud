import type { AppSearchInput, AppSearchResult } from "@valentinkolb/cloud/contracts";
import { resolveContactName } from "./shared";
import { contactsService } from "./service";

const SEARCH_TAGS = ["contact", "addressbook", "phone", "email"] as const;
const SEARCH_HELP = "Find people and contact data from your address books.";
const SEARCH_TAG_HELP = [
  { tag: "contact", help: "Show contact cards." },
  { tag: "addressbook", help: "Focus on address-book entries." },
  { tag: "phone", help: "Search by telephone data." },
  { tag: "email", help: "Search by email addresses." },
] as const;
const supportsContactsApp = (roles: string[]) => roles.includes("user");
const hasAllTags = (requested: string[]) => requested.every((tag) => SEARCH_TAGS.includes(tag as (typeof SEARCH_TAGS)[number]));

const contactPreview = (emails: { email: string }[], phones: { phone: string }[]) => {
  const firstEmail = emails[0]?.email;
  if (firstEmail) return firstEmail;
  const firstPhone = phones[0]?.phone;
  if (firstPhone) return firstPhone;
  return undefined;
};

export const search = async (input: AppSearchInput): Promise<AppSearchResult[]> => {
  const user = input.ctx.get("user");
  if (!supportsContactsApp(user.roles)) return [];
  if (input.tags.length > 0 && !hasAllTags(input.tags)) return [];

  const page = await contactsService.contact.search({
    userId: user.id,
    groups: user.memberofGroupIds,
    pagination: { page: 1, perPage: input.limit },
    filter: { query: input.query, includeSystem: true },
  });

  return page.items.slice(0, input.limit).map((entry) => {
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
