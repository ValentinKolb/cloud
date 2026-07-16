import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import {
  type ActorRef,
  type DraftAttachment,
  type DraftContentInput,
  type DraftEditableContentInput,
  type DraftIntent,
  type DraftRecoveryCopy,
  draftContentInputSchema,
  draftEditableContentInputSchema,
  type MailDraft,
} from "../contracts";
import { requireMailboxPermission } from "./access";
import { actorRefFromRequest, type MailRequestContext } from "./auth";
import { sha256Json } from "./canonical";
import type { AttachmentDownload } from "./messages";

type MutableActor = Extract<ActorRef, { kind: "user" | "service_account" }>;

type DbDraft = {
  id: string;
  mailbox_id: string;
  conversation_id: string | null;
  intent: DraftIntent;
  source_message_id: string | null;
  sender_identity_id: string;
  author_kind: MutableActor["kind"];
  author_id: string;
  last_editor_kind: MutableActor["kind"];
  last_editor_id: string;
  to_addresses: MailDraft["to"] | string;
  cc_addresses: MailDraft["cc"] | string;
  bcc_addresses: MailDraft["bcc"] | string;
  subject: string;
  body_markdown: string;
  body_format: MailDraft["format"];
  revision: string | number;
  state: MailDraft["state"];
  attachments: DraftAttachment[] | string;
  recovery_copy_count: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

type DbRecoveryCopy = {
  id: string;
  draft_id: string;
  base_revision: string | number;
  content: DraftEditableContentInput | string;
  creator_kind: MutableActor["kind"];
  creator_id: string;
  created_at: Date | string;
  restored_at: Date | string | null;
  resulting_revision: string | number | null;
};

const draftColumns = sql`
  d.id,
  d.mailbox_id,
  d.conversation_id,
  d.intent,
  d.source_message_id,
  d.sender_identity_id,
  d.author_kind,
  d.author_id,
  d.last_editor_kind,
  d.last_editor_id,
  d.to_addresses,
  d.cc_addresses,
  d.bcc_addresses,
  d.subject,
  d.body_markdown,
  d.body_format,
  d.revision,
  d.state,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', attachment.id,
          'filename', attachment.filename,
          'contentType', attachment.content_type,
          'byteLength', attachment.byte_length,
          'contentHash', attachment.content_hash,
          'position', attachment.position,
          'createdAt', to_char(attachment.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) ORDER BY attachment.position, attachment.id
      )
      FROM mail.draft_attachments attachment
      WHERE attachment.draft_id = d.id AND attachment.removed_at IS NULL
    ),
    '[]'::jsonb
  ) AS attachments,
  (
    SELECT COUNT(*)::int
    FROM mail.draft_recovery_copies recovery
    WHERE recovery.draft_id = d.id AND recovery.restored_at IS NULL
  ) AS recovery_copy_count,
  d.created_at,
  d.updated_at
`;

const recoveryColumns = sql`
  recovery.id,
  recovery.draft_id,
  recovery.base_revision,
  recovery.content,
  recovery.creator_kind,
  recovery.creator_id,
  recovery.created_at,
  recovery.restored_at,
  recovery.resulting_revision
`;

const parseArray = <T>(value: T[] | string): T[] => (typeof value === "string" ? (JSON.parse(value) as T[]) : value);
const parseRecord = <T>(value: T | string): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);
const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();

const mutableActor = (context: MailRequestContext): MutableActor | null => {
  const actor = actorRefFromRequest(context);
  return actor.kind === "user" || actor.kind === "service_account" ? actor : null;
};

const actorId = (actor: MutableActor): string => (actor.kind === "user" ? actor.userId : actor.serviceAccountId);

const actorFromColumns = (kind: MutableActor["kind"], id: string): MutableActor =>
  kind === "user" ? { kind, userId: id } : { kind, serviceAccountId: id, delegatedUserId: null };

const conflict = (message: string): Result<never> => fail({ code: "CONFLICT", message, status: 409 });

const mapDraft = (row: DbDraft): MailDraft => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  conversationId: row.conversation_id,
  intent: row.intent,
  sourceMessageId: row.source_message_id,
  senderIdentityId: row.sender_identity_id,
  to: parseArray(row.to_addresses),
  cc: parseArray(row.cc_addresses),
  bcc: parseArray(row.bcc_addresses),
  subject: row.subject,
  body: row.body_markdown,
  format: row.body_format,
  attachments: parseArray(row.attachments),
  createdBy: actorFromColumns(row.author_kind, row.author_id),
  lastEditedBy: actorFromColumns(row.last_editor_kind, row.last_editor_id),
  recoveryCopyCount: Number(row.recovery_copy_count),
  revision: Number(row.revision),
  state: row.state,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const mapRecoveryCopy = (row: DbRecoveryCopy): DraftRecoveryCopy => ({
  id: row.id,
  draftId: row.draft_id,
  baseRevision: Number(row.base_revision),
  content: parseRecord(row.content),
  createdBy: actorFromColumns(row.creator_kind, row.creator_id),
  createdAt: toIso(row.created_at),
  restoredAt: row.restored_at ? toIso(row.restored_at) : null,
  resultingRevision: row.resulting_revision === null ? null : Number(row.resulting_revision),
});

const validateIdentity = async (params: { mailboxId: string; senderIdentityId: string; db: typeof sql }): Promise<Result<void>> => {
  const [identity] = await params.db<{ id: string }[]>`
    SELECT id
    FROM mail.sender_identities
    WHERE id = ${params.senderIdentityId}::uuid
      AND mailbox_id = ${params.mailboxId}::uuid
      AND status = 'verified'
    FOR SHARE
  `;
  return identity ? ok() : fail(err.badInput("A verified sender identity is required"));
};

const resolveDraftContext = async (params: {
  mailboxId: string;
  input: DraftContentInput;
  db: typeof sql;
}): Promise<Result<{ conversationId: string | null; intent: DraftIntent; sourceMessageId: string | null }>> => {
  const conversationId = params.input.conversationId ?? null;
  const intent = params.input.intent ?? (conversationId ? "reply" : "new");
  if (intent === "new") {
    if (conversationId || params.input.sourceMessageId) {
      return fail(err.badInput("A new-message draft cannot reference a conversation or source message"));
    }
    return ok({ conversationId: null, intent, sourceMessageId: null });
  }
  if (!conversationId) return fail(err.badInput(`${intent} drafts require a conversation`));

  const [source] = await params.db<{ message_id: string }[]>`
    SELECT conversation_message.message_id
    FROM mail.conversation_messages conversation_message
    JOIN mail.conversations conversation ON conversation.id = conversation_message.conversation_id
    JOIN mail.message_contents message ON message.id = conversation_message.message_id
    WHERE conversation_message.conversation_id = ${conversationId}::uuid
      AND conversation.mailbox_id = ${params.mailboxId}::uuid
      AND (${params.input.sourceMessageId ?? null}::uuid IS NULL OR conversation_message.message_id = ${params.input.sourceMessageId ?? null}::uuid)
    ORDER BY conversation_message.position DESC, message.internal_date DESC, message.id DESC
    LIMIT 1
    FOR SHARE OF conversation, message
  `;
  if (!source) return fail(err.badInput("The draft source message does not belong to the selected conversation"));
  return ok({ conversationId, intent, sourceMessageId: source.message_id });
};

const insertActivity = async (params: {
  db: typeof sql;
  mailboxId: string;
  conversationId: string | null;
  actor: MutableActor;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
}): Promise<void> => {
  await params.db`
    INSERT INTO mail.activity_events (
      mailbox_id, conversation_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
    ) VALUES (
      ${params.mailboxId}::uuid,
      ${params.conversationId}::uuid,
      ${params.actor.kind},
      ${actorId(params.actor)}::uuid,
      ${params.action},
      'confirmed',
      ${params.targetType},
      ${params.targetId}::uuid,
      ${params.metadata}::jsonb
    )
  `;
};

const storeRecoveryCopy = async (params: {
  db: typeof sql;
  draftId: string;
  baseRevision: number;
  content: DraftEditableContentInput;
  actor: MutableActor;
}): Promise<void> => {
  const contentHash = sha256Json(params.content);
  await params.db`
    INSERT INTO mail.draft_recovery_copies (
      draft_id, base_revision, content, content_hash, creator_kind, creator_id
    ) VALUES (
      ${params.draftId}::uuid,
      ${params.baseRevision},
      ${params.content}::jsonb,
      ${contentHash},
      ${params.actor.kind},
      ${actorId(params.actor)}::uuid
    )
    ON CONFLICT (draft_id, base_revision, creator_kind, creator_id, content_hash) DO NOTHING
  `;
};

export const createDraft = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: DraftContentInput;
}): Promise<Result<MailDraft>> => {
  const parsed = draftContentInputSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid draft"));
  const actor = mutableActor(params.context);
  if (!actor) return fail(err.forbidden("Draft author is invalid"));
  try {
    return await sql.begin(async (tx) => {
      const [mailbox] = await tx<{ id: string }[]>`
        SELECT id FROM mail.mailboxes
        WHERE id = ${params.mailboxId}::uuid AND deleted_at IS NULL
        FOR SHARE
      `;
      if (!mailbox) return fail(err.notFound("Mailbox"));
      const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write", tx);
      if (!allowed.ok) return allowed;
      const identity = await validateIdentity({ mailboxId: params.mailboxId, senderIdentityId: parsed.data.senderIdentityId, db: tx });
      if (!identity.ok) return identity;
      const draftContext = await resolveDraftContext({ mailboxId: params.mailboxId, input: parsed.data, db: tx });
      if (!draftContext.ok) return draftContext;
      const [row] = await tx<DbDraft[]>`
        INSERT INTO mail.drafts AS d (
          mailbox_id, conversation_id, intent, source_message_id, sender_identity_id,
          author_kind, author_id, last_editor_kind, last_editor_id,
          to_addresses, cc_addresses, bcc_addresses, subject, body_markdown, body_format
        ) VALUES (
          ${params.mailboxId}::uuid,
          ${draftContext.data.conversationId}::uuid,
          ${draftContext.data.intent},
          ${draftContext.data.sourceMessageId}::uuid,
          ${parsed.data.senderIdentityId}::uuid,
          ${actor.kind},
          ${actorId(actor)}::uuid,
          ${actor.kind},
          ${actorId(actor)}::uuid,
          ${parsed.data.to}::jsonb,
          ${parsed.data.cc}::jsonb,
          ${parsed.data.bcc}::jsonb,
          ${parsed.data.subject},
          ${parsed.data.body},
          ${parsed.data.format}
        )
        RETURNING ${draftColumns}
      `;
      if (!row) return fail(err.internal("Draft insert returned no row"));
      await insertActivity({
        db: tx,
        mailboxId: params.mailboxId,
        conversationId: draftContext.data.conversationId,
        actor,
        action: "draft.created",
        targetType: "draft",
        targetId: row.id,
        metadata: { revision: Number(row.revision), intent: draftContext.data.intent, sourceMessageId: draftContext.data.sourceMessageId },
      });
      return ok(mapDraft(row));
    });
  } catch {
    return fail(err.internal("Failed to create draft"));
  }
};

export const updateDraft = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  draftId: string;
  expectedRevision: number;
  input: DraftEditableContentInput;
}): Promise<Result<MailDraft>> => {
  const parsed = draftEditableContentInputSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid draft"));
  if (!Number.isInteger(params.expectedRevision) || params.expectedRevision < 1) return fail(err.badInput("Invalid draft revision"));
  const actor = mutableActor(params.context);
  if (!actor) return fail(err.forbidden("Draft author is invalid"));
  try {
    return await sql.begin(async (tx) => {
      const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write", tx);
      if (!allowed.ok) return allowed;
      const [current] = await tx<{ state: string; revision: string | number }[]>`
        SELECT state, revision
        FROM mail.drafts
        WHERE id = ${params.draftId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!current) return fail(err.notFound("Draft"));
      if (current.state !== "draft") {
        await storeRecoveryCopy({ db: tx, draftId: params.draftId, baseRevision: params.expectedRevision, content: parsed.data, actor });
        return conflict("Draft can no longer be edited; the submitted content was saved as a recovery copy");
      }
      if (Number(current.revision) !== params.expectedRevision) {
        await storeRecoveryCopy({ db: tx, draftId: params.draftId, baseRevision: params.expectedRevision, content: parsed.data, actor });
        return conflict("Draft changed; the submitted content was saved as a recovery copy");
      }
      const identity = await validateIdentity({ mailboxId: params.mailboxId, senderIdentityId: parsed.data.senderIdentityId, db: tx });
      if (!identity.ok) {
        await storeRecoveryCopy({ db: tx, draftId: params.draftId, baseRevision: params.expectedRevision, content: parsed.data, actor });
        return conflict("Sender identity is no longer available; the submitted content was saved as a recovery copy");
      }
      const [row] = await tx<DbDraft[]>`
        UPDATE mail.drafts d
        SET
          sender_identity_id = ${parsed.data.senderIdentityId}::uuid,
          to_addresses = ${parsed.data.to}::jsonb,
          cc_addresses = ${parsed.data.cc}::jsonb,
          bcc_addresses = ${parsed.data.bcc}::jsonb,
          subject = ${parsed.data.subject},
          body_markdown = ${parsed.data.body},
          body_format = ${parsed.data.format},
          last_editor_kind = ${actor.kind},
          last_editor_id = ${actorId(actor)}::uuid,
          revision = revision + 1
        WHERE d.id = ${params.draftId}::uuid
        RETURNING ${draftColumns}
      `;
      return row ? ok(mapDraft(row)) : fail(err.internal("Draft update returned no row"));
    });
  } catch {
    return fail(err.internal("Failed to update draft"));
  }
};

export const listDrafts = async (context: MailRequestContext, mailboxId: string, limit = 100): Promise<Result<MailDraft[]>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<DbDraft[]>`
    SELECT ${draftColumns}
    FROM mail.drafts d
    WHERE d.mailbox_id = ${mailboxId}::uuid AND d.state IN ('draft', 'scheduled', 'sending')
    ORDER BY d.updated_at DESC, d.id DESC
    LIMIT ${Math.min(Math.max(Math.floor(limit), 1), 200)}
  `;
  return ok(rows.map(mapDraft));
};

export const getDraft = async (context: MailRequestContext, mailboxId: string, draftId: string): Promise<Result<MailDraft>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  const [row] = await sql<DbDraft[]>`
    SELECT ${draftColumns}
    FROM mail.drafts d
    WHERE d.id = ${draftId}::uuid AND d.mailbox_id = ${mailboxId}::uuid
  `;
  return row ? ok(mapDraft(row)) : fail(err.notFound("Draft"));
};

export const listDraftRecoveryCopies = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  draftId: string;
}): Promise<Result<DraftRecoveryCopy[]>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<DbRecoveryCopy[]>`
    SELECT ${recoveryColumns}
    FROM mail.draft_recovery_copies recovery
    JOIN mail.drafts draft ON draft.id = recovery.draft_id
    WHERE recovery.draft_id = ${params.draftId}::uuid
      AND draft.mailbox_id = ${params.mailboxId}::uuid
    ORDER BY recovery.created_at DESC, recovery.id DESC
    LIMIT 100
  `;
  return ok(rows.map(mapRecoveryCopy));
};

export const restoreDraftRecoveryCopy = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  draftId: string;
  recoveryCopyId: string;
  expectedRevision: number;
}): Promise<Result<MailDraft>> => {
  if (!Number.isInteger(params.expectedRevision) || params.expectedRevision < 1) return fail(err.badInput("Invalid draft revision"));
  const actor = mutableActor(params.context);
  if (!actor) return fail(err.forbidden("Draft editor is invalid"));
  try {
    return await sql.begin(async (tx) => {
      const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write", tx);
      if (!allowed.ok) return allowed;
      const [draft] = await tx<{ revision: string | number; state: string }[]>`
        SELECT revision, state
        FROM mail.drafts
        WHERE id = ${params.draftId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!draft) return fail(err.notFound("Draft"));
      if (draft.state !== "draft") return fail(err.badInput("Draft can no longer be edited"));
      if (Number(draft.revision) !== params.expectedRevision) return conflict("Draft changed before the recovery copy could be restored");
      const [copy] = await tx<DbRecoveryCopy[]>`
        SELECT ${recoveryColumns}
        FROM mail.draft_recovery_copies recovery
        WHERE recovery.id = ${params.recoveryCopyId}::uuid
          AND recovery.draft_id = ${params.draftId}::uuid
          AND recovery.restored_at IS NULL
        FOR UPDATE
      `;
      if (!copy) return fail(err.notFound("Draft recovery copy"));
      const content = draftEditableContentInputSchema.safeParse(parseRecord(copy.content));
      if (!content.success) return fail(err.internal("Draft recovery copy is invalid"));
      const identity = await validateIdentity({ mailboxId: params.mailboxId, senderIdentityId: content.data.senderIdentityId, db: tx });
      if (!identity.ok) return identity;
      const [updated] = await tx<DbDraft[]>`
        UPDATE mail.drafts d
        SET
          sender_identity_id = ${content.data.senderIdentityId}::uuid,
          to_addresses = ${content.data.to}::jsonb,
          cc_addresses = ${content.data.cc}::jsonb,
          bcc_addresses = ${content.data.bcc}::jsonb,
          subject = ${content.data.subject},
          body_markdown = ${content.data.body},
          body_format = ${content.data.format},
          last_editor_kind = ${actor.kind},
          last_editor_id = ${actorId(actor)}::uuid,
          revision = revision + 1
        WHERE d.id = ${params.draftId}::uuid
        RETURNING ${draftColumns}
      `;
      if (!updated) return fail(err.internal("Draft recovery returned no row"));
      await tx`
        UPDATE mail.draft_recovery_copies
        SET
          restored_at = now(),
          restored_by_kind = ${actor.kind},
          restored_by_id = ${actorId(actor)}::uuid,
          resulting_revision = ${Number(updated.revision)}
        WHERE id = ${copy.id}::uuid
      `;
      await insertActivity({
        db: tx,
        mailboxId: params.mailboxId,
        conversationId: updated.conversation_id,
        actor,
        action: "draft.recovery_restored",
        targetType: "draft",
        targetId: params.draftId,
        metadata: { recoveryCopyId: copy.id, revision: Number(updated.revision) },
      });
      const [refreshed] = await tx<DbDraft[]>`
        SELECT ${draftColumns}
        FROM mail.drafts d
        WHERE d.id = ${params.draftId}::uuid
      `;
      return refreshed ? ok(mapDraft(refreshed)) : fail(err.internal("Restored draft could not be reloaded"));
    });
  } catch {
    return fail(err.internal("Failed to restore draft recovery copy"));
  }
};

export const sanitizeFilename = (value: string): string => {
  const normalized = value
    .normalize("NFC")
    .trim()
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_");
  return [...normalized].slice(0, 255).join("") || "attachment";
};

export const sanitizeContentType = (value: string): string =>
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value) ? value.toLowerCase() : "application/octet-stream";

export const removeDraftAttachment = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  draftId: string;
  attachmentId: string;
  expectedRevision: number;
}): Promise<Result<MailDraft>> => {
  if (!Number.isInteger(params.expectedRevision) || params.expectedRevision < 1) return fail(err.badInput("Invalid draft revision"));
  const actor = mutableActor(params.context);
  if (!actor) return fail(err.forbidden("Draft author is invalid"));
  try {
    return await sql.begin(async (tx) => {
      const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write", tx);
      if (!allowed.ok) return allowed;
      const [draft] = await tx<{ revision: string | number; state: string }[]>`
        SELECT revision, state FROM mail.drafts
        WHERE id = ${params.draftId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!draft) return fail(err.notFound("Draft"));
      if (draft.state !== "draft") return fail(err.badInput("Draft can no longer be edited"));
      if (Number(draft.revision) !== params.expectedRevision) return conflict("Draft changed before the attachment could be removed");
      const [removed] = await tx<{ id: string }[]>`
        UPDATE mail.draft_attachments
        SET removed_at = now()
        WHERE id = ${params.attachmentId}::uuid AND draft_id = ${params.draftId}::uuid AND removed_at IS NULL
        RETURNING id
      `;
      if (!removed) return fail(err.notFound("Draft attachment"));
      const [updated] = await tx<DbDraft[]>`
        UPDATE mail.drafts d
        SET
          revision = revision + 1,
          last_editor_kind = ${actor.kind},
          last_editor_id = ${actorId(actor)}::uuid
        WHERE d.id = ${params.draftId}::uuid
        RETURNING ${draftColumns}
      `;
      if (!updated) return fail(err.internal("Draft attachment removal returned no draft"));
      await insertActivity({
        db: tx,
        mailboxId: params.mailboxId,
        conversationId: updated.conversation_id,
        actor,
        action: "draft.attachment_removed",
        targetType: "draft_attachment",
        targetId: removed.id,
        metadata: { draftId: params.draftId, revision: Number(updated.revision) },
      });
      return ok(mapDraft(updated));
    });
  } catch {
    return fail(err.internal("Failed to remove draft attachment"));
  }
};

export const openDraftAttachment = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  draftId: string;
  attachmentId: string;
}): Promise<Result<AttachmentDownload>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const [attachment] = await sql<
    {
      blob_id: string;
      content_type: string;
      filename: string;
      content_hash: string;
      byte_length: string | number;
      chunk_size: number;
      chunk_count: number;
    }[]
  >`
    SELECT
      attachment.blob_id,
      attachment.content_type,
      attachment.filename,
      blob.content_hash,
      blob.byte_length,
      blob.chunk_size,
      blob.chunk_count
    FROM mail.draft_attachments attachment
    JOIN mail.drafts draft ON draft.id = attachment.draft_id
    JOIN mail.message_part_blobs blob ON blob.id = attachment.blob_id AND blob.complete = true
    WHERE attachment.id = ${params.attachmentId}::uuid
      AND attachment.draft_id = ${params.draftId}::uuid
      AND attachment.removed_at IS NULL
      AND draft.mailbox_id = ${params.mailboxId}::uuid
  `;
  if (!attachment) return fail(err.notFound("Draft attachment"));
  const total = Number(attachment.byte_length);
  if (!Number.isSafeInteger(total) || total < 0 || attachment.chunk_size <= 0 || attachment.chunk_count < 0) {
    return fail(err.internal("Draft attachment metadata is invalid"));
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

export const discardDraft = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  draftId: string;
  expectedRevision: number;
}): Promise<Result<MailDraft>> => {
  if (!Number.isInteger(params.expectedRevision) || params.expectedRevision < 1) return fail(err.badInput("Invalid draft revision"));
  const actor = mutableActor(params.context);
  if (!actor) return fail(err.forbidden("Draft author is invalid"));
  try {
    return await sql.begin(async (tx) => {
      const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write", tx);
      if (!allowed.ok) return allowed;
      const [updated] = await tx<DbDraft[]>`
        UPDATE mail.drafts d
        SET
          state = 'discarded',
          revision = revision + 1,
          last_editor_kind = ${actor.kind},
          last_editor_id = ${actorId(actor)}::uuid
        WHERE d.id = ${params.draftId}::uuid
          AND d.mailbox_id = ${params.mailboxId}::uuid
          AND d.state = 'draft'
          AND d.revision = ${params.expectedRevision}
        RETURNING ${draftColumns}
      `;
      if (!updated) {
        const [current] = await tx<{ revision: string | number; state: string }[]>`
          SELECT revision, state FROM mail.drafts
          WHERE id = ${params.draftId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
        `;
        if (!current) return fail(err.notFound("Draft"));
        if (current.state !== "draft") return fail(err.badInput("Draft can no longer be discarded"));
        return conflict("Draft changed before it could be discarded");
      }
      await insertActivity({
        db: tx,
        mailboxId: params.mailboxId,
        conversationId: updated.conversation_id,
        actor,
        action: "draft.discarded",
        targetType: "draft",
        targetId: params.draftId,
        metadata: { revision: Number(updated.revision) },
      });
      return ok(mapDraft(updated));
    });
  } catch {
    return fail(err.internal("Failed to discard draft"));
  }
};
