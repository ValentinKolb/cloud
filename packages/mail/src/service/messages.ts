import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { ConversationView, ConversationWorkStatus } from "../contracts";
import { type MailRequestContext, userBackedActor } from "./auth";
import { resolveMailExecution } from "./execution";

type DateCursor = { version: 1; date: string; id: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const encodeCursor = (cursor: DateCursor): string => Buffer.from(JSON.stringify(cursor)).toString("base64url");

const decodeCursor = (value: string | undefined): Result<DateCursor | null> => {
  if (!value) return ok(null);
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<DateCursor>;
    if (
      parsed.version !== 1 ||
      typeof parsed.date !== "string" ||
      !Number.isFinite(Date.parse(parsed.date)) ||
      typeof parsed.id !== "string" ||
      !UUID_PATTERN.test(parsed.id)
    ) {
      return fail(err.badInput("Invalid pagination cursor"));
    }
    return ok(parsed as DateCursor);
  } catch {
    return fail(err.badInput("Invalid pagination cursor"));
  }
};

const parseJsonArray = <T>(value: T[] | string): T[] => (typeof value === "string" ? (JSON.parse(value) as T[]) : value);
const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();

export type MailFolderView = {
  id: string;
  parentId: string | null;
  name: string;
  role: string;
  providerRole: string;
  configuredRole: string | null;
  selectable: boolean;
  namespaceKinds: Array<"personal" | "other_users" | "shared">;
  discoveryState: "active" | "missing" | "ambiguous";
  missingSince: string | null;
  syncStatus: string;
  total: number;
  unread: number;
};

export const listFolders = async (context: MailRequestContext, mailboxId: string): Promise<Result<MailFolderView[]>> => {
  const access = await resolveMailExecution({ mailboxId, operation: "actorRead", context });
  if (!access.ok) return access;
  const rows = await sql<
    {
      id: string;
      parent_id: string | null;
      name: string;
      role: string;
      provider_role: string;
      configured_role: string | null;
      selectable: boolean;
      namespace_kinds: MailFolderView["namespaceKinds"];
      discovery_state: MailFolderView["discoveryState"];
      missing_since: Date | string | null;
      sync_status: string;
      total: number;
      unread: number;
    }[]
  >`
    SELECT
      f.id,
      f.parent_id,
      f.name,
      COALESCE(role_override.role, f.role) AS role,
      f.role AS provider_role,
      role_override.role AS configured_role,
      f.selectable,
      ARRAY(
        SELECT DISTINCT ref.namespace_kind
        FROM mail.binding_folder_refs ref
        WHERE ref.folder_id = f.id AND ref.missing_since IS NULL AND ref.namespace_kind IS NOT NULL
        ORDER BY ref.namespace_kind
      ) AS namespace_kinds,
      f.discovery_state,
      f.missing_since,
      f.sync_status,
      COUNT(mp.remote_message_ref_id) FILTER (WHERE mp.deleted_at IS NULL)::int AS total,
      COUNT(mp.remote_message_ref_id) FILTER (
        WHERE mp.deleted_at IS NULL AND NOT ('\\Seen' = ANY(mp.flags))
      )::int AS unread
    FROM mail.folders f
    JOIN mail.remote_resources rr ON rr.id = f.remote_resource_id
    LEFT JOIN mail.folder_role_overrides role_override
      ON role_override.mailbox_id = rr.mailbox_id
     AND role_override.folder_id = f.id
    LEFT JOIN mail.message_placements mp ON mp.folder_id = f.id
    WHERE rr.mailbox_id = ${mailboxId}::uuid
    GROUP BY f.id, role_override.role
    ORDER BY
      CASE f.role
        WHEN 'inbox' THEN 0
        WHEN 'drafts' THEN 1
        WHEN 'sent' THEN 2
        WHEN 'archive' THEN 3
        WHEN 'trash' THEN 4
        WHEN 'junk' THEN 5
        ELSE 6
      END,
      f.name,
      f.id
  `;
  return ok(
    rows.map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      role: row.role,
      providerRole: row.provider_role,
      configuredRole: row.configured_role,
      selectable: row.selectable,
      namespaceKinds: row.namespace_kinds,
      discoveryState: row.discovery_state,
      missingSince: row.missing_since ? toIso(row.missing_since) : null,
      syncStatus: row.sync_status,
      total: row.total,
      unread: row.unread,
    })),
  );
};

export type ConversationSummary = {
  id: string;
  subject: string;
  participantSummary: string;
  latestMessageAt: string;
  workStatus: "open" | "waiting" | "done";
  assigneeUserId: string | null;
  responseNeeded: boolean;
  snoozedUntil: string | null;
  revision: number;
  updatedAt: string;
  unread: boolean;
  messageCount: number;
  preview: string | null;
};

type DbConversation = {
  id: string;
  subject: string;
  participant_summary: string;
  latest_message_at: Date | string;
  work_status: ConversationSummary["workStatus"];
  assignee_user_id: string | null;
  response_needed: boolean;
  snoozed_until: Date | string | null;
  revision: string | number;
  updated_at: Date | string;
  sort_date: Date | string;
  unread: boolean;
  message_count: number;
  preview: string | null;
};

export const listConversations = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  folderId?: string | null;
  status?: ConversationWorkStatus | null;
  view?: ConversationView | null;
  cursor?: string;
  limit?: number;
}): Promise<Result<{ items: ConversationSummary[]; nextCursor: string | null }>> => {
  const access = await resolveMailExecution({ mailboxId: params.mailboxId, operation: "actorRead", context: params.context });
  if (!access.ok) return access;
  const cursor = decodeCursor(params.cursor);
  if (!cursor.ok) return cursor;
  const limit = Math.min(Math.max(Math.floor(params.limit ?? 50), 1), 100);
  const currentUserId = userBackedActor(params.context)?.id ?? null;
  const view = params.view ?? null;
  const rows = await sql<DbConversation[]>`
    SELECT
      c.id,
      c.subject,
      c.participant_summary,
      c.latest_message_at,
      c.work_status,
      c.assignee_user_id,
      c.response_needed,
      c.snoozed_until,
      c.revision,
      c.updated_at,
      CASE WHEN ${view}::text = 'recently_active' THEN c.updated_at ELSE c.latest_message_at END AS sort_date,
      EXISTS (
        SELECT 1
        FROM mail.conversation_messages unread_cm
        JOIN mail.message_placements unread_mp ON unread_mp.message_id = unread_cm.message_id
        WHERE unread_cm.conversation_id = c.id
          AND unread_mp.deleted_at IS NULL
          AND NOT ('\\Seen' = ANY(unread_mp.flags))
      ) AS unread,
      (
        SELECT COUNT(*)::int FROM mail.conversation_messages count_cm WHERE count_cm.conversation_id = c.id
      ) AS message_count,
      latest.preview
    FROM mail.conversations c
    LEFT JOIN LATERAL (
      SELECT LEFT(COALESCE(mc.plain_text, ''), 320) AS preview
      FROM mail.conversation_messages cm
      JOIN mail.message_contents mc ON mc.id = cm.message_id
      WHERE cm.conversation_id = c.id
      ORDER BY mc.internal_date DESC, mc.id DESC
      LIMIT 1
    ) latest ON true
    WHERE c.mailbox_id = ${params.mailboxId}::uuid
      AND (${params.status ?? null}::text IS NULL OR c.work_status = ${params.status ?? null})
      AND (
        ${view}::text IS NULL
        OR (${view} = 'inbox' AND c.work_status = 'open' AND (c.snoozed_until IS NULL OR c.snoozed_until <= now()))
        OR (
          ${view} = 'mine'
          AND c.assignee_user_id = ${currentUserId}::uuid
          AND c.work_status <> 'done'
          AND (c.snoozed_until IS NULL OR c.snoozed_until <= now())
        )
        OR (
          ${view} = 'unassigned'
          AND c.assignee_user_id IS NULL
          AND c.work_status <> 'done'
          AND (c.snoozed_until IS NULL OR c.snoozed_until <= now())
        )
        OR (${view} = 'waiting' AND c.work_status = 'waiting' AND (c.snoozed_until IS NULL OR c.snoozed_until <= now()))
        OR (${view} = 'done' AND c.work_status = 'done')
        OR (${view} = 'snoozed' AND c.snoozed_until > now())
        OR ${view} = 'recently_active'
      )
      AND (
        ${params.folderId ?? null}::uuid IS NULL
        OR EXISTS (
          SELECT 1
          FROM mail.conversation_messages folder_cm
          JOIN mail.message_placements folder_mp ON folder_mp.message_id = folder_cm.message_id
          WHERE folder_cm.conversation_id = c.id
            AND folder_mp.folder_id = ${params.folderId ?? null}::uuid
            AND folder_mp.deleted_at IS NULL
        )
      )
      AND EXISTS (
        SELECT 1
        FROM mail.conversation_messages visible_cm
        JOIN mail.message_placements visible_mp ON visible_mp.message_id = visible_cm.message_id
        WHERE visible_cm.conversation_id = c.id AND visible_mp.deleted_at IS NULL
      )
      AND (
        ${cursor.data?.id ?? null}::uuid IS NULL
        OR (
          CASE WHEN ${view}::text = 'recently_active' THEN c.updated_at ELSE c.latest_message_at END,
          c.id
        ) < (${cursor.data?.date ?? null}::timestamptz, ${cursor.data?.id ?? null}::uuid)
      )
    ORDER BY sort_date DESC, c.id DESC
    LIMIT ${limit + 1}
  `;
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map((row) => ({
    id: row.id,
    subject: row.subject,
    participantSummary: row.participant_summary,
    latestMessageAt: toIso(row.latest_message_at),
    workStatus: row.work_status,
    assigneeUserId: row.assignee_user_id,
    responseNeeded: row.response_needed,
    snoozedUntil: row.snoozed_until ? toIso(row.snoozed_until) : null,
    revision: Number(row.revision),
    updatedAt: toIso(row.updated_at),
    unread: row.unread,
    messageCount: row.message_count,
    preview: row.preview || null,
  }));
  const last = items.at(-1);
  const lastRow = pageRows.at(-1);
  return ok({
    items,
    nextCursor: hasMore && last && lastRow ? encodeCursor({ version: 1, date: toIso(lastRow.sort_date), id: last.id }) : null,
  });
};

export type ConversationViewCounts = Record<ConversationView, number>;

export const getConversationViewCounts = async (params: {
  context: MailRequestContext;
  mailboxId: string;
}): Promise<Result<ConversationViewCounts>> => {
  const access = await resolveMailExecution({ mailboxId: params.mailboxId, operation: "actorRead", context: params.context });
  if (!access.ok) return access;
  const currentUserId = userBackedActor(params.context)?.id ?? null;
  const [row] = await sql<
    {
      inbox: number;
      mine: number;
      unassigned: number;
      waiting: number;
      done: number;
      snoozed: number;
      recently_active: number;
    }[]
  >`
    SELECT
      COUNT(*) FILTER (
        WHERE c.work_status = 'open' AND (c.snoozed_until IS NULL OR c.snoozed_until <= now())
      )::int AS inbox,
      COUNT(*) FILTER (
        WHERE c.assignee_user_id = ${currentUserId}::uuid
          AND c.work_status <> 'done'
          AND (c.snoozed_until IS NULL OR c.snoozed_until <= now())
      )::int AS mine,
      COUNT(*) FILTER (
        WHERE c.assignee_user_id IS NULL
          AND c.work_status <> 'done'
          AND (c.snoozed_until IS NULL OR c.snoozed_until <= now())
      )::int AS unassigned,
      COUNT(*) FILTER (
        WHERE c.work_status = 'waiting' AND (c.snoozed_until IS NULL OR c.snoozed_until <= now())
      )::int AS waiting,
      COUNT(*) FILTER (WHERE c.work_status = 'done')::int AS done,
      COUNT(*) FILTER (WHERE c.snoozed_until > now())::int AS snoozed,
      COUNT(*)::int AS recently_active
    FROM mail.conversations c
    WHERE c.mailbox_id = ${params.mailboxId}::uuid
      AND EXISTS (
        SELECT 1
        FROM mail.conversation_messages visible_cm
        JOIN mail.message_placements visible_mp ON visible_mp.message_id = visible_cm.message_id
        WHERE visible_cm.conversation_id = c.id AND visible_mp.deleted_at IS NULL
      )
  `;
  return ok({
    inbox: row?.inbox ?? 0,
    mine: row?.mine ?? 0,
    unassigned: row?.unassigned ?? 0,
    waiting: row?.waiting ?? 0,
    done: row?.done ?? 0,
    snoozed: row?.snoozed ?? 0,
    recently_active: row?.recently_active ?? 0,
  });
};

export type MessageSummary = {
  id: string;
  subject: string;
  messageId: string | null;
  internalDate: string;
  sentAt: string | null;
  from: Array<{ name: string | null; address: string }>;
  to: Array<{ name: string | null; address: string }>;
  flags: string[];
  hydrationStatus: string;
  remoteAvailable: boolean;
  remoteMessageRefId: string | null;
  folderId: string | null;
};

type DbMessageSummary = {
  id: string;
  subject: string;
  message_id: string | null;
  internal_date: Date | string;
  sent_at: Date | string | null;
  from_addresses: Array<{ name: string | null; address: string }> | string;
  to_addresses: Array<{ name: string | null; address: string }> | string;
  flags: string[] | null;
  hydration_status: string;
  remote_available: boolean;
  remote_message_ref_id: string | null;
  folder_id: string | null;
};

const mapMessageSummary = (row: DbMessageSummary): MessageSummary => ({
  id: row.id,
  subject: row.subject,
  messageId: row.message_id,
  internalDate: toIso(row.internal_date),
  sentAt: row.sent_at ? toIso(row.sent_at) : null,
  from: parseJsonArray(row.from_addresses),
  to: parseJsonArray(row.to_addresses),
  flags: row.flags ?? [],
  hydrationStatus: row.hydration_status,
  remoteAvailable: row.remote_available,
  remoteMessageRefId: row.remote_message_ref_id,
  folderId: row.folder_id,
});

const messageSummarySelect = sql`
  mc.id,
  mc.subject,
  mc.message_id,
  mc.internal_date,
  mc.sent_at,
  COALESCE(from_rows.addresses, '[]'::jsonb) AS from_addresses,
  COALESCE(to_rows.addresses, '[]'::jsonb) AS to_addresses,
  COALESCE(placement.flags, ARRAY[]::text[]) AS flags,
  mc.hydration_status,
  placement.remote_message_ref_id,
  placement.folder_id,
  EXISTS (
    SELECT 1 FROM mail.message_placements available
    WHERE available.message_id = mc.id AND available.deleted_at IS NULL
  ) AS remote_available
`;

const messageSummaryJoins = sql`
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('name', ma.display_name, 'address', ma.email) ORDER BY ma.position) AS addresses
    FROM mail.message_addresses ma
    WHERE ma.message_id = mc.id AND ma.role = 'from'
  ) from_rows ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('name', ma.display_name, 'address', ma.email) ORDER BY ma.position) AS addresses
    FROM mail.message_addresses ma
    WHERE ma.message_id = mc.id AND ma.role = 'to'
  ) to_rows ON true
  LEFT JOIN LATERAL (
    SELECT mp.flags, mp.remote_message_ref_id, mp.folder_id
    FROM mail.message_placements mp
    WHERE mp.message_id = mc.id AND mp.deleted_at IS NULL
    ORDER BY mp.updated_at DESC
    LIMIT 1
  ) placement ON true
`;

export const listConversationMessages = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  cursor?: string;
  limit?: number;
}): Promise<Result<{ items: MessageSummary[]; nextCursor: string | null }>> => {
  const access = await resolveMailExecution({ mailboxId: params.mailboxId, operation: "actorRead", context: params.context });
  if (!access.ok) return access;
  const cursor = decodeCursor(params.cursor);
  if (!cursor.ok) return cursor;
  const limit = Math.min(Math.max(Math.floor(params.limit ?? 50), 1), 100);
  const [conversation] = await sql<{ id: string }[]>`
    SELECT id FROM mail.conversations WHERE id = ${params.conversationId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
  `;
  if (!conversation) return fail(err.notFound("Conversation"));
  const rows = await sql<DbMessageSummary[]>`
    SELECT ${messageSummarySelect}
    FROM mail.conversation_messages cm
    JOIN mail.message_contents mc ON mc.id = cm.message_id
    ${messageSummaryJoins}
    WHERE cm.conversation_id = ${params.conversationId}::uuid
      AND (${cursor.data?.id ?? null}::uuid IS NULL OR (mc.internal_date, mc.id) > (${cursor.data?.date ?? null}::timestamptz, ${cursor.data?.id ?? null}::uuid))
    ORDER BY mc.internal_date, mc.id
    LIMIT ${limit + 1}
  `;
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map(mapMessageSummary);
  const last = items.at(-1);
  return ok({
    items,
    nextCursor: hasMore && last ? encodeCursor({ version: 1, date: last.internalDate, id: last.id }) : null,
  });
};

export type MessageDetail = MessageSummary & {
  plainText: string | null;
  sanitizedHtml: string | null;
  selectedHeaders: Record<string, unknown>;
  attachments: Array<{
    id: string;
    filename: string | null;
    contentType: string;
    sizeBytes: number;
    contentId: string | null;
  }>;
};

export const getMessage = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  messageId: string;
}): Promise<Result<MessageDetail>> => {
  const access = await resolveMailExecution({ mailboxId: params.mailboxId, operation: "actorRead", context: params.context });
  if (!access.ok) return access;
  const [row] = await sql<
    (DbMessageSummary & {
      plain_text: string | null;
      sanitized_html: string | null;
      selected_headers: Record<string, unknown> | string;
      attachments:
        | Array<{ id: string; filename: string | null; contentType: string; sizeBytes: number; contentId: string | null }>
        | string;
    })[]
  >`
    SELECT
      ${messageSummarySelect},
      mc.plain_text,
      mc.sanitized_html,
      mc.selected_headers,
      COALESCE(attachment_rows.items, '[]'::jsonb) AS attachments
    FROM mail.message_contents mc
    ${messageSummaryJoins}
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'filename', a.filename,
          'contentType', a.content_type,
          'sizeBytes', a.size_bytes,
          'contentId', a.content_id
        ) ORDER BY a.id
      ) AS items
      FROM mail.attachments a
      WHERE a.message_id = mc.id
    ) attachment_rows ON true
    WHERE mc.id = ${params.messageId}::uuid AND mc.mailbox_id = ${params.mailboxId}::uuid
  `;
  if (!row) return fail(err.notFound("Message"));
  const summary = mapMessageSummary(row);
  return ok({
    ...summary,
    plainText: row.plain_text,
    sanitizedHtml: row.sanitized_html,
    selectedHeaders:
      typeof row.selected_headers === "string" ? (JSON.parse(row.selected_headers) as Record<string, unknown>) : row.selected_headers,
    attachments: parseJsonArray(row.attachments),
  });
};

export type AttachmentDownload = {
  blobId: string;
  total: number;
  chunkSize: number;
  chunkCount: number;
  contentHash: string;
  contentType: string;
  filename: string | null;
};

export const openAttachment = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  messageId: string;
  attachmentId: string;
}): Promise<Result<AttachmentDownload>> => {
  const access = await resolveMailExecution({ mailboxId: params.mailboxId, operation: "actorRead", context: params.context });
  if (!access.ok) return access;
  const [attachment] = await sql<
    {
      blob_id: string;
      content_type: string;
      filename: string | null;
      content_hash: string;
      byte_length: string | number;
      chunk_size: number;
      chunk_count: number;
    }[]
  >`
    SELECT
      a.blob_id,
      a.content_type,
      a.filename,
      blob.content_hash,
      blob.byte_length,
      blob.chunk_size,
      blob.chunk_count
    FROM mail.attachments a
    JOIN mail.message_contents mc ON mc.id = a.message_id
    JOIN mail.message_part_blobs blob ON blob.id = a.blob_id AND blob.complete = true
    WHERE a.id = ${params.attachmentId}::uuid
      AND a.message_id = ${params.messageId}::uuid
      AND mc.mailbox_id = ${params.mailboxId}::uuid
  `;
  if (!attachment) return fail(err.notFound("Attachment"));
  const total = Number(attachment.byte_length);
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isSafeInteger(attachment.chunk_size) ||
    attachment.chunk_size <= 0 ||
    !Number.isSafeInteger(attachment.chunk_count) ||
    attachment.chunk_count < 0 ||
    (total === 0 ? attachment.chunk_count !== 0 : attachment.chunk_count === 0)
  ) {
    return fail(err.internal("Attachment metadata is invalid"));
  }
  return ok({
    blobId: attachment.blob_id,
    total,
    chunkSize: attachment.chunk_size,
    chunkCount: attachment.chunk_count,
    contentHash: attachment.content_hash,
    contentType: attachment.content_type,
    filename: attachment.filename,
  });
};

export const createAttachmentStream = (params: {
  blobId: string;
  chunkSize: number;
  chunkCount: number;
  start: number;
  endExclusive: number;
}): ReadableStream<Uint8Array> => {
  const firstPosition = Math.floor(params.start / params.chunkSize);
  const lastPosition = params.endExclusive > params.start ? Math.floor((params.endExclusive - 1) / params.chunkSize) : firstPosition - 1;
  let nextPosition = firstPosition;
  let buffered: Array<{ position: number; bytes: Uint8Array }> = [];
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled) return;
      if (nextPosition > lastPosition) {
        controller.close();
        return;
      }
      if (buffered.length === 0) {
        const batchEnd = Math.min(lastPosition, nextPosition + 7);
        buffered = await sql<{ position: number; bytes: Uint8Array }[]>`
          SELECT position, bytes
          FROM mail.message_part_chunks
          WHERE blob_id = ${params.blobId}::uuid
            AND position BETWEEN ${nextPosition} AND ${batchEnd}
          ORDER BY position
        `;
      }
      const chunk = buffered.shift();
      if (!chunk || chunk.position !== nextPosition || chunk.position >= params.chunkCount) {
        controller.error(new Error("Attachment blob is incomplete"));
        return;
      }
      const chunkStart = chunk.position * params.chunkSize;
      const startInChunk = Math.max(0, params.start - chunkStart);
      const endInChunk = Math.min(chunk.bytes.byteLength, params.endExclusive - chunkStart);
      const bytes = chunk.bytes.subarray(startInChunk, endInChunk);
      nextPosition += 1;
      controller.enqueue(bytes);
    },
    cancel() {
      cancelled = true;
      buffered = [];
    },
  });
};
