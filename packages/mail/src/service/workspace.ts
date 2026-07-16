import { z } from "zod";
import {
  type ConversationView,
  conversationViewSchema,
  type Mailbox,
  type MailDraft,
  type MailSearchExpression,
  type SenderIdentity,
} from "../contracts";
import * as mailboxAccess from "./access";
import type { MailRequestContext } from "./auth";
import type { ConversationCollaboration, ConversationComment, MailActivityEvent, MailAssignableUser } from "./collaboration";
import * as collaboration from "./collaboration";
import * as drafts from "./drafts";
import * as mailboxes from "./mailboxes";
import type { ConversationSummary, ConversationViewCounts, MailFolderView, MessageDetail } from "./messages";
import * as messages from "./messages";
import type { ConversationReminder } from "./reminders";
import * as reminders from "./reminders";
import type { SavedConversationView } from "./saved-views";
import * as savedViews from "./saved-views";
import * as search from "./search";
import * as senderIdentities from "./sender-identities";

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
  sourceFolderId: string | null;
};

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

const optionalUuidSearchParam = (url: URL, name: string): string | null => {
  const parsed = z.string().uuid().safeParse(url.searchParams.get(name));
  return parsed.success ? parsed.data : null;
};

const searchExpressionFromUrl = (url: URL, query: string): MailSearchExpression | null => {
  if (query) return { field: "any", query, match: "words" };
  const terms: MailSearchExpression[] = [];
  for (const [parameter, fields] of [
    ["from", ["from"]],
    ["to", ["to", "cc"]],
    ["subject", ["subject"]],
    ["body", ["body"]],
  ] as const) {
    const value = url.searchParams.get(parameter)?.trim();
    if (!value) continue;
    const fieldTerms = fields.map((field) => ({ field, query: value, match: "words" as const }));
    terms.push(fieldTerms.length === 1 ? fieldTerms[0]! : { or: fieldTerms });
  }
  if (terms.length === 0) return null;
  if (terms.length === 1) return terms[0]!;
  return url.searchParams.get("combine") === "all" ? { and: terms } : { or: terms };
};

export type MailboxPageData = {
  mailbox: Mailbox;
  permission: "read" | "write" | "admin";
  folders: MailFolderView[];
  identities: SenderIdentity[];
  drafts: MailDraft[];
  activeView: ConversationView | null;
  savedViewId: string | null;
  savedViews: SavedConversationView[];
  folderId: string | null;
  viewCounts: ConversationViewCounts;
  query: string;
  selectedConversationId: string | null;
  selectedMessageId: string | null;
  listItems: MailListItem[];
  listCursor: string | null;
  nextListCursor: string | null;
  listError: string | null;
  listTitle: string;
  detailMessages: MessageDetail[];
  collaborationState: ConversationCollaboration | null;
  comments: ConversationComment[];
  assignableUsers: MailAssignableUser[];
  activity: MailActivityEvent[];
  reminder: ConversationReminder | null;
  collaborationError: string | null;
  selectedSubject: string;
};

type MailSelectionDetail = Pick<
  MailboxPageData,
  "detailMessages" | "collaborationState" | "comments" | "assignableUsers" | "activity" | "reminder" | "collaborationError"
>;

const EMPTY_SELECTION_DETAIL: MailSelectionDetail = {
  detailMessages: [],
  collaborationState: null,
  comments: [],
  assignableUsers: [],
  activity: [],
  reminder: null,
  collaborationError: null,
};

const conversationToListItem = (conversation: ConversationSummary): MailListItem => ({
  id: conversation.id,
  conversationId: conversation.id,
  subject: conversation.subject,
  participantSummary: conversation.participantSummary,
  latestMessageAt: conversation.latestMessageAt,
  preview: conversation.preview,
  unread: conversation.unread,
  hasAttachments: conversation.hasAttachments,
  messageCount: conversation.messageCount,
  workStatus: conversation.workStatus,
  assigneeUserId: conversation.assigneeUserId,
  responseNeeded: conversation.responseNeeded,
  snoozedUntil: conversation.snoozedUntil,
  sourceFolderId: conversation.folderId,
});

const loadConversationDetails = async (params: { context: MailRequestContext; mailboxId: string; conversationId: string }) => {
  const [detailResult, stateResult, commentsResult, usersResult, activityResult, reminderResult] = await Promise.all([
    messages.listConversationMessageDetails({ ...params, limit: 100 }),
    collaboration.getConversationCollaboration(params),
    collaboration.listConversationComments({ ...params, limit: 100 }),
    collaboration.listAssignableUsers({ context: params.context, mailboxId: params.mailboxId, limit: 200 }),
    collaboration.listActivity({ ...params, limit: 30 }),
    reminders.getConversationReminder(params),
  ]);

  return {
    detailMessages: detailResult.ok ? detailResult.data : [],
    collaborationState: stateResult.ok ? stateResult.data : null,
    comments: commentsResult.ok ? commentsResult.data.items : [],
    assignableUsers: usersResult.ok ? usersResult.data : [],
    activity: activityResult.ok ? activityResult.data.items : [],
    reminder: reminderResult.ok ? reminderResult.data : null,
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
  savedViewId: string | null;
  query: string;
  searchExpression: MailSearchExpression | null;
  cursor?: string;
}): Promise<{ items: MailListItem[]; nextCursor: string | null; error: string | null }> => {
  if (params.searchExpression) {
    const result = await search.searchMessages({
      context: params.context,
      mailboxId: params.mailboxId,
      request: { expression: params.searchExpression, sort: "relevance", cursor: params.cursor, limit: 50 },
    });
    if (!result.ok) return { items: [], nextCursor: null, error: result.error.message };
    return {
      error: null,
      nextCursor: result.data.nextCursor,
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
        sourceFolderId: null,
      })),
    };
  }

  if (params.savedViewId) {
    const result = await savedViews.listSavedViewConversations({
      context: params.context,
      mailboxId: params.mailboxId,
      viewId: params.savedViewId,
      cursor: params.cursor,
      limit: 50,
    });
    if (!result.ok) return { items: [], nextCursor: null, error: result.error.message };
    return {
      error: null,
      nextCursor: result.data.nextCursor,
      items: result.data.items.map(conversationToListItem),
    };
  }

  const result = await messages.listConversations({
    context: params.context,
    mailboxId: params.mailboxId,
    folderId: params.folderId,
    view: params.activeView,
    cursor: params.cursor,
    limit: 50,
  });
  if (!result.ok) return { items: [], nextCursor: null, error: result.error.message };
  return {
    error: null,
    nextCursor: result.data.nextCursor,
    items: result.data.items.map(conversationToListItem),
  };
};

export const loadMailboxPageData = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  requestUrl: URL;
}): Promise<MailboxPageData | null> => {
  const [mailboxResult, folderResult, identityResult, permission, viewCountsResult, savedViewResult, draftResult] = await Promise.all([
    mailboxes.getMailbox(params.context, params.mailboxId),
    messages.listFolders(params.context, params.mailboxId),
    senderIdentities.listSenderIdentities(params.context, params.mailboxId),
    mailboxAccess.getMailboxPermission(params.context, params.mailboxId),
    messages.getConversationViewCounts({ context: params.context, mailboxId: params.mailboxId }),
    savedViews.listSavedConversationViews({ context: params.context, mailboxId: params.mailboxId }),
    drafts.listDrafts(params.context, params.mailboxId, 20),
  ]);
  if (!mailboxResult.ok || permission === "none") return null;

  const parsedView = conversationViewSchema.safeParse(params.requestUrl.searchParams.get("view") ?? undefined);
  const activeView = parsedView.success ? parsedView.data : null;
  const savedViewId = activeView ? null : optionalUuidSearchParam(params.requestUrl, "savedView");
  const folderId = activeView || savedViewId ? null : optionalUuidSearchParam(params.requestUrl, "folder");
  const query = params.requestUrl.searchParams.get("q")?.trim() ?? "";
  const searchExpression = searchExpressionFromUrl(params.requestUrl, query);
  const listCursor = params.requestUrl.searchParams.get("cursor");
  const selectedConversationId = optionalUuidSearchParam(params.requestUrl, "conversation");
  const selectedMessageId = selectedConversationId ? null : optionalUuidSearchParam(params.requestUrl, "message");
  const folders = folderResult.ok ? folderResult.data : [];
  const list = await loadListItems({
    context: params.context,
    mailboxId: params.mailboxId,
    folderId,
    activeView,
    savedViewId,
    query,
    searchExpression,
    cursor: listCursor ?? undefined,
  });

  const selection = await loadSelectionDetail({
    context: params.context,
    mailboxId: params.mailboxId,
    conversationId: selectedConversationId,
    messageId: selectedMessageId,
  });

  const activeFolder = folders.find((folder) => folder.id === folderId);
  const activeSavedView = savedViewResult.ok ? savedViewResult.data.find((view) => view.id === savedViewId) : null;
  const selectedSubject =
    selection.detailMessages.at(-1)?.subject ||
    list.items.find((item) => item.conversationId === selectedConversationId)?.subject ||
    "Message";

  return {
    mailbox: mailboxResult.data,
    permission,
    folders,
    identities: identityResult.ok ? identityResult.data : [],
    drafts: draftResult.ok ? draftResult.data : [],
    activeView,
    savedViewId,
    savedViews: savedViewResult.ok ? savedViewResult.data : [],
    folderId,
    viewCounts: viewCountsResult.ok ? viewCountsResult.data : EMPTY_VIEW_COUNTS,
    query,
    selectedConversationId,
    selectedMessageId,
    listItems: list.items,
    listCursor,
    nextListCursor: list.nextCursor,
    listError: list.error,
    listTitle: searchExpression
      ? query
        ? `Results for “${query}”`
        : "Filtered search"
      : activeView
        ? VIEW_LABELS[activeView]
        : (activeSavedView?.name ?? activeFolder?.name ?? "All mail"),
    ...selection,
    selectedSubject,
  };
};
