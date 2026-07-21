import { logger } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import {
  type ActorRef,
  type ConversationDraftSummary,
  type DraftAttachment,
  type DraftContentInput,
  type DraftDeliveryClass,
  type DraftEditableContentInput,
  type DraftIntent,
  type DraftRecoveryCopy,
  draftContentInputSchema,
  draftEditableContentInputSchema,
  MAX_DRAFT_ATTACHMENT_BYTES,
  type MailDraft,
} from "../contracts";
import { requireMailboxPermission } from "./access";
import { actorRefFromRequest, type MailRequestContext } from "./auth";
import { sha256Json } from "./canonical";
import { resolveDefaultSignatureSource } from "./compose-templates";
import { applyConversationReferenceToReplySubjectInTransaction } from "./conversation-reference";
import { withOwnedDraftLease } from "./draft-leases";
import { enqueueDraftProjection, enqueueDraftProjectionSnapshot, queueDraftProjectionInTransaction } from "./draft-provider-projection";
import type { AttachmentDownload } from "./messages";

type DraftActor = Extract<ActorRef, { kind: "user" | "service_account" | "workflow" | "system" }>;
type MutableActor = Extract<DraftActor, { kind: "user" | "service_account" }>;
const log = logger("mail:drafts");

const wakeDraftProjection = async <T extends { id: string }>(result: Result<T>): Promise<Result<T>> => {
  if (!result.ok) return result;
  try {
    await enqueueDraftProjection(result.data.id);
  } catch (error) {
    log.warn("Immediate draft projection enqueue failed; the reconciliation sweep will retry it", {
      draftId: result.data.id,
      error,
    });
  }
  return result;
};

type DbDraft = {
  id: string;
  mailbox_id: string;
  conversation_id: string | null;
  intent: DraftIntent;
  source_message_id: string | null;
  sender_identity_id: string;
  author_kind: DraftActor["kind"];
  author_id: string | null;
  last_editor_kind: DraftActor["kind"];
  last_editor_id: string | null;
  to_addresses: MailDraft["to"] | string;
  cc_addresses: MailDraft["cc"] | string;
  bcc_addresses: MailDraft["bcc"] | string;
  subject: string;
  body_markdown: string;
  body_format: MailDraft["format"];
  delivery_class: DraftDeliveryClass;
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
  creator_kind: DraftActor["kind"];
  creator_id: string | null;
  has_attachment_snapshot: boolean;
  created_at: Date | string;
  restored_at: Date | string | null;
  resulting_revision: string | number | null;
};

type DbConversationDraftSummary = {
  id: string;
  intent: DraftIntent;
  subject: string;
  body_preview_source: string;
  created_by_display_name: string;
  updated_at: Date | string;
};

const DRAFT_BODY_PREVIEW_SOURCE_LENGTH = 1_024;
const DRAFT_BODY_PREVIEW_LENGTH = 240;

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
  d.delivery_class,
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
  recovery.has_attachment_snapshot,
  recovery.created_at,
  recovery.restored_at,
  recovery.resulting_revision
`;

const parseArray = <T>(value: T[] | string): T[] => (typeof value === "string" ? (JSON.parse(value) as T[]) : value);
const parseRecord = <T>(value: T | string): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);
const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const draftBodyPreview = (value: string): string => value.replace(/\s+/gu, " ").trim().slice(0, DRAFT_BODY_PREVIEW_LENGTH);

const mutableActor = (context: MailRequestContext): MutableActor | null => {
  const actor = actorRefFromRequest(context);
  return actor.kind === "user" || actor.kind === "service_account" ? actor : null;
};

const actorId = (actor: MutableActor): string => (actor.kind === "user" ? actor.userId : actor.serviceAccountId);

const actorFromColumns = (kind: DraftActor["kind"], id: string | null): DraftActor =>
  kind === "user"
    ? { kind, userId: id! }
    : kind === "service_account"
      ? { kind, serviceAccountId: id!, delegatedUserId: null }
      : kind === "workflow"
        ? { kind, workflowVersionId: id! }
        : { kind: "system" };

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
  deliveryClass: row.delivery_class,
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

const copyForwardAttachments = async (params: { db: typeof sql; draftId: string; sourceMessageId: string }): Promise<Result<number>> => {
  const [invalid] = await params.db<{ invalid: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM mail.attachments attachment
      LEFT JOIN mail.message_part_blobs blob ON blob.id = attachment.blob_id
      WHERE attachment.message_id = ${params.sourceMessageId}::uuid
        AND (blob.id IS NULL OR blob.complete = false OR blob.byte_length > ${MAX_DRAFT_ATTACHMENT_BYTES})
    ) AS invalid
  `;
  if (invalid?.invalid) {
    return fail(err.badInput("One or more original attachments cannot be forwarded"));
  }

  const copied = await params.db<{ id: string }[]>`
    INSERT INTO mail.draft_attachments (
      draft_id, blob_id, filename, content_type, byte_length, content_hash, position
    )
    SELECT
      ${params.draftId}::uuid,
      attachment.blob_id,
      left(COALESCE(NULLIF(attachment.filename, ''), 'attachment'), 255),
      left(COALESCE(NULLIF(attachment.content_type, ''), 'application/octet-stream'), 255),
      blob.byte_length,
      blob.content_hash,
      (row_number() OVER (ORDER BY attachment.id) - 1)::int
    FROM mail.attachments attachment
    JOIN mail.message_part_blobs blob ON blob.id = attachment.blob_id AND blob.complete = true
    WHERE attachment.message_id = ${params.sourceMessageId}::uuid
    ORDER BY attachment.id
    RETURNING id
  `;
  return ok(copied.length);
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
    const result = await sql.begin(async (tx) => {
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
      if (parsed.data.includeSourceAttachments && draftContext.data.intent !== "forward") {
        return fail(err.badInput("Original attachments can only be included when forwarding a message"));
      }
      const defaultSignature =
        draftContext.data.intent === "new"
          ? await resolveDefaultSignatureSource({
              db: tx,
              context: params.context,
              mailboxId: params.mailboxId,
              senderIdentityId: parsed.data.senderIdentityId,
            })
          : null;
      const initialSubject =
        draftContext.data.intent === "reply" || draftContext.data.intent === "reply_all"
          ? await applyConversationReferenceToReplySubjectInTransaction({
              db: tx,
              mailboxId: params.mailboxId,
              conversationId: draftContext.data.conversationId!,
              subject: parsed.data.subject,
            })
          : parsed.data.subject;
      const initialBody = defaultSignature ? [parsed.data.body.trimEnd(), defaultSignature].filter(Boolean).join("\n\n") : parsed.data.body;
      const initialContent = draftContentInputSchema.safeParse({ ...parsed.data, subject: initialSubject, body: initialBody });
      if (!initialContent.success) {
        return fail(err.badInput(initialContent.error.issues[0]?.message ?? "Default signature makes the draft too large"));
      }
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
          ${initialContent.data.subject},
          ${initialContent.data.body},
          ${parsed.data.format}
        )
        RETURNING ${draftColumns}
      `;
      if (!row) return fail(err.internal("Draft insert returned no row"));
      let attachmentCount = 0;
      if (parsed.data.includeSourceAttachments && draftContext.data.sourceMessageId) {
        const copied = await copyForwardAttachments({
          db: tx,
          draftId: row.id,
          sourceMessageId: draftContext.data.sourceMessageId,
        });
        if (!copied.ok) return copied;
        attachmentCount = copied.data;
      }
      const [created] = await tx<DbDraft[]>`
        SELECT ${draftColumns}
        FROM mail.drafts d
        WHERE d.id = ${row.id}::uuid
      `;
      if (!created) return fail(err.internal("Created draft could not be loaded"));
      await insertActivity({
        db: tx,
        mailboxId: params.mailboxId,
        conversationId: draftContext.data.conversationId,
        actor,
        action: "draft.created",
        targetType: "draft",
        targetId: row.id,
        metadata: {
          revision: Number(created.revision),
          intent: draftContext.data.intent,
          sourceMessageId: draftContext.data.sourceMessageId,
          attachmentCount,
        },
      });
      await queueDraftProjectionInTransaction({ db: tx, draftId: row.id });
      return ok({
        ...mapDraft(created),
        initialSignatureSource: defaultSignature,
      });
    });
    return wakeDraftProjection(result);
  } catch {
    return fail(err.internal("Failed to create draft"));
  }
};

export const createWorkflowReplyDraftInTransaction = async (params: {
  db: typeof sql;
  mailboxId: string;
  workflowVersionId: string;
  draftId: string;
  conversationId: string;
  sourceMessageId: string;
  senderIdentityId: string;
  recipient: { name: string | null; address: string };
  subject: string;
  body: string;
  format: "plain" | "markdown";
}): Promise<Result<{ id: string; revision: number }>> => {
  const content = draftContentInputSchema.safeParse({
    conversationId: params.conversationId,
    intent: "reply",
    sourceMessageId: params.sourceMessageId,
    senderIdentityId: params.senderIdentityId,
    to: [params.recipient],
    cc: [],
    bcc: [],
    subject: params.subject,
    body: params.body,
    format: params.format,
  });
  if (!content.success) return fail(err.badInput(content.error.issues[0]?.message ?? "Invalid automatic reply draft"));
  const [source] = await params.db<{ id: string }[]>`
    SELECT message.id
    FROM mail.message_contents message
    JOIN mail.conversation_messages link ON link.message_id = message.id
    JOIN mail.conversations conversation ON conversation.id = link.conversation_id
    WHERE message.id = ${params.sourceMessageId}::uuid
      AND conversation.id = ${params.conversationId}::uuid
      AND conversation.mailbox_id = ${params.mailboxId}::uuid
    FOR SHARE OF message, conversation
  `;
  if (!source) return fail(err.badInput("Automatic reply source is no longer part of the conversation"));
  const [identity] = await params.db<{ id: string }[]>`
    SELECT id
    FROM mail.sender_identities
    WHERE id = ${params.senderIdentityId}::uuid
      AND mailbox_id = ${params.mailboxId}::uuid
      AND status = 'verified'
      AND automation_policy = 'mailbox'
    FOR SHARE
  `;
  if (!identity) return fail(err.forbidden("Sender identity no longer permits mailbox automation"));
  const subject = await applyConversationReferenceToReplySubjectInTransaction({
    db: params.db,
    mailboxId: params.mailboxId,
    conversationId: params.conversationId,
    subject: content.data.subject,
  });
  const [draft] = await params.db<{ id: string; revision: string | number }[]>`
    INSERT INTO mail.drafts (
      id, mailbox_id, conversation_id, intent, source_message_id, sender_identity_id,
      author_kind, author_id, last_editor_kind, last_editor_id, origin, delivery_class,
      to_addresses, cc_addresses, bcc_addresses, subject, body_markdown, body_format
    ) VALUES (
      ${params.draftId}::uuid, ${params.mailboxId}::uuid, ${params.conversationId}::uuid, 'reply', ${params.sourceMessageId}::uuid,
      ${params.senderIdentityId}::uuid, 'workflow', ${params.workflowVersionId}::uuid, 'workflow', ${params.workflowVersionId}::uuid,
      'workflow', 'automatic_reply', ${content.data.to}::jsonb, '[]'::jsonb, '[]'::jsonb, ${subject}, ${content.data.body}, ${content.data.format}
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id, revision
  `;
  if (draft) return ok({ id: draft.id, revision: Number(draft.revision) });
  const [existing] = await params.db<{ id: string; revision: string | number }[]>`
    SELECT id, revision
    FROM mail.drafts
    WHERE id = ${params.draftId}::uuid
      AND mailbox_id = ${params.mailboxId}::uuid
      AND origin = 'workflow'
      AND delivery_class = 'automatic_reply'
      AND author_kind = 'workflow'
      AND author_id = ${params.workflowVersionId}::uuid
    FOR UPDATE
  `;
  return existing ? ok({ id: existing.id, revision: Number(existing.revision) }) : fail(err.conflict("Automatic reply draft id is in use"));
};

export const createWorkflowDraftInTransaction = async (params: {
  db: typeof sql;
  mailboxId: string;
  workflowVersionId: string;
  draftId: string;
  senderIdentityId: string;
  to: Array<{ name?: string | null; address: string }>;
  cc: Array<{ name?: string | null; address: string }>;
  bcc: Array<{ name?: string | null; address: string }>;
  subject: string;
  body: string;
  format: "plain" | "markdown";
}): Promise<Result<{ id: string; revision: number; senderIdentityId: string; deliveryClass: "normal" }>> => {
  const content = draftContentInputSchema.safeParse({
    intent: "new",
    senderIdentityId: params.senderIdentityId,
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    body: params.body,
    format: params.format,
  });
  if (!content.success) return fail(err.badInput(content.error.issues[0]?.message ?? "Invalid workflow draft"));
  const [identity] = await params.db<{ id: string }[]>`
    SELECT id
    FROM mail.sender_identities
    WHERE id = ${params.senderIdentityId}::uuid
      AND mailbox_id = ${params.mailboxId}::uuid
      AND status = 'verified'
      AND automation_policy = 'mailbox'
    FOR SHARE
  `;
  if (!identity) return fail(err.forbidden("Sender identity no longer permits mailbox automation"));
  const [draft] = await params.db<{ id: string; revision: string | number }[]>`
    INSERT INTO mail.drafts (
      id, mailbox_id, conversation_id, intent, source_message_id, sender_identity_id,
      author_kind, author_id, last_editor_kind, last_editor_id, origin, delivery_class,
      to_addresses, cc_addresses, bcc_addresses, subject, body_markdown, body_format
    ) VALUES (
      ${params.draftId}::uuid, ${params.mailboxId}::uuid, NULL, 'new', NULL, ${params.senderIdentityId}::uuid,
      'workflow', ${params.workflowVersionId}::uuid, 'workflow', ${params.workflowVersionId}::uuid,
      'workflow', 'normal', ${content.data.to}::jsonb, ${content.data.cc}::jsonb, ${content.data.bcc}::jsonb,
      ${content.data.subject}, ${content.data.body}, ${content.data.format}
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id, revision
  `;
  if (draft) {
    return ok({ id: draft.id, revision: Number(draft.revision), senderIdentityId: params.senderIdentityId, deliveryClass: "normal" });
  }
  const [existing] = await params.db<{ id: string; revision: string | number; sender_identity_id: string }[]>`
    SELECT id, revision, sender_identity_id
    FROM mail.drafts
    WHERE id = ${params.draftId}::uuid
      AND mailbox_id = ${params.mailboxId}::uuid
      AND origin = 'workflow'
      AND delivery_class = 'normal'
      AND author_kind = 'workflow'
      AND author_id = ${params.workflowVersionId}::uuid
    FOR UPDATE
  `;
  return existing
    ? ok({ id: existing.id, revision: Number(existing.revision), senderIdentityId: existing.sender_identity_id, deliveryClass: "normal" })
    : fail(err.conflict("Workflow draft id is in use"));
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
    const result = await sql.begin(async (tx) => {
      const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write", tx);
      if (!allowed.ok) return allowed;
      const [current] = await tx<{ state: string; revision: string | number }[]>`
        SELECT state, revision
        FROM mail.drafts
        WHERE id = ${params.draftId}::uuid AND mailbox_id = ${params.mailboxId}::uuid AND origin = 'user'
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
        WHERE d.id = ${params.draftId}::uuid AND d.origin = 'user'
        RETURNING ${draftColumns}
      `;
      if (row) await queueDraftProjectionInTransaction({ db: tx, draftId: row.id });
      return row ? ok(mapDraft(row)) : fail(err.internal("Draft update returned no row"));
    });
    return wakeDraftProjection(result);
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
    WHERE d.mailbox_id = ${mailboxId}::uuid AND d.origin = 'user' AND d.state IN ('draft', 'scheduled', 'sending')
    ORDER BY d.updated_at DESC, d.id DESC
    LIMIT ${Math.min(Math.max(Math.floor(limit), 1), 200)}
  `;
  return ok(rows.map(mapDraft));
};

export const listConversationDrafts = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  limit?: number;
}): Promise<Result<ConversationDraftSummary[]>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<DbConversationDraftSummary[]>`
    SELECT
      d.id,
      d.intent,
      d.subject,
      LEFT(d.body_markdown, ${DRAFT_BODY_PREVIEW_SOURCE_LENGTH}) AS body_preview_source,
      COALESCE(
        NULLIF(author_user.display_name, ''),
        author_user.uid,
        author_service.name,
        CASE d.author_kind
          WHEN 'workflow' THEN 'Workflow'
          WHEN 'system' THEN 'Mail provider'
          WHEN 'user' THEN 'Former user'
          ELSE 'Former service account'
        END
      ) AS created_by_display_name,
      d.updated_at
    FROM mail.drafts d
    LEFT JOIN auth.users author_user ON d.author_kind = 'user' AND author_user.id = d.author_id
    LEFT JOIN auth.service_accounts author_service ON d.author_kind = 'service_account' AND author_service.id = d.author_id
    WHERE d.mailbox_id = ${params.mailboxId}::uuid
      AND d.conversation_id = ${params.conversationId}::uuid
      AND d.origin = 'user'
      AND d.state = 'draft'
    ORDER BY d.updated_at DESC, d.id DESC
    LIMIT ${Math.min(Math.max(Math.floor(params.limit ?? 20), 1), 50)}
  `;
  return ok(
    rows.map((row) => ({
      id: row.id,
      intent: row.intent,
      subject: row.subject,
      bodyPreview: draftBodyPreview(row.body_preview_source),
      createdByDisplayName: row.created_by_display_name,
      updatedAt: toIso(row.updated_at),
    })),
  );
};

export const getDraft = async (context: MailRequestContext, mailboxId: string, draftId: string): Promise<Result<MailDraft>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  const [row] = await sql<DbDraft[]>`
    SELECT ${draftColumns}
    FROM mail.drafts d
    WHERE d.id = ${draftId}::uuid AND d.mailbox_id = ${mailboxId}::uuid AND d.origin = 'user'
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
      AND draft.origin = 'user'
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
  leaseToken: string;
}): Promise<Result<MailDraft>> => {
  if (!Number.isInteger(params.expectedRevision) || params.expectedRevision < 1) return fail(err.badInput("Invalid draft revision"));
  const actor = mutableActor(params.context);
  if (!actor) return fail(err.forbidden("Draft editor is invalid"));
  try {
    const result = await withOwnedDraftLease({
      context: params.context,
      mailboxId: params.mailboxId,
      draftId: params.draftId,
      token: params.leaseToken,
      operation: () =>
        sql.begin(async (tx) => {
          const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write", tx);
          if (!allowed.ok) return allowed;
          const [draft] = await tx<{ revision: string | number; state: string }[]>`
        SELECT revision, state
        FROM mail.drafts
        WHERE id = ${params.draftId}::uuid AND mailbox_id = ${params.mailboxId}::uuid AND origin = 'user'
        FOR UPDATE
      `;
          if (!draft) return fail(err.notFound("Draft"));
          if (draft.state !== "draft") return fail(err.badInput("Draft can no longer be edited"));
          if (Number(draft.revision) !== params.expectedRevision)
            return conflict("Draft changed before the recovery copy could be restored");
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
          const recoveryAttachments = copy.has_attachment_snapshot
            ? await tx<
                {
                  blob_id: string;
                  filename: string;
                  content_type: string;
                  byte_length: string | number;
                  content_hash: string;
                  position: number;
                }[]
              >`
                SELECT blob_id, filename, content_type, byte_length, content_hash, position
                FROM mail.draft_recovery_attachments
                WHERE recovery_copy_id = ${copy.id}::uuid
                ORDER BY position
              `
            : null;
          if (recoveryAttachments) {
            await tx`DELETE FROM mail.draft_attachments WHERE draft_id = ${params.draftId}::uuid`;
            for (const attachment of recoveryAttachments) {
              await tx`
                INSERT INTO mail.draft_attachments (
                  draft_id, blob_id, filename, content_type, byte_length, content_hash, position
                ) VALUES (
                  ${params.draftId}::uuid,
                  ${attachment.blob_id}::uuid,
                  ${attachment.filename},
                  ${attachment.content_type},
                  ${Number(attachment.byte_length)},
                  ${attachment.content_hash},
                  ${attachment.position}
                )
              `;
            }
          }
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
        WHERE d.id = ${params.draftId}::uuid AND d.origin = 'user'
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
          await queueDraftProjectionInTransaction({ db: tx, draftId: updated.id });
          const [refreshed] = await tx<DbDraft[]>`
        SELECT ${draftColumns}
        FROM mail.drafts d
        WHERE d.id = ${params.draftId}::uuid AND d.origin = 'user'
      `;
          return refreshed ? ok(mapDraft(refreshed)) : fail(err.internal("Restored draft could not be reloaded"));
        }),
    });
    return wakeDraftProjection(result);
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
    const result = await sql.begin(async (tx) => {
      const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write", tx);
      if (!allowed.ok) return allowed;
      const [draft] = await tx<{ revision: string | number; state: string }[]>`
        SELECT revision, state FROM mail.drafts
        WHERE id = ${params.draftId}::uuid AND mailbox_id = ${params.mailboxId}::uuid AND origin = 'user'
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
        WHERE d.id = ${params.draftId}::uuid AND d.origin = 'user'
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
      await queueDraftProjectionInTransaction({ db: tx, draftId: updated.id });
      return ok(mapDraft(updated));
    });
    return wakeDraftProjection(result);
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
      AND draft.origin = 'user'
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
    let retirementSnapshotId: string | null = null;
    const result = await sql.begin(async (tx) => {
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
          AND d.origin = 'user'
          AND d.state = 'draft'
          AND d.revision = ${params.expectedRevision}
        RETURNING ${draftColumns}
      `;
      if (!updated) {
        const [current] = await tx<{ revision: string | number; state: string }[]>`
          SELECT revision, state FROM mail.drafts
          WHERE id = ${params.draftId}::uuid AND mailbox_id = ${params.mailboxId}::uuid AND origin = 'user'
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
      retirementSnapshotId = await queueDraftProjectionInTransaction({ db: tx, draftId: updated.id });
      return ok(mapDraft(updated));
    });
    if (result.ok && retirementSnapshotId) await enqueueDraftProjectionSnapshot(retirementSnapshotId);
    return result;
  } catch {
    return fail(err.internal("Failed to discard draft"));
  }
};
