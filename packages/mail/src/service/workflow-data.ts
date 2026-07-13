import { sql } from "bun";
import type { WorkflowTargetQuery } from "../contracts";
import { sha256Json } from "./canonical";
import { compileSearchExpression } from "./search";
import type { WorkflowSnapshot } from "./workflow-evaluator";

type SqlClient = typeof sql;

type WorkflowSnapshotRow = {
  remote_message_ref_id: string;
  message_id: string;
  conversation_id: string | null;
  subject: string;
  plain_text: string | null;
  hydration_status: string;
  sender_values: string[] | string;
  recipient_values: string[] | string;
  attachment_names: string[] | string;
  has_attachment: boolean;
  content_hash: string;
  internal_date: Date | string;
  folder_id: string;
  modseq: string | number | null;
  flags: string[] | null;
  keywords: string[] | null;
  collaboration_revision: string | number | null;
  assignee_user_id: string | null;
  work_status: "open" | "waiting" | "done" | null;
  response_needed: boolean | null;
};

export type WorkflowTargetSnapshot = WorkflowSnapshot & {
  remoteModseq: string | null;
  sourceStateHash: string;
};

const parseTextArray = (value: string[] | string): string[] => (typeof value === "string" ? (JSON.parse(value) as string[]) : value);

const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();

export const workflowSourceStateHash = (snapshot: WorkflowSnapshot, remoteModseq: string | null): string =>
  sha256Json({
    remoteMessageRefId: snapshot.remoteMessageRefId,
    messageId: snapshot.messageId,
    conversationId: snapshot.conversationId,
    contentHash: snapshot.contentHash,
    folderId: snapshot.folderId,
    modseq: remoteModseq,
    flags: snapshot.flags,
    keywords: snapshot.keywords,
    collaboration: snapshot.collaboration,
  });

const standardFlagNames: Record<string, string> = {
  "\\answered": "answered",
  "\\draft": "draft",
  "\\flagged": "flagged",
  "\\seen": "seen",
};

export const normalizeWorkflowFlags = (flags: readonly string[]): string[] =>
  flags.map((flag) => standardFlagNames[flag.toLowerCase()] ?? flag).sort();

const mapSnapshot = (row: WorkflowSnapshotRow): WorkflowTargetSnapshot => {
  const flags = normalizeWorkflowFlags(row.flags ?? []);
  const keywords = [...(row.keywords ?? [])].sort();
  const collaboration =
    row.conversation_id && row.collaboration_revision != null && row.work_status && row.response_needed != null
      ? {
          revision: Number(row.collaboration_revision),
          assigneeUserId: row.assignee_user_id,
          workStatus: row.work_status,
          responseNeeded: row.response_needed,
        }
      : null;
  const snapshot: WorkflowSnapshot = {
    remoteMessageRefId: row.remote_message_ref_id,
    messageId: row.message_id,
    conversationId: row.conversation_id,
    subject: row.subject,
    body: row.plain_text ?? "",
    bodyAvailable: row.hydration_status === "body" || row.hydration_status === "complete",
    senderValues: parseTextArray(row.sender_values),
    recipientValues: parseTextArray(row.recipient_values),
    attachmentNames: parseTextArray(row.attachment_names),
    attachmentsAvailable: row.hydration_status === "complete",
    hasAttachment: row.has_attachment,
    contentHash: row.content_hash,
    internalDate: toIso(row.internal_date),
    folderId: row.folder_id,
    flags,
    keywords,
    collaboration,
  };
  const remoteModseq = row.modseq == null ? null : String(row.modseq);
  return { ...snapshot, remoteModseq, sourceStateHash: workflowSourceStateHash(snapshot, remoteModseq) };
};

const snapshotColumns = sql`
  rmr.id AS remote_message_ref_id,
  mc.id AS message_id,
  cm.conversation_id,
  mc.subject,
  mc.plain_text,
  mc.hydration_status,
  COALESCE(sender.values, '[]'::jsonb) AS sender_values,
  COALESCE(recipient.values, '[]'::jsonb) AS recipient_values,
  COALESCE(attachment.values, '[]'::jsonb) AS attachment_names,
  EXISTS (SELECT 1 FROM mail.attachments a WHERE a.message_id = mc.id) AS has_attachment,
  mc.content_hash,
  mc.internal_date,
  mp.folder_id,
  rmr.modseq,
  mp.flags,
  mp.keywords,
  conversation.revision AS collaboration_revision,
  conversation.assignee_user_id,
  conversation.work_status,
  conversation.response_needed
`;

const snapshotJoins = sql`
  JOIN mail.message_placements mp ON mp.remote_message_ref_id = rmr.id
  JOIN mail.message_contents mc ON mc.id = rmr.message_id
  JOIN mail.folders folder ON folder.id = rmr.folder_id
  JOIN mail.remote_resources resource ON resource.id = folder.remote_resource_id
  LEFT JOIN mail.conversation_messages cm ON cm.message_id = mc.id
  LEFT JOIN mail.conversations conversation ON conversation.id = cm.conversation_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(value ORDER BY role, position, value) AS values
    FROM (
      SELECT ma.role, ma.position, ma.email AS value
      FROM mail.message_addresses ma
      WHERE ma.message_id = mc.id AND ma.role IN ('from', 'reply_to')
      UNION ALL
      SELECT ma.role, ma.position, ma.display_name AS value
      FROM mail.message_addresses ma
      WHERE ma.message_id = mc.id AND ma.role IN ('from', 'reply_to') AND ma.display_name IS NOT NULL
    ) sender_value
  ) sender ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(value ORDER BY role, position, value) AS values
    FROM (
      SELECT ma.role, ma.position, ma.email AS value
      FROM mail.message_addresses ma
      WHERE ma.message_id = mc.id AND ma.role IN ('to', 'cc', 'bcc')
      UNION ALL
      SELECT ma.role, ma.position, ma.display_name AS value
      FROM mail.message_addresses ma
      WHERE ma.message_id = mc.id AND ma.role IN ('to', 'cc', 'bcc') AND ma.display_name IS NOT NULL
    ) recipient_value
  ) recipient ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(a.filename ORDER BY a.id) AS values
    FROM mail.attachments a
    WHERE a.message_id = mc.id AND a.filename IS NOT NULL
  ) attachment ON true
`;

export const listWorkflowSnapshots = async (params: {
  mailboxId: string;
  query: WorkflowTargetQuery;
  limit: number;
  db?: SqlClient;
}): Promise<WorkflowTargetSnapshot[]> => {
  const db = params.db ?? sql;
  const predicate = params.query.type === "search" ? compileSearchExpression(params.query.expression) : sql`TRUE`;
  const rows = await db<WorkflowSnapshotRow[]>`
    SELECT ${snapshotColumns}
    FROM mail.remote_message_refs rmr
    ${snapshotJoins}
    WHERE resource.mailbox_id = ${params.mailboxId}::uuid
      AND rmr.stale_at IS NULL
      AND mp.deleted_at IS NULL
      AND folder.discovery_state = 'active'
      AND (${predicate})
    ORDER BY mc.internal_date DESC, rmr.id DESC
    LIMIT ${params.limit}
  `;
  return rows.map(mapSnapshot);
};

export const getWorkflowSnapshot = async (params: {
  mailboxId: string;
  remoteMessageRefId: string;
  db?: SqlClient;
}): Promise<WorkflowTargetSnapshot | null> => {
  const db = params.db ?? sql;
  const [row] = await db<WorkflowSnapshotRow[]>`
    SELECT ${snapshotColumns}
    FROM mail.remote_message_refs rmr
    ${snapshotJoins}
    WHERE resource.mailbox_id = ${params.mailboxId}::uuid
      AND rmr.id = ${params.remoteMessageRefId}::uuid
      AND rmr.stale_at IS NULL
      AND mp.deleted_at IS NULL
      AND folder.discovery_state = 'active'
  `;
  return row ? mapSnapshot(row) : null;
};
