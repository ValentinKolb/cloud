import { audit, toPgTextArray } from "@valentinkolb/cloud/services";
import { err, fail, isServiceError, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import {
  type ActorCommandInput,
  type ActorRef,
  actorCommandInputSchema,
  type MailCommand,
  type MailCommandInput,
  type MaintenanceCommandInput,
  maintenanceCommandInputSchema,
} from "../contracts";
import { requireMailboxPermission } from "./access";
import { actorRefFromRequest, auditActorFromRequest, durableCredentialSnapshot, type MailRequestContext } from "./auth";
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
  result: Record<string, unknown> | string;
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
  c.result,
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
  result: parseRecord(row.result),
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
  expectedDraftRevision: number | null;
  scheduledAt: string | null;
  undoSeconds: number;
  requiredPermission: "write" | "admin";
};

type DraftForOutbox = {
  to_addresses: unknown;
  cc_addresses: unknown;
  bcc_addresses: unknown;
  subject: string;
  body_markdown: string;
  body_format: "plain" | "markdown";
  revision: string | number;
  intent: "new" | "reply" | "reply_all" | "forward";
  display_name: string;
  from_address: string;
  reply_to: string | null;
  envelope_sender: string | null;
  parent_message_id: string | null;
  reference_ids: string[] | null;
  attachments: unknown;
};

const actorDatabaseId = (actor: ActorRef): string | null => {
  if (actor.kind === "user") return actor.userId;
  if (actor.kind === "service_account") return actor.serviceAccountId;
  if (actor.kind === "workflow") return actor.workflowVersionId;
  return null;
};

const commandActorMatches = (command: DbCommand, actor: ActorRef): boolean =>
  command.actor_kind === actor.kind && command.actor_id === actorDatabaseId(actor);

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
    expectedDraftRevision: null,
    scheduledAt: null,
    undoSeconds: 0,
    requiredPermission: "write" as const,
  };
  if (input.kind === "set_flags") {
    return ok({
      ...base,
      target: {
        remoteMessageRefId: input.remoteMessageRefId,
        folderId: input.folderId,
        expectedRemoteState: input.expectedRemoteState,
      },
      payload: { flags: [...new Set(input.flags.map((flag) => flag.trim()))].sort() },
      folderRequirements: [{ folderId: input.folderId, rights: ["write_flags"] }],
      remoteMessageRefId: input.remoteMessageRefId,
      sourceFolderId: input.folderId,
    });
  }
  if (input.kind === "change_message_state") {
    return ok({
      ...base,
      target: {
        remoteMessageRefId: input.remoteMessageRefId,
        folderId: input.folderId,
        expectedRemoteState: input.expectedRemoteState,
      },
      payload: {
        addFlags: [...new Set(input.change.addFlags)].sort(),
        removeFlags: [...new Set(input.change.removeFlags)].sort(),
        addKeywords: [...new Set(input.change.addKeywords)].sort(),
        removeKeywords: [...new Set(input.change.removeKeywords)].sort(),
      },
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
        expectedRemoteState: input.expectedRemoteState,
      },
      payload: {},
      folderRequirements: [
        { folderId: input.sourceFolderId, rights: input.kind === "move" ? ["read", "move"] : ["read"] },
        { folderId: input.destinationFolderId, rights: ["insert"] },
      ],
      remoteMessageRefId: input.remoteMessageRefId,
      sourceFolderId: input.sourceFolderId,
    });
  }
  if (input.kind === "delete") {
    return ok({
      ...base,
      target: {
        remoteMessageRefId: input.remoteMessageRefId,
        folderId: input.folderId,
        expectedRemoteState: input.expectedRemoteState,
      },
      payload: { deleted: true },
      folderRequirements: [{ folderId: input.folderId, rights: ["delete_messages"] }],
      remoteMessageRefId: input.remoteMessageRefId,
      sourceFolderId: input.folderId,
    });
  }
  if (input.kind === "create_folder") {
    return ok({
      ...base,
      requiredPermission: "admin",
      target: { parentFolderId: input.parentFolderId ?? null },
      payload: { name: input.name, subscribe: input.subscribe },
      folderRequirements: input.parentFolderId ? [{ folderId: input.parentFolderId, rights: [] }] : [],
    });
  }
  if (input.kind === "rename_folder" || input.kind === "delete_folder" || input.kind === "set_folder_subscription") {
    return ok({
      ...base,
      requiredPermission: "admin",
      target: { folderId: input.folderId },
      payload:
        input.kind === "rename_folder"
          ? { name: input.name }
          : input.kind === "set_folder_subscription"
            ? { subscribed: input.subscribed }
            : {},
      folderRequirements: [{ folderId: input.folderId, rights: [] }],
      sourceFolderId: input.folderId,
    });
  }
  return ok({
    ...base,
    target: {
      draftId: input.draftId,
      expectedDraftRevision: input.expectedDraftRevision,
      senderIdentityId: input.senderIdentityId,
    },
    payload: { scheduledAt: input.scheduledAt ?? null, undoSeconds: input.undoSeconds },
    folderRequirements: [],
    senderIdentityId: input.senderIdentityId,
    draftId: input.draftId,
    expectedDraftRevision: input.expectedDraftRevision,
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
    const [draft] = await params.db<{ id: string; has_recipients: boolean; has_pending_attachments: boolean; revision: string | number }[]>`
      SELECT
        d.id,
        d.revision,
        jsonb_array_length(d.to_addresses)
          + jsonb_array_length(d.cc_addresses)
          + jsonb_array_length(d.bcc_addresses) > 0 AS has_recipients,
        EXISTS (
          SELECT 1
          FROM mail.draft_attachment_uploads upload
          WHERE upload.draft_id = d.id AND upload.state IN ('uploading', 'uploaded')
        ) AS has_pending_attachments
      FROM mail.drafts d
      JOIN mail.sender_identities si ON si.id = d.sender_identity_id
      WHERE d.id = ${params.prepared.draftId}::uuid
        AND d.mailbox_id = ${params.mailboxId}::uuid
        AND d.sender_identity_id = ${params.prepared.senderIdentityId}::uuid
        AND d.state = 'draft'
        AND si.status = 'verified'
      FOR UPDATE OF d
    `;
    if (!draft) return fail(err.badInput("Draft or sender identity is not ready for sending"));
    if (Number(draft.revision) !== params.prepared.expectedDraftRevision) {
      return fail({ code: "CONFLICT", message: "Draft changed before it could be sent", status: 409 });
    }
    if (draft.has_pending_attachments) {
      return fail({
        code: "CONFLICT",
        message: "Finish or cancel every attachment upload before sending the draft",
        status: 409,
      });
    }
    if (!draft.has_recipients) return fail(err.badInput("At least one recipient is required before sending"));
  }
  if (["create_folder", "rename_folder", "delete_folder", "set_folder_subscription"].includes(params.prepared.kind)) {
    const targetFolderId = (params.prepared.target.folderId ?? params.prepared.target.parentFolderId) as string | null | undefined;
    if (targetFolderId) {
      const [folder] = await params.db<{ id: string; role: string; discovery_state: string }[]>`
        SELECT folder.id, folder.role, folder.discovery_state
        FROM mail.folders folder
        JOIN mail.remote_resources resource ON resource.id = folder.remote_resource_id
        WHERE folder.id = ${targetFolderId}::uuid
          AND resource.mailbox_id = ${params.mailboxId}::uuid
      `;
      if (!folder) return fail(err.notFound("Mail folder"));
      if (folder.discovery_state !== "active") return fail(err.badInput("Only an active remote folder can be administered"));
      if (params.prepared.kind === "delete_folder" && ["inbox", "all"].includes(folder.role)) {
        return fail(err.badInput("Protected provider folders cannot be deleted"));
      }
    }
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
      d.intent,
      si.display_name,
      si.from_address,
      si.reply_to,
      si.envelope_sender,
      CASE WHEN d.intent IN ('reply', 'reply_all') THEN source.message_id ELSE NULL END AS parent_message_id,
      CASE WHEN d.intent IN ('reply', 'reply_all') THEN source.reference_ids ELSE ARRAY[]::text[] END AS reference_ids,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', attachment.id,
              'blobId', attachment.blob_id,
              'filename', attachment.filename,
              'contentType', attachment.content_type,
              'byteLength', attachment.byte_length,
              'contentHash', attachment.content_hash
            ) ORDER BY attachment.position, attachment.id
          )
          FROM mail.draft_attachments attachment
          WHERE attachment.draft_id = d.id AND attachment.removed_at IS NULL
        ),
        '[]'::jsonb
      ) AS attachments
    FROM mail.drafts d
    JOIN mail.sender_identities si ON si.id = d.sender_identity_id
    LEFT JOIN mail.message_contents source ON source.id = d.source_message_id
    WHERE d.id = ${prepared.draftId}::uuid
      AND d.mailbox_id = ${params.mailboxId}::uuid
      AND d.sender_identity_id = ${prepared.senderIdentityId}::uuid
      AND d.revision = ${prepared.expectedDraftRevision}
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
        attachments: draft.attachments,
      }}::jsonb
    )
  `;
  await params.db`
    UPDATE mail.drafts
    SET state = 'scheduled'
    WHERE id = ${prepared.draftId}::uuid
  `;
};

type CreateActorCommandParams = {
  context: MailRequestContext;
  mailboxId: string;
  input: ActorCommandInput;
  enqueue?: boolean;
};

type CreateActorCommandInternalParams = Omit<CreateActorCommandParams, "context"> & {
  context: MailRequestContext | null;
  actorOverride?: ActorRef;
  beforeCreate?: (tx: typeof sql) => Promise<void>;
  afterCreate?: (tx: typeof sql, command: MailCommand) => Promise<void>;
};

const createActorCommandInTransaction = async (params: CreateActorCommandInternalParams, tx: typeof sql): Promise<Result<MailCommand>> => {
  const parsed = actorCommandInputSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid mail command"));
  const preparedResult = prepareActorCommand(parsed.data);
  if (!preparedResult.ok) return preparedResult;
  const prepared = preparedResult.data;
  const requestHash = sha256Json({ kind: prepared.kind, target: prepared.target, payload: prepared.payload });
  if (!params.context && params.actorOverride?.kind !== "workflow") {
    return fail(err.forbidden("Only an activated workflow may create a mailbox-owned command"));
  }
  const initiator = params.context ? actorRefFromRequest(params.context) : null;
  const actor = params.actorOverride ?? initiator;
  if (!actor) return fail(err.unauthenticated());
  const credential = params.context
    ? durableCredentialSnapshot(params.context)
    : { scopes: [], credentialId: null, credentialExpiresAt: null };
  if (!credential) return fail(err.forbidden("Durable Mail work requires a current service credential"));

  const [mailbox] = await tx<{ id: string }[]>`
    SELECT id FROM mail.mailboxes WHERE id = ${params.mailboxId}::uuid AND deleted_at IS NULL FOR UPDATE
  `;
  if (!mailbox) return fail(err.notFound("Mailbox"));
  if (params.context) {
    const permission = await requireMailboxPermission(params.context, params.mailboxId, prepared.requiredPermission, tx);
    if (!permission.ok) return permission;
  }
  await params.beforeCreate?.(tx);
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${params.mailboxId}:${prepared.kind}:${stableTargetKey(prepared.target)}`}, 0))`;

  const [existing] = await tx<DbCommand[]>`
    SELECT ${commandColumns}
    FROM mail.commands c
    WHERE c.mailbox_id = ${params.mailboxId}::uuid AND c.idempotency_key = ${prepared.idempotencyKey}
    FOR UPDATE
  `;
  if (existing) {
    if (!commandActorMatches(existing, actor)) return fail(err.conflict("Idempotency key is already in use"));
    return existing.request_hash === requestHash
      ? ok(mapCommand(existing))
      : fail(err.conflict("Idempotency key with a different mail command"));
  }

  const targets = await validateCommandTargets({ mailboxId: params.mailboxId, prepared, db: tx });
  if (!targets.ok) return targets;
  const execution = await resolveMailExecution({
    mailboxId: params.mailboxId,
    operation: params.context ? (prepared.kind === "send" ? "actorSend" : "actorMutation") : "automation",
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
      initiator_actor_kind,
      initiator_actor_id,
      access_subject_kind,
      access_subject_id,
      credential_scopes,
      credential_id,
      credential_expires_at
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
      ${initiator?.kind ?? null},
      ${initiator ? actorDatabaseId(initiator) : null}::uuid,
      ${params.context?.accessSubject.type ?? "system"},
      ${params.context ? accessSubjectDatabaseId(params.context) : null}::uuid,
      ${toPgTextArray(credential.scopes)}::text[],
      ${credential.credentialId}::uuid,
      ${credential.credentialExpiresAt}::timestamptz
    )
    RETURNING ${commandColumns}
  `;
  if (!row) throw new Error("Mail command insert returned no row");
  const command = mapCommand(row);
  await params.afterCreate?.(tx, command);
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
      actor: params.context ? auditActorFromRequest(params.context) : null,
      target: { type: "mailbox", id: params.mailboxId },
      requestId: params.context?.requestId ?? `mail-workflow:${actor.kind === "workflow" ? actor.workflowVersionId : row.id}`,
      metadata: {
        commandId: row.id,
        selectedBindingId: execution.data.bindingId,
        target: prepared.target,
        workflowVersionId: actor.kind === "workflow" ? actor.workflowVersionId : null,
      },
    },
    tx,
  );
  return ok(command);
};

const enqueueActorCommands = async (commands: MailCommand[]): Promise<void> => {
  await Promise.all(commands.map((command) => enqueueMailCommand(command.id, command.kind).catch(() => undefined)));
};

const createActorCommandWithActor = async (params: CreateActorCommandInternalParams): Promise<Result<MailCommand>> => {
  try {
    const result = await sql.begin((tx) => createActorCommandInTransaction(params, tx));
    if (result.ok && params.enqueue !== false) await enqueueMailCommand(result.data.id, result.data.kind).catch(() => undefined);
    return result;
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to create mail command"));
  }
};

export const createActorCommand = (params: CreateActorCommandParams): Promise<Result<MailCommand>> => createActorCommandWithActor(params);

export const createWorkflowCommand = (params: {
  context: MailRequestContext | null;
  mailboxId: string;
  workflowVersionId: string;
  input: ActorCommandInput;
  enqueue?: boolean;
  beforeCreate?: (tx: typeof sql) => Promise<void>;
  afterCreate?: (tx: typeof sql, command: MailCommand) => Promise<void>;
}): Promise<Result<MailCommand>> =>
  createActorCommandWithActor({
    ...params,
    actorOverride: { kind: "workflow", workflowVersionId: params.workflowVersionId },
  });

export const createActorCommands = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  inputs: ActorCommandInput[];
}): Promise<Result<MailCommand[]>> => {
  try {
    const result = await sql.begin(async (tx) => {
      const commands: MailCommand[] = [];
      for (const input of params.inputs) {
        const command = await createActorCommandInTransaction(
          { context: params.context, mailboxId: params.mailboxId, input, enqueue: false },
          tx,
        );
        if (!command.ok) throw command.error;
        commands.push(command.data);
      }
      return ok(commands);
    });
    if (result.ok) await enqueueActorCommands(result.data);
    return result;
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to create mail commands"));
  }
};

const stableTargetKey = (target: Record<string, unknown>): string => sha256Json(target);

const prepareMaintenanceCommand = (
  input: MaintenanceCommandInput,
): { target: Record<string, unknown>; payload: Record<string, unknown> } => {
  if (input.kind === "sync_folder" || input.kind === "rebuild_folder") {
    return { target: { folderId: input.folderId }, payload: {} };
  }
  if (input.kind === "verify_binding") return { target: { bindingId: input.bindingId }, payload: { allowCredentialRevision: true } };
  if (input.kind === "discover_folders") return { target: { bindingId: input.bindingId ?? null }, payload: {} };
  return { target: {}, payload: {} };
};

const validateMaintenanceTarget = async (params: {
  db: typeof sql;
  mailboxId: string;
  input: MaintenanceCommandInput;
}): Promise<Result<void>> => {
  if (params.input.kind === "sync_folder" || params.input.kind === "rebuild_folder") {
    const [folder] = await params.db<{ selected_for_sync: boolean; discovery_state: string }[]>`
      SELECT folder.selected_for_sync, folder.discovery_state
      FROM mail.folders folder
      JOIN mail.remote_resources resource ON resource.id = folder.remote_resource_id
      WHERE folder.id = ${params.input.folderId}::uuid
        AND resource.mailbox_id = ${params.mailboxId}::uuid
    `;
    if (!folder) return fail(err.notFound("Mail folder"));
    if (folder.discovery_state !== "active") return fail(err.badInput("Only an active remote folder can be synchronized or rebuilt"));
    if (params.input.kind === "sync_folder" && !folder.selected_for_sync) {
      return fail(err.badInput("The folder is excluded from synchronization"));
    }
  }
  const bindingId =
    params.input.kind === "verify_binding" || (params.input.kind === "discover_folders" && params.input.bindingId)
      ? params.input.bindingId
      : null;
  if (bindingId) {
    const [binding] = await params.db<{ id: string }[]>`
      SELECT binding.id
      FROM mail.provider_bindings binding
      JOIN mail.remote_resources resource ON resource.id = binding.remote_resource_id
      WHERE binding.id = ${bindingId}::uuid
        AND resource.mailbox_id = ${params.mailboxId}::uuid
        AND (
          binding.state IN ('active', 'degraded')
          OR (${params.input.kind === "verify_binding"} AND binding.state = 'pending')
        )
    `;
    if (!binding) return fail(err.notFound("Provider binding"));
  }
  return ok();
};

export const createMaintenanceCommand = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: MaintenanceCommandInput;
  enqueue?: boolean;
}): Promise<Result<MailCommand>> => {
  const parsed = maintenanceCommandInputSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid mail maintenance command"));
  const input = parsed.data;
  const prepared = prepareMaintenanceCommand(input);
  const requestHash = sha256Json({ kind: input.kind, target: prepared.target, payload: prepared.payload });
  const actor = actorRefFromRequest(params.context);
  const credential = durableCredentialSnapshot(params.context);
  if (!credential) return fail(err.forbidden("Durable Mail work requires a current service credential"));

  try {
    const result = await sql.begin(async (tx) => {
      const [mailbox] = await tx<{ id: string }[]>`
        SELECT id FROM mail.mailboxes WHERE id = ${params.mailboxId}::uuid AND deleted_at IS NULL FOR UPDATE
      `;
      if (!mailbox) return fail(err.notFound("Mailbox"));
      const permission = await requireMailboxPermission(params.context, params.mailboxId, "admin", tx);
      if (!permission.ok) return permission;

      const [existing] = await tx<DbCommand[]>`
        SELECT ${commandColumns}
        FROM mail.commands c
        WHERE c.mailbox_id = ${params.mailboxId}::uuid AND c.idempotency_key = ${input.idempotencyKey.trim()}
        FOR UPDATE
      `;
      if (existing) {
        if (!commandActorMatches(existing, actor)) return fail(err.conflict("Idempotency key is already in use"));
        return existing.request_hash === requestHash
          ? ok(mapCommand(existing))
          : fail(err.conflict("Idempotency key with a different mail command"));
      }
      const target = await validateMaintenanceTarget({ db: tx, mailboxId: params.mailboxId, input });
      if (!target.ok) return target;

      const [row] = await tx<DbCommand[]>`
        INSERT INTO mail.commands AS c (
          mailbox_id, kind, actor_kind, actor_id, delegated_user_id, idempotency_key,
          request_hash, correlation_id, target, payload, transport_metadata,
          initiator_actor_kind, initiator_actor_id,
          access_subject_kind, access_subject_id, credential_scopes, credential_id, credential_expires_at
        )
        VALUES (
          ${params.mailboxId}::uuid,
          ${input.kind},
          ${actor.kind},
          ${actorDatabaseId(actor)}::uuid,
          ${actor.kind === "service_account" ? actor.delegatedUserId : null}::uuid,
          ${input.idempotencyKey.trim()},
          ${requestHash},
          ${input.correlationId?.trim() || null},
          ${prepared.target}::jsonb,
          ${prepared.payload}::jsonb,
          '{}'::jsonb,
          ${actor.kind},
          ${actorDatabaseId(actor)}::uuid,
          ${params.context.accessSubject.type},
          ${accessSubjectDatabaseId(params.context)}::uuid,
          ${toPgTextArray(credential.scopes)}::text[],
          ${credential.credentialId}::uuid,
          ${credential.credentialExpiresAt}::timestamptz
        )
        RETURNING ${commandColumns}
      `;
      if (!row) throw new Error("Mail maintenance command insert returned no row");
      await tx`
        INSERT INTO mail.activity_events (
          mailbox_id, command_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
        )
        VALUES (
          ${params.mailboxId}::uuid,
          ${row.id}::uuid,
          ${actor.kind},
          ${actorDatabaseId(actor)}::uuid,
          ${`command.${input.kind}`},
          'requested',
          'command',
          ${row.id}::uuid,
          ${{ correlationId: input.correlationId ?? null }}::jsonb
        )
      `;
      await audit.record(
        {
          action: `mail.maintenance.${input.kind}.request`,
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "mailbox", id: params.mailboxId },
          requestId: params.context.requestId,
          metadata: { commandId: row.id, target: prepared.target },
        },
        tx,
      );
      return ok(mapCommand(row));
    });
    if (result.ok && params.enqueue !== false) await enqueueMailCommand(result.data.id, result.data.kind).catch(() => undefined);
    return result;
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to create mail maintenance command"));
  }
};

export const createMailCommand = (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: MailCommandInput;
  enqueue?: boolean;
}): Promise<Result<MailCommand>> => {
  const maintenance = maintenanceCommandInputSchema.safeParse(params.input);
  return maintenance.success
    ? createMaintenanceCommand({ ...params, input: maintenance.data })
    : createActorCommand({ ...params, input: params.input as ActorCommandInput });
};

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
