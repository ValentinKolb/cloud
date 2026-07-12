import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { AppWorkspace, Placeholder } from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";
import { type MailRequestContext, mailboxAccess, mailboxes, messages, search, senderIdentities } from "../../service";
import type { ConversationSummary, MessageDetail } from "../../service/messages";
import ComposeMail from "../_components/ComposeMail.island";
import MailSidebar from "../_components/MailSidebar";

const rank = (permission: string): number => (permission === "admin" ? 3 : permission === "write" ? 2 : permission === "read" ? 1 : 0);

const messageAddresses = (message: MessageDetail): string =>
  message.from.map((address) => (address.name ? `${address.name} <${address.address}>` : address.address)).join(", ");

const MessageCard = (props: { mailboxId: string; message: MessageDetail }) => (
  <article class="paper overflow-hidden">
    <header class="flex flex-wrap items-start justify-between gap-2 border-b border-subtle p-3">
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold text-primary">{messageAddresses(props.message) || "Unknown sender"}</p>
        <p class="truncate text-xs text-dimmed">
          To {props.message.to.map((address) => address.address).join(", ") || "undisclosed recipients"}
        </p>
      </div>
      <time class="text-xs text-dimmed" dateTime={props.message.internalDate}>
        {new Date(props.message.internalDate).toLocaleString()}
      </time>
    </header>
    <div class="p-4">
      {props.message.sanitizedHtml ? (
        <div class="markdown max-w-none text-sm" innerHTML={props.message.sanitizedHtml} />
      ) : props.message.plainText ? (
        <pre class="whitespace-pre-wrap break-words font-sans text-sm text-primary">{props.message.plainText}</pre>
      ) : (
        <Placeholder icon="ti ti-loader" title="Body is still synchronizing" />
      )}
      {props.message.attachments.length > 0 && (
        <div class="mt-4 flex flex-wrap gap-2 border-t border-subtle pt-3">
          {props.message.attachments.map((attachment) => (
            <a
              href={`/api/mail/mailboxes/${props.mailboxId}/messages/${props.message.id}/attachments/${attachment.id}`}
              class="btn-secondary btn-sm"
              download={attachment.filename ?? "attachment"}
            >
              <i class="ti ti-paperclip" />
              <span class="max-w-48 truncate">{attachment.filename ?? attachment.contentType}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  </article>
);

export default ssr<AuthContext>(async (c) => {
  const mailboxId = c.req.param("mailboxId") ?? "";
  if (!mailboxId) return c.redirect("/app/mail");
  const context: MailRequestContext = {
    actor: c.get("actor"),
    accessSubject: c.get("accessSubject"),
    requestId: c.req.header("x-request-id") ?? null,
  };
  const [mailboxResult, folderResult, identityResult, permission] = await Promise.all([
    mailboxes.getMailbox(context, mailboxId),
    messages.listFolders(context, mailboxId),
    senderIdentities.listSenderIdentities(context, mailboxId),
    mailboxAccess.getMailboxPermission(context, mailboxId),
  ]);
  if (!mailboxResult.ok) return c.redirect("/app/mail");
  const mailbox = mailboxResult.data;
  const folders = folderResult.ok ? folderResult.data : [];
  const identities = identityResult.ok ? identityResult.data : [];
  const folderId = c.req.query("folder") ?? null;
  const query = c.req.query("q")?.trim() ?? "";
  const selectedConversationId = c.req.query("conversation") ?? null;
  const selectedMessageId = c.req.query("message") ?? null;

  let conversationItems: ConversationSummary[] = [];
  let searchItems: Array<{
    id: string;
    conversationId: string | null;
    subject: string;
    participantSummary: string;
    latestMessageAt: string;
    preview: string | null;
    unread: boolean;
  }> = [];
  if (query) {
    const result = await search.searchMessages({
      context,
      mailboxId,
      request: { expression: { field: "any", query, match: "words" }, sort: "relevance", limit: 100 },
    });
    if (result.ok) {
      searchItems = result.data.items.map((item) => ({
        id: item.id,
        conversationId: item.conversationId,
        subject: item.subject,
        participantSummary: item.from.map((address) => address.name || address.address).join(", "),
        latestMessageAt: item.internalDate,
        preview: item.snippet,
        unread: !item.flags.includes("\\Seen"),
      }));
    }
  } else {
    const result = await messages.listConversations({ context, mailboxId, folderId, limit: 100 });
    if (result.ok) conversationItems = result.data.items;
  }

  const listItems = query
    ? searchItems
    : conversationItems.map((item) => ({
        id: item.id,
        conversationId: item.id,
        subject: item.subject,
        participantSummary: item.participantSummary,
        latestMessageAt: item.latestMessageAt,
        preview: item.preview,
        unread: item.unread,
      }));

  let detailMessages: MessageDetail[] = [];
  if (selectedConversationId) {
    const page = await messages.listConversationMessages({ context, mailboxId, conversationId: selectedConversationId, limit: 50 });
    if (page.ok) {
      const details = await Promise.all(
        page.data.items.map((message) => messages.getMessage({ context, mailboxId, messageId: message.id })),
      );
      detailMessages = details.filter((result): result is Extract<typeof result, { ok: true }> => result.ok).map((result) => result.data);
    }
  } else if (selectedMessageId) {
    const detail = await messages.getMessage({ context, mailboxId, messageId: selectedMessageId });
    if (detail.ok) detailMessages = [detail.data];
  }
  const selectedSubject =
    detailMessages.at(-1)?.subject || listItems.find((item) => item.conversationId === selectedConversationId)?.subject || "Message";
  const activeFolder = folders.find((folder) => folder.id === folderId);

  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Mail", href: "/app/mail" }, { title: mailbox.name }]}>
      <AppWorkspace>
        <MailSidebar
          mailboxId={mailboxId}
          mailboxName={mailbox.name}
          folders={folders}
          activeFolderId={folderId}
          identities={identities}
          canWrite={rank(permission) >= 2}
          canAdmin={rank(permission) >= 3}
        />
        <AppWorkspace.Main>
          <div class="flex flex-col gap-2 border-b border-subtle p-2">
            <SearchBar value={query} param="q" placeholder={`Search ${mailbox.name}...`} ariaLabel={`Search ${mailbox.name}`} />
            {mailbox.health !== "active" && (
              <div class="info-block-warning flex items-center gap-2 text-xs">
                <i class="ti ti-alert-triangle" />
                <span>{mailbox.healthReason || `Mailbox is ${mailbox.health.replaceAll("_", " ")}.`}</span>
              </div>
            )}
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto" data-scroll-preserve={`mail-list-${mailboxId}`}>
            <div class="flex items-center justify-between gap-2 px-3 py-2 text-xs text-dimmed">
              <span>{query ? `Results for “${query}”` : (activeFolder?.name ?? "All mail")}</span>
              <span>{listItems.length}</span>
            </div>
            {listItems.length === 0 ? (
              <Placeholder icon="ti ti-mail-off" title={query ? "No matching messages" : "No synchronized messages"} />
            ) : (
              <div class="divide-y divide-subtle border-y border-subtle">
                {listItems.map((item) => {
                  const href = new URL(`/app/mail/${mailboxId}`, "http://mail.local");
                  if (folderId) href.searchParams.set("folder", folderId);
                  if (query) href.searchParams.set("q", query);
                  if (item.conversationId) href.searchParams.set("conversation", item.conversationId);
                  else href.searchParams.set("message", item.id);
                  const selected = item.conversationId ? item.conversationId === selectedConversationId : item.id === selectedMessageId;
                  return (
                    <a
                      href={`${href.pathname}${href.search}`}
                      class={`flex min-w-0 gap-3 px-3 py-3 no-underline hover:bg-subtle ${selected ? "bg-subtle" : ""}`}
                    >
                      <span class={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.unread ? "bg-blue-500" : "bg-transparent"}`} />
                      <span class="min-w-0 flex-1">
                        <span class="flex items-baseline justify-between gap-3">
                          <span class={`truncate text-sm ${item.unread ? "font-semibold text-primary" : "text-primary"}`}>
                            {item.participantSummary || "Unknown sender"}
                          </span>
                          <time class="shrink-0 text-2xs text-dimmed">{new Date(item.latestMessageAt).toLocaleDateString()}</time>
                        </span>
                        <span class="block truncate text-xs font-medium text-primary">{item.subject || "(no subject)"}</span>
                        <span class="block truncate text-xs text-dimmed">{item.preview || "Body is still synchronizing"}</span>
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </AppWorkspace.Main>
        <AppWorkspace.Detail open={detailMessages.length > 0} width="xl" id="mail-thread-detail" viewTransitionName="mail-thread-detail">
          {detailMessages.length > 0 && (
            <div class="flex h-full min-h-0 flex-col">
              <header class="flex items-start justify-between gap-3 border-b border-subtle p-3">
                <div class="min-w-0">
                  <h1 class="truncate text-base font-semibold text-primary">{selectedSubject || "(no subject)"}</h1>
                  <p class="text-xs text-dimmed">
                    {detailMessages.length} message{detailMessages.length === 1 ? "" : "s"}
                  </p>
                </div>
                {rank(permission) >= 2 && selectedConversationId && (
                  <ComposeMail
                    mailboxId={mailboxId}
                    identities={identities}
                    conversationId={selectedConversationId}
                    initialSubject={selectedSubject.toLowerCase().startsWith("re:") ? selectedSubject : `Re: ${selectedSubject}`}
                    label="Reply"
                    class="btn-primary btn-sm"
                  />
                )}
              </header>
              <div class="min-h-0 flex-1 overflow-y-auto bg-page p-2">
                <div class="flex flex-col gap-2">
                  {detailMessages.map((message) => (
                    <MessageCard mailboxId={mailboxId} message={message} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </AppWorkspace.Detail>
      </AppWorkspace>
    </Layout>
  );
});
