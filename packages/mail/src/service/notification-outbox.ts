import type { sql } from "bun";

type SqlClient = typeof sql;

export type CollaborationNotificationKind = "mention" | "reminder";

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
  for (const recipientUserId of new Set(params.recipientUserIds)) {
    await params.db`
      INSERT INTO mail.collaboration_notification_deliveries (
        kind,
        mailbox_id,
        conversation_id,
        recipient_user_id,
        source_id,
        source_revision,
        available_at
      ) VALUES (
        ${params.kind},
        ${params.mailboxId}::uuid,
        ${params.conversationId}::uuid,
        ${recipientUserId}::uuid,
        ${params.sourceId}::uuid,
        ${params.sourceRevision},
        ${params.availableAt ?? new Date().toISOString()}::timestamptz
      )
      ON CONFLICT (kind, source_id, source_revision, recipient_user_id) DO NOTHING
    `;
  }
};
