import type { AppSearchInput, AppSearchResult } from "@valentinkolb/cloud/contracts";
import { type MailRequestContext, mailboxes, search } from "./service";

const runSearch = async (input: AppSearchInput): Promise<AppSearchResult[]> => {
  const user = input.ctx.get("user");
  if (!user?.roles.includes("user") || !input.query.trim()) return [];
  const context: MailRequestContext = {
    actor: { kind: "user", user },
    accessSubject: { type: "user", userId: user.id },
  };
  const mailboxResult = await mailboxes.listMailboxes(context, 20);
  if (!mailboxResult.ok) return [];
  const pages: Array<{
    mailbox: (typeof mailboxResult.data)[number];
    page: Awaited<ReturnType<typeof search.searchMessages>>;
  }> = [];
  for (let offset = 0; offset < mailboxResult.data.length; offset += 4) {
    pages.push(
      ...(await Promise.all(
        mailboxResult.data.slice(offset, offset + 4).map(async (mailbox) => ({
          mailbox,
          page: await search.searchMessages({
            context,
            mailboxId: mailbox.id,
            request: {
              expression: { field: "any", query: input.query, match: "words" },
              sort: "relevance",
              limit: Math.min(input.limit, 10),
            },
          }),
        })),
      )),
    );
  }
  return pages
    .flatMap(({ mailbox, page }) => (page.ok ? page.data.items.map((message, mailboxRank) => ({ mailbox, message, mailboxRank })) : []))
    .sort((left, right) => left.mailboxRank - right.mailboxRank || right.message.internalDate.localeCompare(left.message.internalDate))
    .slice(0, input.limit)
    .map(({ mailbox, message }) => ({
      id: `mail:${message.id}`,
      title: message.subject || "(no subject)",
      href: message.conversationId
        ? `/app/mail/${mailbox.id}?conversation=${message.conversationId}`
        : `/app/mail/${mailbox.id}?message=${message.id}`,
      preview: message.snippet ?? message.from.map((address) => address.name || address.address).join(", "),
      icon: "ti ti-mail",
      priority: 8 as const,
      metadata: [
        { label: "Mailbox", value: mailbox.name },
        { label: "Date", value: message.internalDate },
      ],
    }));
};

export const mailCapabilities = {
  search: {
    tags: ["mail", "email", "message"],
    help: "Search messages in mailboxes you can currently read.",
    tagHelp: [
      { tag: "mail", help: "Search mail messages." },
      { tag: "email", help: "Search mail messages (alias of #mail)." },
      { tag: "message", help: "Search mail messages (alias of #mail)." },
    ],
    run: runSearch,
  },
} as const;
