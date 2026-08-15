import type { MailSelectionDetail } from "../../service/workspace";

const DETAIL_ERROR_LABELS: Array<[keyof MailSelectionDetail["detailErrors"], string]> = [
  ["collaboration", "workflow state"],
  ["tags", "tags"],
  ["comments", "team notes"],
  ["assignableUsers", "assignees"],
  ["activity", "recent activity"],
  ["reminder", "personal reminder"],
  ["reference", "conversation reference"],
  ["summary", "conversation summary"],
  ["drafts", "drafts"],
];

export const listUnavailableMailDetailSections = (errors: MailSelectionDetail["detailErrors"]): string[] =>
  DETAIL_ERROR_LABELS.flatMap(([key, label]) => (errors[key] ? [label] : []));

export const preserveUnavailableMailDetail = <T extends MailSelectionDetail>(current: T, incoming: T): T => ({
  ...incoming,
  detailMessages: incoming.detailError ? current.detailMessages : incoming.detailMessages,
  collaborationState: incoming.detailErrors.collaboration ? current.collaborationState : incoming.collaborationState,
  conversationLocalTags: incoming.detailErrors.tags ? current.conversationLocalTags : incoming.conversationLocalTags,
  comments: incoming.detailErrors.comments ? current.comments : incoming.comments,
  commentsCursor: incoming.detailErrors.comments ? current.commentsCursor : incoming.commentsCursor,
  assignableUsers: incoming.detailErrors.assignableUsers ? current.assignableUsers : incoming.assignableUsers,
  activity: incoming.detailErrors.activity ? current.activity : incoming.activity,
  reminder: incoming.detailErrors.reminder ? current.reminder : incoming.reminder,
  selectedReference: incoming.detailErrors.reference ? current.selectedReference : incoming.selectedReference,
  conversationSummary: incoming.detailErrors.summary ? current.conversationSummary : incoming.conversationSummary,
  conversationDrafts: incoming.detailErrors.drafts ? current.conversationDrafts : incoming.conversationDrafts,
});
