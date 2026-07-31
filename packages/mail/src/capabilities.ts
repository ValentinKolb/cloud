import {
  type CapabilityExecutionContext,
  type CloudResourceView,
  defineCapabilities,
  type UniversalSearchInput,
  UniversalSearchDataSchema,
  UniversalSearchInputSchema,
} from "@valentinkolb/cloud/contracts";
import { ok } from "@k2b/stdlib";
import { type MailRequestContext, mailboxes, search } from "./service";

const runSearch = async (input: UniversalSearchInput, capabilityContext: CapabilityExecutionContext) => {
  const user = capabilityContext.user;
  if (!user?.roles.includes("user") || !input.query.trim()) return ok({ data: [] });

  const context: MailRequestContext = {
    actor: capabilityContext.actor,
    accessSubject: capabilityContext.accessSubject,
  };
  const mailboxResult = await mailboxes.listMailboxes(context, 20);
  if (!mailboxResult.ok) return ok({ data: [] });

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
              expression: { type: "text", field: "any", query: input.query, match: "words" },
              sort: "relevance",
              limit: Math.min(input.limit, 10),
            },
          }),
        })),
      )),
    );
  }

  const data: CloudResourceView[] = pages
    .flatMap(({ mailbox, page }) => (page.ok ? page.data.items.map((message, mailboxRank) => ({ mailbox, message, mailboxRank })) : []))
    .sort((left, right) => left.mailboxRank - right.mailboxRank || right.message.internalDate.localeCompare(left.message.internalDate))
    .slice(0, input.limit)
    .map(({ mailbox, message }) => ({
      ref: { type: "mail.message", id: message.id },
      title: message.subject || "(no subject)",
      preview: message.snippet ?? message.from.map((address) => address.name || address.address).join(", "),
      icon: "ti ti-mail",
      priority: 8,
      metadata: [
        { label: "Mailbox", value: mailbox.name },
        { label: "Date", value: message.internalDate },
      ],
      links: [
        {
          rel: "open",
          href: message.conversationId
            ? `/app/mail/${mailbox.id}?conversation=${message.conversationId}`
            : `/app/mail/${mailbox.id}?message=${message.id}`,
        },
      ],
    }));
  return ok({ data });
};

export const mailCapabilities = defineCapabilities({
  version: 1,
  types: {
    message: { title: "Mail message", description: "One message in an accessible mailbox.", icon: "ti ti-mail" },
  },
  queries: {
    search: {
      title: "Search mail",
      description: "Search messages across mailboxes the current actor can read.",
      input: UniversalSearchInputSchema,
      data: UniversalSearchDataSchema,
      universalSearch: {
        tags: [{ tag: "mail", title: "Mail", description: "Search mail messages.", aliases: ["email", "message"] }],
      },
      run: runSearch,
    },
  },
});
