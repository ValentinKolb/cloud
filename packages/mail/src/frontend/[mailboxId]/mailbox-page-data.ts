import { type ConversationView, conversationViewSchema, type Mailbox, type SenderIdentity } from "../../contracts";
import { collaboration, type MailRequestContext, mailboxAccess, mailboxes, messages, search, senderIdentities } from "../../service";
import type { ConversationCollaboration, ConversationComment, MailAssignableUser } from "../../service/collaboration";
import type { ConversationViewCounts, MailFolderView, MessageDetail } from "../../service/messages";

const EMPTY_VIEW_COUNTS: ConversationViewCounts = {
  inbox: 0,
  mine: 0,
  unassigned: 0,
  waiting: 0,
  done: 0,
  snoozed: 0,
  recently_active: 0,
};

const VIEW_LABELS: Record<ConversationView, string> = {
  inbox: "Inbox",
  mine: "Assigned to me",
  unassigned: "Unassigned",
  waiting: "Waiting",
  done: "Done",
  snoozed: "Snoozed",
  recently_active: "Recent activity",
};

export type MailListItem = {
  id: string;
  conversationId: string | null;
  subject: string;
  participantSummary: string;
  latestMessageAt: string;
  preview: string | null;
  unread: boolean;
  hasAttachments: boolean;
  messageCount: number;
  workStatus: "open" | "waiting" | "done" | null;
  assigneeUserId: string | null;
  responseNeeded: boolean;
  snoozedUntil: string | null;
};

type MailboxPageData = {
  mailbox: Mailbox;
  permission: "read" | "write" | "admin";
  folders: MailFolderView[];
  identities: SenderIdentity[];
  activeView: ConversationView | null;
  folderId: string | null;
  viewCounts: ConversationViewCounts;
  query: string;
  selectedConversationId: string | null;
  selectedMessageId: string | null;
  listItems: MailListItem[];
  listError: string | null;
  listTitle: string;
  detailMessages: MessageDetail[];
  collaborationState: ConversationCollaboration | null;
  comments: ConversationComment[];
  assignableUsers: MailAssignableUser[];
  collaborationError: string | null;
  selectedSubject: string;
};

type MailSelectionDetail = Pick<
  MailboxPageData,
  "detailMessages" | "collaborationState" | "comments" | "assignableUsers" | "collaborationError"
>;

const EMPTY_SELECTION_DETAIL: MailSelectionDetail = {
  detailMessages: [],
  collaborationState: null,
  comments: [],
  assignableUsers: [],
  collaborationError: null,
};

const loadConversationDetails = async (params: { context: MailRequestContext; mailboxId: string; conversationId: string }) => {
  const [page, stateResult, commentsResult, usersResult] = await Promise.all([
    messages.listConversationMessages({ ...params, limit: 50 }),
    collaboration.getConversationCollaboration(params),
    collaboration.listConversationComments({ ...params, limit: 100 }),
    collaboration.listAssignableUsers({ context: params.context, mailboxId: params.mailboxId, limit: 200 }),
  ]);
  const detailResults = page.ok
    ? await Promise.all(
        page.data.items.map((message) =>
          messages.getMessage({ context: params.context, mailboxId: params.mailboxId, messageId: message.id }),
        ),
      )
    : [];
  const detailMessages = detailResults
    .filter((result): result is Extract<(typeof detailResults)[number], { ok: true }> => result.ok)
    .map((result) => result.data);

  return {
    detailMessages,
    collaborationState: stateResult.ok ? stateResult.data : null,
    comments: commentsResult.ok ? commentsResult.data.items : [],
    assignableUsers: usersResult.ok ? usersResult.data : [],
    collaborationError: !stateResult.ok ? stateResult.error.message : !commentsResult.ok ? commentsResult.error.message : null,
  };
};

const loadSelectionDetail = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string | null;
  messageId: string | null;
}): Promise<MailSelectionDetail> => {
  if (params.conversationId) {
    return await loadConversationDetails({
      context: params.context,
      mailboxId: params.mailboxId,
      conversationId: params.conversationId,
    });
  }
  if (!params.messageId) return EMPTY_SELECTION_DETAIL;

  const detail = await messages.getMessage({
    context: params.context,
    mailboxId: params.mailboxId,
    messageId: params.messageId,
  });
  return detail.ok ? { ...EMPTY_SELECTION_DETAIL, detailMessages: [detail.data] } : EMPTY_SELECTION_DETAIL;
};

const loadListItems = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  folderId: string | null;
  activeView: ConversationView | null;
  query: string;
}): Promise<{ items: MailListItem[]; error: string | null }> => {
  if (params.query) {
    const result = await search.searchMessages({
      context: params.context,
      mailboxId: params.mailboxId,
      request: { expression: { field: "any", query: params.query, match: "words" }, sort: "relevance", limit: 100 },
    });
    if (!result.ok) return { items: [], error: result.error.message };
    return {
      error: null,
      items: result.data.items.map((item) => ({
        id: item.id,
        conversationId: item.conversationId,
        subject: item.subject,
        participantSummary: item.from.map((address) => address.name || address.address).join(", "),
        latestMessageAt: item.internalDate,
        preview: item.snippet,
        unread: !item.flags.includes("\\Seen"),
        hasAttachments: item.hasAttachments,
        messageCount: 1,
        workStatus: null,
        assigneeUserId: null,
        responseNeeded: false,
        snoozedUntil: null,
      })),
    };
  }

  const result = await messages.listConversations({
    context: params.context,
    mailboxId: params.mailboxId,
    folderId: params.folderId,
    view: params.activeView,
    limit: 100,
  });
  if (!result.ok) return { items: [], error: result.error.message };
  return {
    error: null,
    items: result.data.items.map((item) => ({
      id: item.id,
      conversationId: item.id,
      subject: item.subject,
      participantSummary: item.participantSummary,
      latestMessageAt: item.latestMessageAt,
      preview: item.preview,
      unread: item.unread,
      hasAttachments: item.hasAttachments,
      messageCount: item.messageCount,
      workStatus: item.workStatus,
      assigneeUserId: item.assigneeUserId,
      responseNeeded: item.responseNeeded,
      snoozedUntil: item.snoozedUntil,
    })),
  };
};

export const loadMailboxPageData = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  requestUrl: URL;
}): Promise<MailboxPageData | null> => {
  const [mailboxResult, folderResult, identityResult, permission, viewCountsResult] = await Promise.all([
    mailboxes.getMailbox(params.context, params.mailboxId),
    messages.listFolders(params.context, params.mailboxId),
    senderIdentities.listSenderIdentities(params.context, params.mailboxId),
    mailboxAccess.getMailboxPermission(params.context, params.mailboxId),
    messages.getConversationViewCounts({ context: params.context, mailboxId: params.mailboxId }),
  ]);
  if (!mailboxResult.ok || permission === "none") return null;

  const parsedView = conversationViewSchema.safeParse(params.requestUrl.searchParams.get("view") ?? undefined);
  const activeView = parsedView.success ? parsedView.data : null;
  const folderId = activeView ? null : params.requestUrl.searchParams.get("folder");
  const query = params.requestUrl.searchParams.get("q")?.trim() ?? "";
  const selectedConversationId = params.requestUrl.searchParams.get("conversation");
  const selectedMessageId = params.requestUrl.searchParams.get("message");
  const folders = folderResult.ok ? folderResult.data : [];
  const list = await loadListItems({ context: params.context, mailboxId: params.mailboxId, folderId, activeView, query });

  const selection = await loadSelectionDetail({
    context: params.context,
    mailboxId: params.mailboxId,
    conversationId: selectedConversationId,
    messageId: selectedMessageId,
  });

  const activeFolder = folders.find((folder) => folder.id === folderId);
  const selectedSubject =
    selection.detailMessages.at(-1)?.subject ||
    list.items.find((item) => item.conversationId === selectedConversationId)?.subject ||
    "Message";

  return {
    mailbox: mailboxResult.data,
    permission,
    folders,
    identities: identityResult.ok ? identityResult.data : [],
    activeView,
    folderId,
    viewCounts: viewCountsResult.ok ? viewCountsResult.data : EMPTY_VIEW_COUNTS,
    query,
    selectedConversationId,
    selectedMessageId,
    listItems: list.items,
    listError: list.error,
    listTitle: query ? `Results for “${query}”` : activeView ? VIEW_LABELS[activeView] : (activeFolder?.name ?? "All mail"),
    ...selection,
    selectedSubject,
  };
};

export const buildMailListHref = (requestUrl: URL, clearSearch = false): string => {
  const next = new URL(requestUrl);
  next.searchParams.delete("conversation");
  next.searchParams.delete("message");
  if (clearSearch) next.searchParams.delete("q");
  return `${next.pathname}${next.search}`;
};

export const buildMailSelectionHref = (requestUrl: URL, item: MailListItem): string => {
  const next = new URL(buildMailListHref(requestUrl), requestUrl.origin);
  if (item.conversationId) next.searchParams.set("conversation", item.conversationId);
  else next.searchParams.set("message", item.id);
  return `${next.pathname}${next.search}`;
};
