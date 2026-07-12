import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { type DraftAttachment, type DraftContentInput, draftContentInputSchema, type MailDraft } from "../contracts";
import { requireMailboxPermission } from "./access";
import { actorRefFromRequest, type MailRequestContext } from "./auth";
import { storeReadableBlob } from "./message-blobs";
import type { Readable } from "node:stream";

type DbDraft = {
  id: string;
  mailbox_id: string;
  conversation_id: string | null;
  sender_identity_id: string;
  to_addresses: MailDraft["to"] | string;
  cc_addresses: MailDraft["cc"] | string;
  bcc_addresses: MailDraft["bcc"] | string;
  subject: string;
  body_markdown: string;
  body_format: MailDraft["format"];
  revision: string | number;
  state: MailDraft["state"];
  attachments: DraftAttachment[] | string;
  created_at: Date | string;
  updated_at: Date | string;
};

const draftColumns = sql`
  d.id,
  d.mailbox_id,
  d.conversation_id,
  d.sender_identity_id,
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
  d.created_at,
  d.updated_at
`;

const parseArray = <T>(value: T[] | string): T[] => (typeof value === "string" ? (JSON.parse(value) as T[]) : value);

const mapDraft = (row: DbDraft): MailDraft => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  conversationId: row.conversation_id,
  senderIdentityId: row.sender_identity_id,
  to: parseArray(row.to_addresses),
  cc: parseArray(row.cc_addresses),
  bcc: parseArray(row.bcc_addresses),
  subject: row.subject,
  body: row.body_markdown,
  format: row.body_format,
  attachments: parseArray(row.attachments),
  revision: Number(row.revision),
  state: row.state,
  createdAt: (row.created_at instanceof Date ? row.created_at : new Date(row.created_at)).toISOString(),
  updatedAt: (row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)).toISOString(),
});

const validateIdentityAndConversation = async (params: {
  mailboxId: string;
  senderIdentityId: string;
  conversationId?: string | null;
  db: typeof sql;
}): Promise<Result<void>> => {
  const [identity] = await params.db<{ id: string }[]>`
    SELECT id
    FROM mail.sender_identities
    WHERE id = ${params.senderIdentityId}::uuid
      AND mailbox_id = ${params.mailboxId}::uuid
      AND status = 'verified'
    FOR SHARE
  `;
  if (!identity) return fail(err.badInput("A verified sender identity is required"));
  if (params.conversationId) {
    const [conversation] = await params.db<{ id: string }[]>`
      SELECT id FROM mail.conversations
      WHERE id = ${params.conversationId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
      FOR SHARE
    `;
    if (!conversation) return fail(err.notFound("Conversation"));
  }
  return ok();
};

export const createDraft = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: DraftContentInput;
}): Promise<Result<MailDraft>> => {
  const parsed = draftContentInputSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid draft"));
  const actor = actorRefFromRequest(params.context);
  if (actor.kind !== "user" && actor.kind !== "service_account") return fail(err.forbidden("Draft author is invalid"));
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
      const targets = await validateIdentityAndConversation({
        mailboxId: params.mailboxId,
        senderIdentityId: parsed.data.senderIdentityId,
        conversationId: parsed.data.conversationId,
        db: tx,
      });
      if (!targets.ok) return targets;
      const [row] = await tx<DbDraft[]>`
        INSERT INTO mail.drafts AS d (
          mailbox_id,
          conversation_id,
          sender_identity_id,
          author_kind,
          author_id,
          to_addresses,
          cc_addresses,
          bcc_addresses,
          subject,
          body_markdown,
          body_format
        )
        VALUES (
          ${params.mailboxId}::uuid,
          ${parsed.data.conversationId ?? null}::uuid,
          ${parsed.data.senderIdentityId}::uuid,
          ${actor.kind},
          ${actor.kind === "user" ? actor.userId : actor.serviceAccountId}::uuid,
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
      await tx`
        INSERT INTO mail.activity_events (
          mailbox_id, conversation_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
        ) VALUES (
          ${params.mailboxId}::uuid,
          ${parsed.data.conversationId ?? null}::uuid,
          ${actor.kind},
          ${actor.kind === "user" ? actor.userId : actor.serviceAccountId}::uuid,
          'draft.created',
          'confirmed',
          'draft',
          ${row.id}::uuid,
          ${{ revision: Number(row.revision) }}::jsonb
        )
      `;
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
  input: DraftContentInput;
}): Promise<Result<MailDraft>> => {
  const parsed = draftContentInputSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid draft"));
  if (!Number.isInteger(params.expectedRevision) || params.expectedRevision < 1) return fail(err.badInput("Invalid draft revision"));
  const actor = actorRefFromRequest(params.context);
  if (actor.kind !== "user" && actor.kind !== "service_account") return fail(err.forbidden("Draft author is invalid"));
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
      const targets = await validateIdentityAndConversation({
        mailboxId: params.mailboxId,
        senderIdentityId: parsed.data.senderIdentityId,
        conversationId: parsed.data.conversationId,
        db: tx,
      });
      if (!targets.ok) return targets;
      const [current] = await tx<{ state: string; revision: string | number }[]>`
        SELECT state, revision
        FROM mail.drafts
        WHERE id = ${params.draftId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!current) return fail(err.notFound("Draft"));
      if (current.state !== "draft") return fail(err.badInput("Draft can no longer be edited"));
      if (Number(current.revision) !== params.expectedRevision) {
        return fail(err.badInput("Draft was changed by another collaborator"));
      }
      const [row] = await tx<DbDraft[]>`
        UPDATE mail.drafts d
        SET
          conversation_id = ${parsed.data.conversationId ?? null}::uuid,
          sender_identity_id = ${parsed.data.senderIdentityId}::uuid,
          to_addresses = ${parsed.data.to}::jsonb,
          cc_addresses = ${parsed.data.cc}::jsonb,
          bcc_addresses = ${parsed.data.bcc}::jsonb,
          subject = ${parsed.data.subject},
          body_markdown = ${parsed.data.body},
          body_format = ${parsed.data.format},
          revision = revision + 1
        WHERE d.id = ${params.draftId}::uuid
        RETURNING ${draftColumns}
      `;
      if (!row) return fail(err.internal("Draft update returned no row"));
      await tx`
        INSERT INTO mail.activity_events (
          mailbox_id, conversation_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
        ) VALUES (
          ${params.mailboxId}::uuid,
          ${parsed.data.conversationId ?? null}::uuid,
          ${actor.kind},
          ${actor.kind === "user" ? actor.userId : actor.serviceAccountId}::uuid,
          'draft.updated',
          'confirmed',
          'draft',
          ${row.id}::uuid,
          ${{ revision: Number(row.revision), previousRevision: Number(current.revision) }}::jsonb
        )
      `;
      return ok(mapDraft(row));
    });
  } catch {
    return fail(err.internal("Failed to update draft"));
  }
};

export const listDrafts = async (context: MailRequestContext, mailboxId: string, limit = 100): Promise<Result<MailDraft[]>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "write");
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
  const allowed = await requireMailboxPermission(context, mailboxId, "write");
  if (!allowed.ok) return allowed;
  const [row] = await sql<DbDraft[]>`
    SELECT ${draftColumns}
    FROM mail.drafts d
    WHERE d.id = ${draftId}::uuid AND d.mailbox_id = ${mailboxId}::uuid
  `;
  return row ? ok(mapDraft(row)) : fail(err.notFound("Draft"));
};

const sanitizeFilename = (value: string): string => {
  const normalized = value.normalize("NFC").trim().replace(/[\\/\u0000-\u001f\u007f]/g, "_");
  return [...normalized].slice(0, 255).join("") || "attachment";
};

const sanitizeContentType = (value: string): string =>
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value) ? value.toLowerCase() : "application/octet-stream";

export const addDraftAttachment = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  draftId: string;
  expectedRevision: number;
  filename: string;
  contentType: string;
  stream: Readable;
  expectedSize?: number | null;
}): Promise<Result<MailDraft>> => {
  if (!Number.isInteger(params.expectedRevision) || params.expectedRevision < 1) return fail(err.badInput("Invalid draft revision"));
  const actor = actorRefFromRequest(params.context);
  if (actor.kind !== "user" && actor.kind !== "service_account") return fail(err.forbidden("Draft author is invalid"));
  const permission = await requireMailboxPermission(params.context, params.mailboxId, "write");
  if (!permission.ok) return permission;
  const [candidate] = await sql<{ revision: string | number; state: string }[]>`
    SELECT revision, state
    FROM mail.drafts
    WHERE id = ${params.draftId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
  `;
  if (!candidate) return fail(err.notFound("Draft"));
  if (candidate.state !== "draft") return fail(err.badInput("Draft can no longer be edited"));
  if (Number(candidate.revision) !== params.expectedRevision) return fail(err.conflict("Draft was changed by another collaborator"));

  try {
    const blob = await storeReadableBlob(params.stream, params.expectedSize);
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
      if (Number(draft.revision) !== params.expectedRevision) return fail(err.conflict("Draft was changed by another collaborator"));
      const [position] = await tx<{ position: number }[]>`
        SELECT COALESCE(MAX(position), -1)::int + 1 AS position
        FROM mail.draft_attachments
        WHERE draft_id = ${params.draftId}::uuid
      `;
      const filename = sanitizeFilename(params.filename);
      const [attachment] = await tx<{ id: string }[]>`
        INSERT INTO mail.draft_attachments (
          draft_id, blob_id, filename, content_type, byte_length, content_hash, position
        ) VALUES (
          ${params.draftId}::uuid,
          ${blob.id}::uuid,
          ${filename},
          ${sanitizeContentType(params.contentType)},
          ${blob.byteLength},
          ${blob.contentHash},
          ${position?.position ?? 0}
        )
        RETURNING id
      `;
      if (!attachment) return fail(err.internal("Draft attachment insert returned no row"));
      const [updated] = await tx<DbDraft[]>`
        UPDATE mail.drafts d
        SET revision = revision + 1
        WHERE d.id = ${params.draftId}::uuid
        RETURNING ${draftColumns}
      `;
      if (!updated) return fail(err.internal("Draft attachment update returned no draft"));
      await tx`
        INSERT INTO mail.activity_events (
          mailbox_id, conversation_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
        ) VALUES (
          ${params.mailboxId}::uuid,
          ${updated.conversation_id}::uuid,
          ${actor.kind},
          ${actor.kind === "user" ? actor.userId : actor.serviceAccountId}::uuid,
          'draft.attachment_added',
          'confirmed',
          'draft_attachment',
          ${attachment.id}::uuid,
          ${{ draftId: params.draftId, filename, byteLength: blob.byteLength, contentHash: blob.contentHash, revision: Number(updated.revision) }}::jsonb
        )
      `;
      return ok(mapDraft(updated));
    });
  } catch (error) {
    params.stream.destroy();
    if ((error as { code?: string } | null)?.code === "BLOB_SIZE_MISMATCH") {
      return fail(err.badInput("Attachment byte count did not match Content-Length"));
    }
    return fail(err.internal("Failed to store draft attachment"));
  }
};

export const removeDraftAttachment = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  draftId: string;
  attachmentId: string;
  expectedRevision: number;
}): Promise<Result<MailDraft>> => {
  if (!Number.isInteger(params.expectedRevision) || params.expectedRevision < 1) return fail(err.badInput("Invalid draft revision"));
  const actor = actorRefFromRequest(params.context);
  if (actor.kind !== "user" && actor.kind !== "service_account") return fail(err.forbidden("Draft author is invalid"));
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
      if (Number(draft.revision) !== params.expectedRevision) return fail(err.conflict("Draft was changed by another collaborator"));
      const [removed] = await tx<{ id: string }[]>`
        UPDATE mail.draft_attachments
        SET removed_at = now()
        WHERE id = ${params.attachmentId}::uuid
          AND draft_id = ${params.draftId}::uuid
          AND removed_at IS NULL
        RETURNING id
      `;
      if (!removed) return fail(err.notFound("Draft attachment"));
      const [updated] = await tx<DbDraft[]>`
        UPDATE mail.drafts d SET revision = revision + 1
        WHERE d.id = ${params.draftId}::uuid
        RETURNING ${draftColumns}
      `;
      if (!updated) return fail(err.internal("Draft attachment removal returned no draft"));
      await tx`
        INSERT INTO mail.activity_events (
          mailbox_id, conversation_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
        ) VALUES (
          ${params.mailboxId}::uuid,
          ${updated.conversation_id}::uuid,
          ${actor.kind},
          ${actor.kind === "user" ? actor.userId : actor.serviceAccountId}::uuid,
          'draft.attachment_removed',
          'confirmed',
          'draft_attachment',
          ${removed.id}::uuid,
          ${{ draftId: params.draftId, revision: Number(updated.revision) }}::jsonb
        )
      `;
      return ok(mapDraft(updated));
    });
  } catch {
    return fail(err.internal("Failed to remove draft attachment"));
  }
};

export const discardDraft = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  draftId: string;
  expectedRevision: number;
}): Promise<Result<MailDraft>> => {
  if (!Number.isInteger(params.expectedRevision) || params.expectedRevision < 1) return fail(err.badInput("Invalid draft revision"));
  const actor = actorRefFromRequest(params.context);
  if (actor.kind !== "user" && actor.kind !== "service_account") return fail(err.forbidden("Draft author is invalid"));
  try {
    return await sql.begin(async (tx) => {
      const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write", tx);
      if (!allowed.ok) return allowed;
      const [updated] = await tx<DbDraft[]>`
        UPDATE mail.drafts d
        SET state = 'discarded', revision = revision + 1
        WHERE d.id = ${params.draftId}::uuid
          AND d.mailbox_id = ${params.mailboxId}::uuid
          AND d.state = 'draft'
          AND d.revision = ${params.expectedRevision}
        RETURNING ${draftColumns}
      `;
      if (updated) {
        await tx`
          INSERT INTO mail.activity_events (
            mailbox_id, conversation_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
          ) VALUES (
            ${params.mailboxId}::uuid,
            ${updated.conversation_id}::uuid,
            ${actor.kind},
            ${actor.kind === "user" ? actor.userId : actor.serviceAccountId}::uuid,
            'draft.discarded',
            'confirmed',
            'draft',
            ${params.draftId}::uuid,
            ${{ revision: Number(updated.revision) }}::jsonb
          )
        `;
        return ok(mapDraft(updated));
      }
      const [current] = await tx<{ revision: string | number; state: string }[]>`
        SELECT revision, state FROM mail.drafts
        WHERE id = ${params.draftId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
      `;
      if (!current) return fail(err.notFound("Draft"));
      if (current.state !== "draft") return fail(err.badInput("Draft can no longer be discarded"));
      return fail(err.conflict("Draft was changed by another collaborator"));
    });
  } catch {
    return fail(err.internal("Failed to discard draft"));
  }
};
