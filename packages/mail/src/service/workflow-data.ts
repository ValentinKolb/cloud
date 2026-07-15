import { sql } from "bun";
import type { MailSearchExpression, WorkflowTargetQuery } from "../contracts";
import { sha256Json } from "./canonical";
import { compileSearchExpression } from "./search";

export type SqlClient = typeof sql;

export type FrozenMailAddress = {
  role: "from" | "reply_to" | "to" | "cc" | "bcc";
  name: string | null;
  email: string;
};

export type FrozenMailAttachment = {
  id: string;
  filename: string | null;
  contentType: string;
  disposition: string | null;
  contentId: string | null;
  sizeBytes: number;
};

export type FrozenMailMessage = {
  id: string;
  remoteMessageRefId: string;
  messageId: string;
  conversationId: string | null;
  subject: string;
  body: string;
  bodyText: string;
  bodyHtml: string;
  bodyAvailable: boolean;
  attachmentsAvailable: boolean;
  sender: FrozenMailAddress[];
  recipients: FrozenMailAddress[];
  attachments: FrozenMailAttachment[];
  hasAttachments: boolean;
  folderId: string;
  flags: string[];
  keywords: string[];
  direction: "inbound" | "outbound";
  internalDate: string;
  receivedAt: string;
  sentAt: string | null;
};

export type FrozenMailConversation = {
  id: string;
  subject: string;
  assigneeUserId: string | null;
  status: "open" | "waiting" | "done";
  workStatus: "open" | "waiting" | "done";
  responseNeeded: boolean;
  revision: number;
  latestMessageAt: string;
};

export type FrozenMailWorkflowSource = {
  message: FrozenMailMessage;
  conversation: FrozenMailConversation | null;
};

export type FrozenMailWorkflowPreconditions = {
  sourceHash: string;
  remoteState: {
    modseq: string | null;
    flags: string[];
    keywords: string[];
  };
  conversation: { id: string; revision: number } | null;
};

export type MailWorkflowTargetSnapshot = {
  targetKey: string;
  source: FrozenMailWorkflowSource;
  preconditions: FrozenMailWorkflowPreconditions;
  internalDate: string;
};

type WorkflowSnapshotRow = {
  remote_message_ref_id: string;
  message_id: string;
  conversation_id: string | null;
  subject: string;
  plain_text: string | null;
  sanitized_html: string | null;
  hydration_status: string;
  sender: FrozenMailAddress[] | string;
  recipients: FrozenMailAddress[] | string;
  attachments: FrozenMailAttachment[] | string;
  internal_date: Date | string;
  sent_at: Date | string | null;
  folder_id: string;
  modseq: string | number | null;
  flags: string[] | null;
  keywords: string[] | null;
  direction: "inbound" | "outbound";
  conversation_subject: string | null;
  collaboration_revision: string | number | null;
  assignee_user_id: string | null;
  work_status: "open" | "waiting" | "done" | null;
  response_needed: boolean | null;
  latest_message_at: Date | string | null;
};

const parseJson = <T>(value: T | string): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);
const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();

const standardFlagNames: Record<string, string> = {
  "\\answered": "answered",
  "\\draft": "draft",
  "\\flagged": "flagged",
  "\\seen": "seen",
};

export const normalizeWorkflowFlags = (flags: readonly string[]): string[] =>
  flags.map((flag) => standardFlagNames[flag.toLowerCase()] ?? flag).sort();

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

const snapshotColumns = sql`
  rmr.id AS remote_message_ref_id,
  mc.id AS message_id,
  cm.conversation_id,
  mc.subject,
  mc.plain_text,
  mc.sanitized_html,
  mc.hydration_status,
  COALESCE(sender.value, '[]'::jsonb) AS sender,
  COALESCE(recipient.value, '[]'::jsonb) AS recipients,
  COALESCE(attachment.value, '[]'::jsonb) AS attachments,
  mc.internal_date,
  mc.sent_at,
  mp.folder_id,
  rmr.modseq,
  mp.flags,
  mp.keywords,
  CASE WHEN EXISTS (
    SELECT 1
    FROM mail.message_addresses from_address
    JOIN mail.sender_identities identity
      ON identity.mailbox_id = mc.mailbox_id
     AND lower(identity.from_address) = from_address.normalized_email
     AND identity.status <> 'disabled'
    WHERE from_address.message_id = mc.id AND from_address.role = 'from'
  ) THEN 'outbound' ELSE 'inbound' END AS direction,
  conversation.subject AS conversation_subject,
  conversation.revision AS collaboration_revision,
  conversation.assignee_user_id,
  conversation.work_status,
  conversation.response_needed,
  conversation.latest_message_at
`;

const snapshotJoins = sql`
  JOIN mail.message_placements mp ON mp.remote_message_ref_id = rmr.id
  JOIN mail.message_contents mc ON mc.id = rmr.message_id
  JOIN mail.folders folder ON folder.id = rmr.folder_id
  JOIN mail.remote_resources resource ON resource.id = folder.remote_resource_id
  LEFT JOIN mail.conversation_messages cm ON cm.message_id = mc.id
  LEFT JOIN mail.conversations conversation ON conversation.id = cm.conversation_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'role', address.role,
      'name', address.display_name,
      'email', address.email
    ) ORDER BY address.role, address.position) AS value
    FROM mail.message_addresses address
    WHERE address.message_id = mc.id AND address.role IN ('from', 'reply_to')
  ) sender ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'role', address.role,
      'name', address.display_name,
      'email', address.email
    ) ORDER BY address.role, address.position) AS value
    FROM mail.message_addresses address
    WHERE address.message_id = mc.id AND address.role IN ('to', 'cc', 'bcc')
  ) recipient ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id', item.id,
      'filename', item.filename,
      'contentType', item.content_type,
      'disposition', item.disposition,
      'contentId', item.content_id,
      'sizeBytes', item.size_bytes
    ) ORDER BY item.id) AS value
    FROM mail.attachments item
    WHERE item.message_id = mc.id
  ) attachment ON true
`;

const mapSnapshot = (row: WorkflowSnapshotRow): MailWorkflowTargetSnapshot => {
  const internalDate = toIso(row.internal_date);
  const flags = normalizeWorkflowFlags(row.flags ?? []);
  const keywords = [...(row.keywords ?? [])].sort();
  const attachments = parseJson(row.attachments);
  const conversation =
    row.conversation_id && row.collaboration_revision != null && row.work_status && row.response_needed != null && row.latest_message_at
      ? {
          id: row.conversation_id,
          subject: row.conversation_subject ?? "",
          assigneeUserId: row.assignee_user_id,
          status: row.work_status,
          workStatus: row.work_status,
          responseNeeded: row.response_needed,
          revision: Number(row.collaboration_revision),
          latestMessageAt: toIso(row.latest_message_at),
        }
      : null;
  const source: FrozenMailWorkflowSource = {
    message: {
      id: row.message_id,
      remoteMessageRefId: row.remote_message_ref_id,
      messageId: row.message_id,
      conversationId: row.conversation_id,
      subject: row.subject,
      body: row.plain_text ?? "",
      bodyText: row.plain_text ?? "",
      bodyHtml: row.sanitized_html ?? "",
      bodyAvailable: row.hydration_status === "body" || row.hydration_status === "complete",
      attachmentsAvailable: row.hydration_status === "complete",
      sender: parseJson(row.sender),
      recipients: parseJson(row.recipients),
      attachments,
      hasAttachments: attachments.length > 0,
      folderId: row.folder_id,
      flags,
      keywords,
      direction: row.direction,
      internalDate,
      receivedAt: internalDate,
      sentAt: row.sent_at ? toIso(row.sent_at) : null,
    },
    conversation,
  };
  return {
    targetKey: row.remote_message_ref_id,
    source,
    preconditions: {
      sourceHash: sha256Json(source),
      remoteState: {
        modseq: row.modseq == null ? null : String(row.modseq),
        flags: flags.filter((flag) => ["seen", "answered", "flagged", "draft"].includes(flag)),
        keywords,
      },
      conversation: conversation ? { id: conversation.id, revision: conversation.revision } : null,
    },
    internalDate,
  };
};

export const listWorkflowSnapshots = async (params: {
  mailboxId: string;
  query: WorkflowTargetQuery;
  limit: number;
  after?: { internalDate: string; remoteMessageRefId: string } | null;
  db?: SqlClient;
}): Promise<MailWorkflowTargetSnapshot[]> => {
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
      AND (
        ${params.after?.internalDate ?? null}::timestamptz IS NULL
        OR (mc.internal_date, rmr.id) < (${params.after?.internalDate ?? null}::timestamptz, ${params.after?.remoteMessageRefId ?? null}::uuid)
      )
    ORDER BY mc.internal_date DESC, rmr.id DESC
    LIMIT ${params.limit}
  `;
  return rows.map(mapSnapshot);
};

export const getWorkflowSnapshot = async (params: {
  mailboxId: string;
  remoteMessageRefId: string;
  query: WorkflowTargetQuery;
  db?: SqlClient;
}): Promise<MailWorkflowTargetSnapshot | null> => {
  const db = params.db ?? sql;
  const predicate = params.query.type === "search" ? compileSearchExpression(params.query.expression) : sql`TRUE`;
  const [row] = await db<WorkflowSnapshotRow[]>`
    SELECT ${snapshotColumns}
    FROM mail.remote_message_refs rmr
    ${snapshotJoins}
    WHERE resource.mailbox_id = ${params.mailboxId}::uuid
      AND rmr.id = ${params.remoteMessageRefId}::uuid
      AND rmr.stale_at IS NULL
      AND mp.deleted_at IS NULL
      AND folder.discovery_state = 'active'
      AND (${predicate})
  `;
  return row ? mapSnapshot(row) : null;
};
