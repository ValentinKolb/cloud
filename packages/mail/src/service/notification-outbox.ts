import type { sql } from "bun";

type SqlClient = typeof sql;

export type CollaborationNotificationKind = "reminder";

export const enqueueCollaborationNotifications = async (params: {
  db: SqlClient;
  kind: CollaborationNotificationKind;
  mailboxId: string;
  conversationId: string;
  recipientUserIds: readonly string[];
  sourceId: string;
  sourceRevision: number;
  availableAt?: string;
}): Promise<void> => {
  const [source] = await params.db<{ short_id: string }[]>`
    SELECT short_id
    FROM mail.conversation_reminders
    WHERE id = ${params.sourceId}::uuid
      AND mailbox_id = ${params.mailboxId}::uuid
      AND conversation_id = ${params.conversationId}::uuid
  `;
  if (!source) throw new Error("Mail notification source has no public ID");
  for (const recipientUserId of new Set(params.recipientUserIds)) {
    await params.db`
      INSERT INTO mail.collaboration_notification_deliveries (
        kind,
        mailbox_id,
        conversation_id,
        recipient_user_id,
        source_id,
        source_short_id,
        source_revision,
        available_at
      ) VALUES (
        ${params.kind},
        ${params.mailboxId}::uuid,
        ${params.conversationId}::uuid,
        ${recipientUserId}::uuid,
        ${params.sourceId}::uuid,
        ${source.short_id},
        ${params.sourceRevision},
        ${params.availableAt ?? new Date().toISOString()}::timestamptz
      )
      ON CONFLICT (kind, source_id, source_revision, recipient_user_id) DO NOTHING
    `;
  }
};
