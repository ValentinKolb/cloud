import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { type DraftContentInput, draftContentInputSchema, type MailDraft } from "../contracts";
import { requireMailboxPermission } from "./access";
import { actorRefFromRequest, type MailRequestContext } from "./auth";

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
  d.created_at,
  d.updated_at
`;

const parseAddresses = (value: MailDraft["to"] | string): MailDraft["to"] =>
  typeof value === "string" ? (JSON.parse(value) as MailDraft["to"]) : value;

const mapDraft = (row: DbDraft): MailDraft => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  conversationId: row.conversation_id,
  senderIdentityId: row.sender_identity_id,
  to: parseAddresses(row.to_addresses),
  cc: parseAddresses(row.cc_addresses),
  bcc: parseAddresses(row.bcc_addresses),
  subject: row.subject,
  body: row.body_markdown,
  format: row.body_format,
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
