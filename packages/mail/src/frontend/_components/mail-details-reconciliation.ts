import type { ConversationCollaboration, ConversationComment } from "../../service/collaboration";
import type { ConversationLocalTags, LocalTag } from "../../service/local-tags";
import type { ConversationReminder } from "../../service/reminders";

export const reconcileCollaboration = (
  current: ConversationCollaboration,
  incoming: ConversationCollaboration,
): ConversationCollaboration =>
  incoming.conversationId !== current.conversationId || incoming.revision >= current.revision ? incoming : current;

export const reconcileConversationTags = (current: ConversationLocalTags, incoming: ConversationLocalTags): ConversationLocalTags =>
  incoming.conversationId !== current.conversationId || incoming.conversationRevision > current.conversationRevision ? incoming : current;

export const reconcileReminder = (
  current: ConversationReminder | null,
  incoming: ConversationReminder | null,
): ConversationReminder | null => {
  if (!current) return incoming;
  if (!incoming) return current;
  if (current.id !== incoming.id) return incoming;
  return incoming.revision >= current.revision ? incoming : current;
};

export const reconcileComments = (current: ConversationComment[], incoming: ConversationComment[]): ConversationComment[] => {
  const merged = new Map(current.map((comment) => [comment.id, comment]));
  for (const comment of incoming) {
    const existing = merged.get(comment.id);
    if (!existing || comment.revision > existing.revision) merged.set(comment.id, comment);
  }
  return [...merged.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
};

export const reconcileAvailableTags = (
  current: LocalTag[],
  incoming: LocalTag[],
  confirmedIds: ReadonlySet<string>,
): { tags: LocalTag[]; confirmedIds: Set<string> } => {
  const incomingById = new Map(incoming.map((tag) => [tag.id, tag]));
  for (const tag of current) {
    if (!confirmedIds.has(tag.id) && !incomingById.has(tag.id)) incomingById.set(tag.id, tag);
  }
  return {
    tags: [...incomingById.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    confirmedIds: new Set(incoming.map((tag) => tag.id)),
  };
};
