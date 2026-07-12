import { audit, toPgTextArray } from "@valentinkolb/cloud/services";
import { err, fail, isServiceError, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { type ActorCommandInput, type ActorRef, actorCommandInputSchema, type MailCommand } from "../contracts";
import { actorRefFromRequest, auditActorFromRequest, type MailRequestContext } from "./auth";
import { sha256Json } from "./canonical";
import { enqueueMailCommand } from "./command-runtime";
import { resolveMailExecution } from "./execution";

type DbCommand = {
  id: string;
  mailbox_id: string;
  kind: MailCommand["kind"];
  state: MailCommand["state"];
  actor_kind: ActorRef["kind"];
  actor_id: string | null;
  delegated_user_id: string | null;
  idempotency_key: string;
  request_hash: string;
  correlation_id: string | null;
  target: Record<string, unknown> | string;
  payload: Record<string, unknown> | string;
  selected_binding_id: string | null;
  rights_snapshot: Record<string, unknown> | string | null;
  transport_metadata: Record<string, unknown> | string;
  attempt: number;
  last_error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const commandColumns = sql`
  c.id,
  c.mailbox_id,
  c.kind,
  c.state,
  c.actor_kind,
  c.actor_id,
  c.delegated_user_id,
  c.idempotency_key,
  c.request_hash,
  c.correlation_id,
  c.target,
  c.payload,
  c.selected_binding_id,
  c.rights_snapshot,
  c.transport_metadata,
  c.attempt,
  c.last_error_message,
  c.created_at,
  c.updated_at
`;

const parseRecord = (value: Record<string, unknown> | string): Record<string, unknown> =>
  typeof value === "string" ? (JSON.parse(value) as Record<string, unknown>) : value;

const actorFromRow = (row: DbCommand): ActorRef => {
  if (row.actor_kind === "user" && row.actor_id) return { kind: "user", userId: row.actor_id };
  if (row.actor_kind === "service_account" && row.actor_id) {
    return { kind: "service_account", serviceAccountId: row.actor_id, delegatedUserId: row.delegated_user_id };
  }
  if (row.actor_kind === "workflow" && row.actor_id) return { kind: "workflow", workflowVersionId: row.actor_id };
  return { kind: "system" };
};

const mapCommand = (row: DbCommand): MailCommand => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  kind: row.kind,
  state: row.state,
  actor: actorFromRow(row),
  idempotencyKey: row.idempotency_key,
  correlationId: row.correlation_id,
  target: parseRecord(row.target),
  payload: parseRecord(row.payload),
  selectedBindingId: row.selected_binding_id,
  rightsSnapshot: row.rights_snapshot ? parseRecord(row.rights_snapshot) : null,
  transportMetadata: parseRecord(row.transport_metadata),
  attempt: row.attempt,
  lastError: row.last_error_message,
  createdAt: (row.created_at instanceof Date ? row.created_at : new Date(row.created_at)).toISOString(),
  updatedAt: (row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)).toISOString(),
});

type PreparedActorCommand = {
  kind: ActorCommandInput["kind"];
  idempotencyKey: string;
  correlationId: string | null;
  target: Record<string, unknown>;
  payload: Record<string, unknown>;
  folderRequirements: Array<{ folderId: string; rights: string[] }>;
  senderIdentityId: string | null;
  remoteMessageRefId: string | null;
  sourceFolderId: string | null;
  draftId: string | null;
  scheduledAt: string | null;
  undoSeconds: number;
};

type DraftForOutbox = {
  to_addresses: unknown;
  cc_addresses: unknown;
  bcc_addresses: unknown;
  subject: string;
  body_markdown: string;
  body_format: "plain" | "markdown";
  revision: string | number;
  display_name: string;
  from_address: string;
  reply_to: string | null;
  envelope_sender: string | null;
  parent_message_id: string | null;
  reference_ids: string[] | null;
};

const actorDatabaseId = (actor: ActorRef): string | null => {
  if (actor.kind === "user") return actor.userId;
  if (actor.kind === "service_account") return actor.serviceAccountId;
  return null;
};

const accessSubjectDatabaseId = (context: MailRequestContext): string =>
  context.accessSubject.type === "user" ? context.accessSubject.userId : context.accessSubject.serviceAccountId;

const prepareActorCommand = (input: ActorCommandInput): Result<PreparedActorCommand> => {
  if ((input.kind === "move" || input.kind === "copy") && input.sourceFolderId === input.destinationFolderId) {
    return fail(err.badInput("Source and destination folders must differ"));
  }
  const base = {
    kind: input.kind,
    idempotencyKey: input.idempotencyKey.trim(),
    correlationId: input.correlationId?.trim() || null,
    senderIdentityId: null,
    remoteMessageRefId: null,
    sourceFolderId: null,
    draftId: null,
    scheduledAt: null,
    undoSeconds: 0,
  };
  if (input.kind === "set_flags") {
    return ok({
      ...base,
      target: { remoteMessageRefId: input.remoteMessageRefId, folderId: input.folderId },
      payload: { flags: [...new Set(input.flags.map((flag) => flag.trim()))].sort() },
      folderRequirements: [{ folderId: input.folderId, rights: ["write_flags"] }],
      remoteMessageRefId: input.remoteMessageRefId,
      sourceFolderId: input.folderId,
    });
  }
  if (input.kind === "move" || input.kind === "copy") {
    return ok({
      ...base,
      target: {
        remoteMessageRefId: input.remoteMessageRefId,
        sourceFolderId: input.sourceFolderId,
        destinationFolderId: input.destinationFolderId,
      },
      payload: {},
      folderRequirements: [
        { folderId: input.sourceFolderId, rights: input.kind === "move" ? ["read", "write_flags"] : ["read"] },
        { folderId: input.destinationFolderId, rights: ["insert"] },
      ],
      remoteMessageRefId: input.remoteMessageRefId,
      sourceFolderId: input.sourceFolderId,
    });
  }
  if (input.kind === "delete") {
    return ok({
      ...base,
      target: { remoteMessageRefId: input.remoteMessageRefId, folderId: input.folderId },
      payload: { deleted: true },
      folderRequirements: [{ folderId: input.folderId, rights: ["delete_messages"] }],
      remoteMessageRefId: input.remoteMessageRefId,
      sourceFolderId: input.folderId,
    });
  }
  return ok({
    ...base,
    target: { draftId: input.draftId, senderIdentityId: input.senderIdentityId },
    payload: { scheduledAt: input.scheduledAt ?? null, undoSeconds: input.undoSeconds },
    folderRequirements: [],
    senderIdentityId: input.senderIdentityId,
    draftId: input.draftId,
    scheduledAt: input.scheduledAt ?? null,
    undoSeconds: input.undoSeconds,
  });
};

const validateCommandTargets = async (params: {
  mailboxId: string;
  prepared: PreparedActorCommand;
  db: typeof sql;
}): Promise<Result<void>> => {
  if (params.prepared.remoteMessageRefId && params.prepared.sourceFolderId) {
    const [messageRef] = await params.db<{ id: string }[]>`
      SELECT rmr.id
      FROM mail.remote_message_refs rmr
      JOIN mail.folders f ON f.id = rmr.folder_id
      JOIN mail.remote_resources rr ON rr.id = f.remote_resource_id
      WHERE rmr.id = ${params.prepared.remoteMessageRefId}::uuid
        AND rmr.folder_id = ${params.prepared.sourceFolderId}::uuid
        AND rr.mailbox_id = ${params.mailboxId}::uuid
        AND rmr.stale_at IS NULL
    `;
    if (!messageRef) return fail(err.notFound("Remote message"));
  }
  if (params.prepared.draftId && params.prepared.senderIdentityId) {
    const [draft] = await params.db<{ id: string; has_recipients: boolean }[]>`
      SELECT
        d.id,
        jsonb_array_length(d.to_addresses)
          + jsonb_array_length(d.cc_addresses)
          + jsonb_array_length(d.bcc_addresses) > 0 AS has_recipients
      FROM mail.drafts d
      JOIN mail.sender_identities si ON si.id = d.sender_identity_id
      WHERE d.id = ${params.prepared.draftId}::uuid
        AND d.mailbox_id = ${params.mailboxId}::uuid
        AND d.sender_identity_id = ${params.prepared.senderIdentityId}::uuid
        AND d.state IN ('draft', 'scheduled')
        AND si.status = 'verified'
      FOR UPDATE OF d
    `;
    if (!draft) return fail(err.badInput("Draft or sender identity is not ready for sending"));
    if (!draft.has_recipients) return fail(err.badInput("At least one recipient is required before sending"));
  }
  return ok();
};

const createSendOutbox = async (params: {
  db: typeof sql;
  mailboxId: string;
  commandId: string;
  selectedBindingId: string;
  prepared: PreparedActorCommand;
}): Promise<void> => {
  const { prepared } = params;
  if (prepared.kind !== "send" || !prepared.draftId || !prepared.senderIdentityId) return;
  const [draft] = await params.db<DraftForOutbox[]>`
    SELECT
      d.to_addresses,
      d.cc_addresses,
      d.bcc_addresses,
      d.subject,
      d.body_markdown,
      d.body_format,
      d.revision,
      si.display_name,
      si.from_address,
      si.reply_to,
      si.envelope_sender,
      latest.message_id AS parent_message_id,
      latest.reference_ids
    FROM mail.drafts d
    JOIN mail.sender_identities si ON si.id = d.sender_identity_id
    LEFT JOIN LATERAL (
      SELECT mc.message_id, mc.reference_ids
      FROM mail.conversation_messages cm
      JOIN mail.message_contents mc ON mc.id = cm.message_id
      WHERE cm.conversation_id = d.conversation_id
      ORDER BY cm.position DESC, mc.internal_date DESC, mc.id DESC
      LIMIT 1
    ) latest ON true
    WHERE d.id = ${prepared.draftId}::uuid
      AND d.mailbox_id = ${params.mailboxId}::uuid
      AND d.sender_identity_id = ${prepared.senderIdentityId}::uuid
      AND si.status = 'verified'
    FOR UPDATE OF d, si
  `;
  if (!draft) {
    const unavailable = err.badInput("Draft is no longer available");
    throw Object.assign(new Error(unavailable.message), unavailable);
  }
  const senderDomain = draft.from_address.split("@")[1]?.toLowerCase() || "mail.invalid";
  const stableMessageId = `<${crypto.randomUUID()}@${senderDomain}>`;
  const references = [...(draft.reference_ids ?? []), ...(draft.parent_message_id ? [draft.parent_message_id] : [])].filter(
    (value, index, values) => value && values.indexOf(value) === index,
  );
  const scheduledAt = prepared.scheduledAt ? new Date(prepared.scheduledAt) : new Date();
  if (!Number.isFinite(scheduledAt.getTime())) {
    throw Object.assign(new Error("Invalid scheduled send time"), { code: "INVALID_SCHEDULE" });
  }
  const effectiveScheduledAt = new Date(Math.max(Date.now(), scheduledAt.getTime()));
  const undoUntil = new Date(effectiveScheduledAt.getTime() + prepared.undoSeconds * 1_000);
  await params.db`
    INSERT INTO mail.outbox_submissions (
      mailbox_id,
      draft_id,
      command_id,
      sender_identity_id,
      selected_binding_id,
      stable_message_id,
      state,
      scheduled_at,
      undo_until,
      draft_snapshot
    )
    VALUES (
      ${params.mailboxId}::uuid,
      ${prepared.draftId}::uuid,
      ${params.commandId}::uuid,
      ${prepared.senderIdentityId}::uuid,
      ${params.selectedBindingId}::uuid,
      ${stableMessageId},
      ${prepared.undoSeconds > 0 ? "undo_window" : "scheduled"},
      ${effectiveScheduledAt},
      ${undoUntil},
      ${{
        revision: Number(draft.revision),
        from: { name: draft.display_name, address: draft.from_address },
        replyTo: draft.reply_to,
        envelopeFrom: draft.envelope_sender,
        to: draft.to_addresses,
        cc: draft.cc_addresses,
        bcc: draft.bcc_addresses,
        subject: draft.subject,
        body: draft.body_markdown,
        format: draft.body_format,
        inReplyTo: draft.parent_message_id,
        references,
      }}::jsonb
    )
  `;
  await params.db`
    UPDATE mail.drafts
    SET state = 'scheduled'
    WHERE id = ${prepared.draftId}::uuid
  `;
};

export const createActorCommand = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: ActorCommandInput;
}): Promise<Result<MailCommand>> => {
  const parsed = actorCommandInputSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid mail command"));
  const preparedResult = prepareActorCommand(parsed.data);
  if (!preparedResult.ok) return preparedResult;
  const prepared = preparedResult.data;
  const requestHash = sha256Json({ kind: prepared.kind, target: prepared.target, payload: prepared.payload });
  const actor = actorRefFromRequest(params.context);

  try {
    const result = await sql.begin(async (tx) => {
      const [mailbox] = await tx<{ id: string }[]>`
        SELECT id FROM mail.mailboxes WHERE id = ${params.mailboxId}::uuid AND deleted_at IS NULL FOR UPDATE
      `;
      if (!mailbox) return fail(err.notFound("Mailbox"));
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${params.mailboxId}:${prepared.kind}:${stableTargetKey(prepared.target)}`}, 0))`;

      const [existing] = await tx<DbCommand[]>`
        SELECT ${commandColumns}
        FROM mail.commands c
        WHERE c.mailbox_id = ${params.mailboxId}::uuid AND c.idempotency_key = ${prepared.idempotencyKey}
        FOR UPDATE
      `;
      if (existing) {
        return existing.request_hash === requestHash
          ? ok(mapCommand(existing))
          : fail(err.conflict("Idempotency key with a different mail command"));
      }

      const targets = await validateCommandTargets({ mailboxId: params.mailboxId, prepared, db: tx });
      if (!targets.ok) return targets;
      const execution = await resolveMailExecution({
        mailboxId: params.mailboxId,
        operation: prepared.kind === "send" ? "actorSend" : "actorMutation",
        context: params.context,
        folderRequirements: prepared.folderRequirements,
        senderIdentityId: prepared.senderIdentityId,
        db: tx,
      });
      if (!execution.ok) return execution;
      if (!execution.data.bindingId) return fail(err.forbidden("A remote mutation requires an active provider binding"));

      const [row] = await tx<DbCommand[]>`
        INSERT INTO mail.commands AS c (
          mailbox_id,
          kind,
          actor_kind,
          actor_id,
          delegated_user_id,
          idempotency_key,
          request_hash,
          correlation_id,
          target,
          payload,
          selected_binding_id,
          selected_secret_revision,
          rights_snapshot,
          transport_metadata,
          access_subject_kind,
          access_subject_id,
          credential_scopes
        )
        VALUES (
          ${params.mailboxId}::uuid,
          ${prepared.kind},
          ${actor.kind},
          ${actorDatabaseId(actor)}::uuid,
          ${actor.kind === "service_account" ? actor.delegatedUserId : null}::uuid,
          ${prepared.idempotencyKey},
          ${requestHash},
          ${prepared.correlationId},
          ${prepared.target}::jsonb,
          ${prepared.payload}::jsonb,
          ${execution.data.bindingId}::uuid,
          ${execution.data.secretRevision},
          ${execution.data.rightsSnapshot}::jsonb,
          ${{ sentDelivery: execution.data.sentDelivery }}::jsonb,
          ${params.context.accessSubject.type},
          ${accessSubjectDatabaseId(params.context)}::uuid,
          ${toPgTextArray(params.context.actor.kind === "service_account" ? params.context.actor.scopes : [])}::text[]
        )
        RETURNING ${commandColumns}
      `;
      if (!row) throw new Error("Mail command insert returned no row");
      await createSendOutbox({
        db: tx,
        mailboxId: params.mailboxId,
        commandId: row.id,
        selectedBindingId: execution.data.bindingId,
        prepared,
      });
      await tx`
        INSERT INTO mail.activity_events (
          mailbox_id, command_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
        )
        VALUES (
          ${params.mailboxId}::uuid,
          ${row.id}::uuid,
          ${actor.kind},
          ${actorDatabaseId(actor)}::uuid,
          ${`command.${prepared.kind}`},
          'requested',
          'command',
          ${row.id}::uuid,
          ${{ selectedBindingId: execution.data.bindingId, correlationId: prepared.correlationId }}::jsonb
        )
      `;
      await audit.record(
        {
          action: `mail.command.${prepared.kind}.request`,
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "mailbox", id: params.mailboxId },
          requestId: params.context.requestId,
          metadata: { commandId: row.id, selectedBindingId: execution.data.bindingId, target: prepared.target },
        },
        tx,
      );
      return ok(mapCommand(row));
    });
    if (result.ok) await enqueueMailCommand(result.data.id, result.data.kind).catch(() => undefined);
    return result;
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to create mail command"));
  }
};

const stableTargetKey = (target: Record<string, unknown>): string => sha256Json(target);

export const getCommand = async (context: MailRequestContext, mailboxId: string, commandId: string): Promise<Result<MailCommand>> => {
  const access = await resolveMailExecution({ mailboxId, operation: "actorRead", context });
  if (!access.ok) return access;
  const [row] = await sql<DbCommand[]>`
    SELECT ${commandColumns}
    FROM mail.commands c
    WHERE c.id = ${commandId}::uuid AND c.mailbox_id = ${mailboxId}::uuid
  `;
  return row ? ok(mapCommand(row)) : fail(err.notFound("Mail command"));
};

export const listCommands = async (context: MailRequestContext, mailboxId: string, limit = 50): Promise<Result<MailCommand[]>> => {
  const access = await resolveMailExecution({ mailboxId, operation: "actorRead", context });
  if (!access.ok) return access;
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
  const rows = await sql<DbCommand[]>`
    SELECT ${commandColumns}
    FROM mail.commands c
    WHERE c.mailbox_id = ${mailboxId}::uuid
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ${boundedLimit}
  `;
  return ok(rows.map(mapCommand));
};
