import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { userBackedActor, type MailRequestContext } from "./auth";
import { requireMailboxCollaborationPermission } from "./collaboration";
import type { CollaborationNotificationKind } from "./notification-outbox";

type SqlClient = typeof sql;

export const MAIL_NOTIFICATION_DEFINITION_IDS: Record<CollaborationNotificationKind, string> = {
  mention: "mail.commentMention",
  reminder: "mail.conversationReminder",
};

export const mailNotificationTargetHref = (params: {
  mailboxId: string;
  kind: CollaborationNotificationKind;
  sourceId: string;
}): `/${string}` =>
  `/api/mail/mailboxes/${encodeURIComponent(params.mailboxId)}/notification-targets/${params.kind}/${encodeURIComponent(params.sourceId)}`;

const conversationHref = (params: { mailboxId: string; conversationId: string; commentId?: string }): `/${string}` =>
  `/app/mail/${encodeURIComponent(params.mailboxId)}?conversation=${encodeURIComponent(params.conversationId)}${
    params.commentId ? `&comment=${encodeURIComponent(params.commentId)}` : ""
  }`;

export const resolveMailNotificationTarget = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  kind: CollaborationNotificationKind;
  sourceId: string;
  db?: SqlClient;
}): Promise<Result<{ href: `/${string}` }>> => {
  const db = params.db ?? sql;
  const allowed = await requireMailboxCollaborationPermission(params.context, params.mailboxId, "read", db);
  if (!allowed.ok) return allowed;

  if (params.kind === "mention") {
    const [comment] = await db<{ conversation_id: string }[]>`
      SELECT comment.conversation_id
      FROM mail.conversation_comments comment
      JOIN mail.conversations conversation ON conversation.id = comment.conversation_id
      WHERE comment.id = ${params.sourceId}::uuid
        AND conversation.mailbox_id = ${params.mailboxId}::uuid
    `;
    return comment
      ? ok({ href: conversationHref({ mailboxId: params.mailboxId, conversationId: comment.conversation_id, commentId: params.sourceId }) })
      : fail(err.notFound("Notification target"));
  }

  const user = userBackedActor(params.context);
  if (!user) return fail(err.notFound("Notification target"));
  const [reminder] = await db<{ conversation_id: string }[]>`
    SELECT reminder.conversation_id
    FROM mail.conversation_reminders reminder
    JOIN mail.conversations conversation ON conversation.id = reminder.conversation_id
    WHERE reminder.id = ${params.sourceId}::uuid
      AND reminder.user_id = ${user.id}::uuid
      AND conversation.mailbox_id = ${params.mailboxId}::uuid
  `;
  if (reminder) {
    return ok({ href: conversationHref({ mailboxId: params.mailboxId, conversationId: reminder.conversation_id }) });
  }
  const [delivery] = await db<{ conversation_id: string }[]>`
    SELECT delivery.conversation_id
    FROM mail.collaboration_notification_deliveries delivery
    JOIN mail.conversations conversation ON conversation.id = delivery.conversation_id
    WHERE delivery.kind = 'reminder'
      AND delivery.source_id = ${params.sourceId}::uuid
      AND delivery.recipient_user_id = ${user.id}::uuid
      AND delivery.mailbox_id = ${params.mailboxId}::uuid
      AND conversation.mailbox_id = ${params.mailboxId}::uuid
    ORDER BY delivery.source_revision DESC
    LIMIT 1
  `;
  return delivery
    ? ok({ href: conversationHref({ mailboxId: params.mailboxId, conversationId: delivery.conversation_id }) })
    : fail(err.notFound("Notification target"));
};
