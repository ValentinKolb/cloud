import type { MailActivityEvent } from "../../service/collaboration";

const labels: Readonly<Record<string, string>> = {
  "conversation.comment_created": "added an internal comment",
  "conversation.comment_deleted": "deleted an internal comment",
  "conversation.comment_updated": "updated an internal comment",
  "conversation.local_tags_added": "added tags",
  "conversation.local_tags_updated": "updated tags",
  "conversation.merged": "merged conversations",
  "conversation.message_reassigned": "moved a message between conversations",
  "conversation.reference_allocated": "assigned a reference number",
  "conversation.split": "split the conversation",
};

type CollaborationSnapshot = {
  assigneeUserId?: unknown;
  workStatus?: unknown;
  snoozedUntil?: unknown;
};

const snapshot = (value: unknown): CollaborationSnapshot => (value && typeof value === "object" ? (value as CollaborationSnapshot) : {});

const workStatusLabel = (value: unknown): string =>
  value === "done" ? "Done" : value === "waiting" ? "Waiting for reply" : "Needs action";

export const mailActivityLabel = (event: MailActivityEvent): string => {
  if (event.action !== "conversation.collaboration_updated") {
    return labels[event.action] ?? event.action.split(".").at(-1)!.replaceAll("_", " ");
  }
  const before = snapshot(event.metadata.before);
  const after = snapshot(event.metadata.after);
  const changes: string[] = [];
  if (before.assigneeUserId !== after.assigneeUserId)
    changes.push(after.assigneeUserId ? "assigned the conversation" : "removed the assignee");
  if (before.workStatus !== after.workStatus) changes.push(`marked it ${workStatusLabel(after.workStatus)}`);
  if (before.snoozedUntil !== after.snoozedUntil) changes.push(after.snoozedUntil ? "snoozed the conversation" : "removed the snooze");
  return changes.join(" and ") || "updated the conversation";
};

export type PresentedMailActivity = MailActivityEvent & { label: string; count: number };

export const presentMailActivity = (events: MailActivityEvent[]): PresentedMailActivity[] => {
  const presented: PresentedMailActivity[] = [];
  for (const event of events) {
    const label = mailActivityLabel(event);
    const previous = presented.at(-1);
    if (previous && previous.actor.id === event.actor.id && previous.actor.kind === event.actor.kind && previous.label === label) {
      previous.count += 1;
      continue;
    }
    presented.push({ ...event, label, count: 1 });
  }
  return presented;
};
