import { sql } from "bun";
import type { MailSearchExpression, WorkflowTargetQuery } from "../contracts";
import { sha256Json, sha256Text } from "./canonical";
import { compileSearchExpression } from "./search";
import type { WorkflowSnapshot, WorkflowSnapshotField } from "./workflow-evaluator";

type SqlClient = typeof sql;

const searchExpressionUsesBody = (expression: MailSearchExpression): boolean => {
  const remaining: MailSearchExpression[] = [expression];
  while (remaining.length > 0) {
    const current = remaining.pop()!;
    if ("and" in current) remaining.push(...current.and);
    else if ("or" in current) remaining.push(...current.or);
    else if ("not" in current) remaining.push(current.not);
    else if (current.field === "body" || current.field === "any") return true;
  }
  return false;
};

export const countWorkflowQueryBodyGaps = async (params: {
  mailboxId: string;
  query: WorkflowTargetQuery;
  db?: SqlClient;
}): Promise<number> => {
  if (params.query.type !== "search" || !searchExpressionUsesBody(params.query.expression)) return 0;
  const db = params.db ?? sql;
  const [row] = await db<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM mail.remote_message_refs rmr
    JOIN mail.message_placements mp ON mp.remote_message_ref_id = rmr.id
    JOIN mail.message_contents mc ON mc.id = rmr.message_id
    JOIN mail.folders folder ON folder.id = rmr.folder_id
    JOIN mail.remote_resources resource ON resource.id = folder.remote_resource_id
    WHERE resource.mailbox_id = ${params.mailboxId}::uuid
      AND rmr.stale_at IS NULL
      AND mp.deleted_at IS NULL
      AND folder.discovery_state = 'active'
      AND mc.hydration_status NOT IN ('body', 'complete')
  `;
  return row?.count ?? 0;
};

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

export const workflowSourceStateHash = (snapshot: WorkflowSnapshot, requirements: ReadonlySet<WorkflowSnapshotField>): string => {
  const state: Record<string, unknown> = {
    version: 1,
    remoteMessageRefId: snapshot.remoteMessageRefId,
    messageId: snapshot.messageId,
    conversationId: snapshot.conversationId,
  };
  if (requirements.has("subject")) state.subject = snapshot.subject;
  if (requirements.has("body")) state.body = { available: snapshot.bodyAvailable, hash: sha256Text(snapshot.body) };
  if (requirements.has("sender")) state.sender = snapshot.senderValues;
  if (requirements.has("recipient")) state.recipient = snapshot.recipientValues;
  if (requirements.has("attachmentName")) {
    state.attachments = { available: snapshot.attachmentsAvailable, names: snapshot.attachmentNames };
  }
  if (requirements.has("hasAttachment")) {
    state.hasAttachment = { available: snapshot.attachmentsAvailable, value: snapshot.hasAttachment };
  }
  if (requirements.has("folder")) state.folderId = snapshot.folderId;
  if (requirements.has("flag")) state.flags = snapshot.flags;
  if (requirements.has("keyword")) state.keywords = snapshot.keywords;
  if (requirements.has("collaboration")) state.collaboration = snapshot.collaboration;
  return sha256Json(state);
};

const standardFlagNames: Record<string, string> = {
  "\\answered": "answered",
  "\\draft": "draft",
  "\\flagged": "flagged",
  "\\seen": "seen",
};

export const normalizeWorkflowFlags = (flags: readonly string[]): string[] =>
  flags.map((flag) => standardFlagNames[flag.toLowerCase()] ?? flag).sort();

const mapSnapshot = (row: WorkflowSnapshotRow, requirements: ReadonlySet<WorkflowSnapshotField>): WorkflowTargetSnapshot => {
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
  return { ...snapshot, remoteModseq, sourceStateHash: workflowSourceStateHash(snapshot, requirements) };
};

const snapshotColumns = (requirements: ReadonlySet<WorkflowSnapshotField>) => sql`
  rmr.id AS remote_message_ref_id,
  mc.id AS message_id,
  cm.conversation_id,
  mc.subject,
  ${requirements.has("body") ? sql`mc.plain_text` : sql`NULL::text`} AS plain_text,
  mc.hydration_status,
  ${requirements.has("sender") ? sql`COALESCE(sender.values, '[]'::jsonb)` : sql`'[]'::jsonb`} AS sender_values,
  ${requirements.has("recipient") ? sql`COALESCE(recipient.values, '[]'::jsonb)` : sql`'[]'::jsonb`} AS recipient_values,
  ${requirements.has("attachmentName") ? sql`COALESCE(attachment.values, '[]'::jsonb)` : sql`'[]'::jsonb`} AS attachment_names,
  ${requirements.has("hasAttachment") ? sql`EXISTS (SELECT 1 FROM mail.attachments a WHERE a.message_id = mc.id)` : sql`false`} AS has_attachment,
  mc.content_hash,
  mc.internal_date,
  mp.folder_id,
  rmr.modseq,
  ${requirements.has("flag") ? sql`mp.flags` : sql`ARRAY[]::text[]`} AS flags,
  ${requirements.has("keyword") ? sql`mp.keywords` : sql`ARRAY[]::text[]`} AS keywords,
  ${requirements.has("collaboration") ? sql`conversation.revision` : sql`NULL::bigint`} AS collaboration_revision,
  ${requirements.has("collaboration") ? sql`conversation.assignee_user_id` : sql`NULL::uuid`} AS assignee_user_id,
  ${requirements.has("collaboration") ? sql`conversation.work_status` : sql`NULL::text`} AS work_status,
  ${requirements.has("collaboration") ? sql`conversation.response_needed` : sql`NULL::boolean`} AS response_needed
`;

const snapshotJoins = (requirements: ReadonlySet<WorkflowSnapshotField>) => sql`
  JOIN mail.message_placements mp ON mp.remote_message_ref_id = rmr.id
  JOIN mail.message_contents mc ON mc.id = rmr.message_id
  JOIN mail.folders folder ON folder.id = rmr.folder_id
  JOIN mail.remote_resources resource ON resource.id = folder.remote_resource_id
  LEFT JOIN mail.conversation_messages cm ON cm.message_id = mc.id
  ${requirements.has("collaboration") ? sql`LEFT JOIN mail.conversations conversation ON conversation.id = cm.conversation_id` : sql``}
  ${requirements.has("sender") ? sql`LEFT JOIN LATERAL (
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
  ) sender ON true` : sql``}
  ${requirements.has("recipient") ? sql`LEFT JOIN LATERAL (
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
  ) recipient ON true` : sql``}
  ${requirements.has("attachmentName") ? sql`LEFT JOIN LATERAL (
    SELECT jsonb_agg(a.filename ORDER BY a.id) AS values
    FROM mail.attachments a
    WHERE a.message_id = mc.id AND a.filename IS NOT NULL
  ) attachment ON true` : sql``}
`;

export const listWorkflowSnapshots = async (params: {
  mailboxId: string;
  query: WorkflowTargetQuery;
  requirements: ReadonlySet<WorkflowSnapshotField>;
  limit: number;
  after?: { internalDate: string; remoteMessageRefId: string } | null;
  db?: SqlClient;
}): Promise<WorkflowTargetSnapshot[]> => {
  const db = params.db ?? sql;
  const predicate = params.query.type === "search" ? compileSearchExpression(params.query.expression) : sql`TRUE`;
  const rows = await db<WorkflowSnapshotRow[]>`
    SELECT ${snapshotColumns(params.requirements)}
    FROM mail.remote_message_refs rmr
    ${snapshotJoins(params.requirements)}
    WHERE resource.mailbox_id = ${params.mailboxId}::uuid
      AND rmr.stale_at IS NULL
      AND mp.deleted_at IS NULL
      AND folder.discovery_state = 'active'
      AND (${predicate})
      AND (
        ${params.after?.internalDate ?? null}::timestamptz IS NULL
        OR (mc.internal_date, rmr.id) < (${params.after?.internalDate ?? null}::timestamptz, ${params.after?.remoteMessageRefId ?? null}::uuid)
      )
    ORDER BY mc.internal_date DESC, rmr.id DESC
    LIMIT ${params.limit}
  `;
  return rows.map((row) => mapSnapshot(row, params.requirements));
};

export const getWorkflowSnapshot = async (params: {
  mailboxId: string;
  remoteMessageRefId: string;
  query: WorkflowTargetQuery;
  requirements: ReadonlySet<WorkflowSnapshotField>;
  db?: SqlClient;
}): Promise<WorkflowTargetSnapshot | null> => {
  const db = params.db ?? sql;
  const predicate = params.query.type === "search" ? compileSearchExpression(params.query.expression) : sql`TRUE`;
  const [row] = await db<WorkflowSnapshotRow[]>`
    SELECT ${snapshotColumns(params.requirements)}
    FROM mail.remote_message_refs rmr
    ${snapshotJoins(params.requirements)}
    WHERE resource.mailbox_id = ${params.mailboxId}::uuid
      AND rmr.id = ${params.remoteMessageRefId}::uuid
      AND rmr.stale_at IS NULL
      AND mp.deleted_at IS NULL
      AND folder.discovery_state = 'active'
      AND (${predicate})
  `;
  return row ? mapSnapshot(row, params.requirements) : null;
};
