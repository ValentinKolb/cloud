import { audit, logger } from "@valentinkolb/cloud/services";
import { err, fail, isServiceError, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { CreateConversationReferenceScheme, EnsureConversationReference, UpdateConversationReferenceScheme } from "../contracts";
import { requireMailboxPermission } from "./access";
import { actorRefFromRequest, auditActorFromRequest, type MailRequestContext } from "./auth";
import { requireMailboxCollaborationPermission } from "./collaboration";
import { publishMailCollaborationEvent, publishMailMailboxEvent } from "./events";

const REFERENCE_PATTERN_MAX_LENGTH = 120;
const REFERENCE_VALUE_MAX_LENGTH = 160;
const SEQUENCE_WIDTH_MIN = 1;
const SEQUENCE_WIDTH_MAX = 12;
const TOKEN_PATTERN = /\{([^{}]+)\}/gu;
const ALLOWED_LITERAL_PATTERN = /^[\p{L}\p{N} ._\-/]*$/u;

type SqlClient = typeof sql;
type ReferenceToken = { type: "literal"; value: string } | { type: "year" } | { type: "sequence"; width: number };
type ReferenceActor = { kind: "user" | "service_account" | "workflow"; id: string };
const log = logger("mail:conversation-references");

type ReferenceSchemeRow = {
  id: string;
  mailbox_id: string;
  name: string;
  pattern: string;
  next_sequence: string | number;
  enabled: boolean;
  is_default: boolean;
  revision: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

type ConversationReferenceRow = {
  id: string;
  mailbox_id: string;
  conversation_id: string;
  scheme_id: string;
  scheme_name: string;
  value: string;
  sequence: string | number;
  role: "primary" | "alias";
  allocated_by_actor_kind: ReferenceActor["kind"];
  allocated_by_actor_id: string;
  allocated_at: Date | string;
};

export type ConversationReferenceScheme = {
  id: string;
  mailboxId: string;
  name: string;
  pattern: string;
  nextSequence: string;
  enabled: boolean;
  isDefault: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ConversationReference = {
  id: string;
  mailboxId: string;
  conversationId: string;
  schemeId: string;
  schemeName: string;
  value: string;
  sequence: string;
  role: "primary" | "alias";
  allocatedBy: ReferenceActor;
  allocatedAt: string;
};

export type EnsureConversationReferenceResult = {
  reference: ConversationReference;
  conversationRevision: number;
  created: boolean;
};

const schemeColumns = sql`
  scheme.id, scheme.mailbox_id, scheme.name, scheme.pattern, scheme.next_sequence,
  scheme.enabled, scheme.is_default, scheme.revision, scheme.created_at, scheme.updated_at
`;
const referenceColumns = sql`
  reference.id, reference.mailbox_id, reference.conversation_id, reference.scheme_id,
  scheme.name AS scheme_name, reference.value, reference.sequence, reference.role,
  reference.allocated_by_actor_kind, reference.allocated_by_actor_id, reference.allocated_at
`;
const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const normalizeName = (value: string): string => value.trim().replace(/\s+/gu, " ");

const mapScheme = (row: ReferenceSchemeRow): ConversationReferenceScheme => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  name: row.name,
  pattern: row.pattern,
  nextSequence: String(row.next_sequence),
  enabled: row.enabled,
  isDefault: row.is_default,
  revision: Number(row.revision),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const mapReference = (row: ConversationReferenceRow): ConversationReference => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  conversationId: row.conversation_id,
  schemeId: row.scheme_id,
  schemeName: row.scheme_name,
  value: row.value,
  sequence: String(row.sequence),
  role: row.role,
  allocatedBy: { kind: row.allocated_by_actor_kind, id: row.allocated_by_actor_id },
  allocatedAt: toIso(row.allocated_at),
});

const requestActor = (context: MailRequestContext): ReferenceActor => {
  const actor = actorRefFromRequest(context);
  if (actor.kind === "user") return { kind: actor.kind, id: actor.userId };
  if (actor.kind === "service_account") return { kind: actor.kind, id: actor.serviceAccountId };
  throw new Error("Request actor cannot allocate conversation references");
};

const parseReferencePattern = (pattern: string): Result<ReferenceToken[]> => {
  const source = pattern.trim();
  if (source.length === 0 || source.length > REFERENCE_PATTERN_MAX_LENGTH) {
    return fail(err.badInput("Reference pattern must contain between 1 and 120 characters"));
  }

  const tokens: ReferenceToken[] = [];
  let offset = 0;
  let sequenceCount = 0;
  for (const match of source.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    const literal = source.slice(offset, index);
    if (!ALLOWED_LITERAL_PATTERN.test(literal)) return fail(err.badInput("Reference pattern contains unsupported characters"));
    if (literal) tokens.push({ type: "literal", value: literal });

    const value = match[1] ?? "";
    if (value === "year") {
      tokens.push({ type: "year" });
    } else {
      const sequence = /^sequence(?::([1-9]\d?))?$/u.exec(value);
      if (!sequence) return fail(err.badInput(`Unsupported reference token "{${value}}"`));
      const width = sequence[1] ? Number.parseInt(sequence[1], 10) : 1;
      if (width < SEQUENCE_WIDTH_MIN || width > SEQUENCE_WIDTH_MAX) {
        return fail(err.badInput(`Reference sequence width must be between ${SEQUENCE_WIDTH_MIN} and ${SEQUENCE_WIDTH_MAX}`));
      }
      tokens.push({ type: "sequence", width });
      sequenceCount += 1;
    }
    offset = index + match[0].length;
  }

  const suffix = source.slice(offset);
  if (!ALLOWED_LITERAL_PATTERN.test(suffix) || /[{}]/u.test(suffix)) {
    return fail(err.badInput("Reference pattern contains malformed or unsupported tokens"));
  }
  if (suffix) tokens.push({ type: "literal", value: suffix });
  if (sequenceCount !== 1) return fail(err.badInput("Reference pattern must contain exactly one sequence token"));
  return ok(tokens);
};

export const validateConversationReferencePattern = (pattern: string): Result<void> => {
  const parsed = parseReferencePattern(pattern);
  return parsed.ok ? ok() : parsed;
};

export const formatConversationReference = (params: { pattern: string; sequence: bigint; allocatedAt: Date }): Result<string> => {
  if (params.sequence < 1n) return fail(err.badInput("Reference sequence must be positive"));
  if (!Number.isFinite(params.allocatedAt.getTime())) return fail(err.badInput("Reference allocation date is invalid"));
  const parsed = parseReferencePattern(params.pattern);
  if (!parsed.ok) return parsed;

  const sequence = params.sequence.toString(10);
  const rendered = parsed.data
    .map((token) => {
      if (token.type === "literal") return token.value;
      if (token.type === "year") return params.allocatedAt.getUTCFullYear().toString(10).padStart(4, "0");
      return sequence.padStart(token.width, "0");
    })
    .join("");

  if (rendered.length > REFERENCE_VALUE_MAX_LENGTH) return fail(err.badInput("Rendered conversation reference is too long"));
  return ok(rendered);
};

const databaseCode = (error: unknown): string | null => {
  const candidate = error as { code?: unknown; errno?: unknown } | null;
  return typeof candidate?.code === "string" ? candidate.code : typeof candidate?.errno === "string" ? candidate.errno : null;
};

const failure = (error: unknown, fallback: string): Result<never> => {
  if (isServiceError(error)) return fail(error);
  if (databaseCode(error) === "23505") return fail(err.conflict("Conversation reference configuration changed concurrently"));
  return fail(err.internal(fallback));
};

const lockMailbox = async (
  context: MailRequestContext,
  mailboxId: string,
  permission: "write" | "admin",
  db: SqlClient,
): Promise<Result<void>> => {
  const [mailbox] = await db<{ id: string }[]>`
    SELECT id FROM mail.mailboxes
    WHERE id = ${mailboxId}::uuid AND deleted_at IS NULL
    FOR UPDATE
  `;
  if (!mailbox) return fail(err.notFound("Mailbox"));
  const allowed =
    permission === "write"
      ? await requireMailboxCollaborationPermission(context, mailboxId, "write", db)
      : await requireMailboxPermission(context, mailboxId, "admin", db);
  return allowed.ok ? ok() : allowed;
};

const insertActivity = async (params: {
  db: SqlClient;
  mailboxId: string;
  conversationId: string | null;
  actor: ReferenceActor;
  action: string;
  targetId: string;
  metadata: Record<string, unknown>;
}): Promise<string> => {
  const [activity] = await params.db<{ id: string | number }[]>`
    INSERT INTO mail.activity_events (
      mailbox_id, conversation_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
    ) VALUES (
      ${params.mailboxId}::uuid,
      ${params.conversationId}::uuid,
      ${params.actor.kind},
      ${params.actor.id}::uuid,
      ${params.action},
      'confirmed',
      ${params.conversationId ? "conversation_reference" : "reference_scheme"},
      ${params.targetId}::uuid,
      ${params.metadata}::jsonb
    )
    RETURNING id
  `;
  if (!activity) throw new Error("Conversation reference activity insert returned no row");
  return String(activity.id);
};

const demoteDefaultSchemes = async (params: {
  db: SqlClient;
  context: MailRequestContext;
  mailboxId: string;
  actor: ReferenceActor;
  exceptSchemeId?: string;
}): Promise<Array<{ targetId: string; activityId: string }>> => {
  const rows = await params.db<ReferenceSchemeRow[]>`
    UPDATE mail.reference_schemes scheme
    SET is_default = false, revision = revision + 1
    WHERE scheme.mailbox_id = ${params.mailboxId}::uuid
      AND scheme.is_default
      AND (${params.exceptSchemeId ?? null}::uuid IS NULL OR scheme.id <> ${params.exceptSchemeId ?? null}::uuid)
    RETURNING scheme.id, scheme.mailbox_id, scheme.name, scheme.pattern, scheme.next_sequence,
      scheme.enabled, scheme.is_default, scheme.revision, scheme.created_at, scheme.updated_at
  `;
  const activityEvents: Array<{ targetId: string; activityId: string }> = [];
  for (const row of rows) {
    const scheme = mapScheme(row);
    const activityId = await insertActivity({
      db: params.db,
      mailboxId: params.mailboxId,
      conversationId: null,
      actor: params.actor,
      action: "reference_scheme.updated",
      targetId: scheme.id,
      metadata: { name: scheme.name, enabled: scheme.enabled, isDefault: false, revision: scheme.revision, reason: "default_replaced" },
    });
    activityEvents.push({ targetId: scheme.id, activityId });
    await audit.record(
      {
        action: "mail.reference_scheme.update",
        outcome: "allowed",
        actor: auditActorFromRequest(params.context),
        target: { type: "reference_scheme", id: scheme.id, label: scheme.name },
        requestId: params.context.requestId,
        metadata: {
          mailboxId: params.mailboxId,
          enabled: scheme.enabled,
          isDefault: false,
          revision: scheme.revision,
          reason: "default_replaced",
        },
      },
      params.db,
    );
  }
  return activityEvents;
};

export const listConversationReferenceSchemes = async (
  context: MailRequestContext,
  mailboxId: string,
): Promise<Result<ConversationReferenceScheme[]>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<ReferenceSchemeRow[]>`
    SELECT ${schemeColumns}
    FROM mail.reference_schemes scheme
    WHERE scheme.mailbox_id = ${mailboxId}::uuid
    ORDER BY scheme.is_default DESC, scheme.enabled DESC, scheme.normalized_name, scheme.id
  `;
  return ok(rows.map(mapScheme));
};

export const createConversationReferenceScheme = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: CreateConversationReferenceScheme;
}): Promise<Result<ConversationReferenceScheme>> => {
  const pattern = params.input.pattern.trim();
  const validPattern = validateConversationReferencePattern(pattern);
  if (!validPattern.ok) return validPattern;
  const name = normalizeName(params.input.name);
  const actor = requestActor(params.context);
  try {
    const result = await sql.begin(
      async (
        tx,
      ): Promise<Result<{ scheme: ConversationReferenceScheme; activityEvents: Array<{ targetId: string; activityId: string }> }>> => {
        const allowed = await lockMailbox(params.context, params.mailboxId, "admin", tx);
        if (!allowed.ok) return allowed;
        const [count] = await tx<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM mail.reference_schemes WHERE mailbox_id = ${params.mailboxId}::uuid
      `;
        const makeDefault = params.input.makeDefault || count?.count === 0;
        const activityEvents = makeDefault
          ? await demoteDefaultSchemes({ db: tx, context: params.context, mailboxId: params.mailboxId, actor })
          : [];
        const [row] = await tx<ReferenceSchemeRow[]>`
        INSERT INTO mail.reference_schemes (
          mailbox_id, name, normalized_name, pattern, is_default, created_by_actor_kind, created_by_actor_id
        ) VALUES (
          ${params.mailboxId}::uuid,
          ${name},
          lower(regexp_replace(${name}, '\\s+', ' ', 'g')),
          ${pattern},
          ${makeDefault},
          ${actor.kind},
          ${actor.id}::uuid
        )
        RETURNING id, mailbox_id, name, pattern, next_sequence, enabled, is_default, revision, created_at, updated_at
      `;
        if (!row) throw new Error("Reference scheme insert returned no row");
        const scheme = mapScheme(row);
        const activityId = await insertActivity({
          db: tx,
          mailboxId: params.mailboxId,
          conversationId: null,
          actor,
          action: "reference_scheme.created",
          targetId: scheme.id,
          metadata: { name: scheme.name, pattern: scheme.pattern, isDefault: scheme.isDefault, revision: scheme.revision },
        });
        await audit.record(
          {
            action: "mail.reference_scheme.create",
            outcome: "allowed",
            actor: auditActorFromRequest(params.context),
            target: { type: "reference_scheme", id: scheme.id, label: scheme.name },
            requestId: params.context.requestId,
            metadata: { mailboxId: params.mailboxId, isDefault: scheme.isDefault, revision: scheme.revision },
          },
          tx,
        );
        return ok({ scheme, activityEvents: [...activityEvents, { targetId: scheme.id, activityId }] });
      },
    );
    if (!result.ok) return result;
    for (const event of result.data.activityEvents) {
      await publishMailMailboxEvent({
        mailboxId: params.mailboxId,
        conversationId: null,
        reason: "reference_scheme",
        targetId: event.targetId,
        activityId: event.activityId,
      });
    }
    return ok(result.data.scheme);
  } catch (error) {
    return failure(error, "Failed to create conversation reference scheme");
  }
};

export const updateConversationReferenceScheme = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  schemeId: string;
  input: UpdateConversationReferenceScheme;
}): Promise<Result<ConversationReferenceScheme>> => {
  const pattern = params.input.pattern?.trim();
  if (pattern !== undefined) {
    const validPattern = validateConversationReferencePattern(pattern);
    if (!validPattern.ok) return validPattern;
  }
  try {
    const result = await sql.begin(
      async (
        tx,
      ): Promise<Result<{ scheme: ConversationReferenceScheme; activityEvents: Array<{ targetId: string; activityId: string }> }>> => {
        const allowed = await lockMailbox(params.context, params.mailboxId, "admin", tx);
        if (!allowed.ok) return allowed;
        const [current] = await tx<ReferenceSchemeRow[]>`
        SELECT ${schemeColumns}
        FROM mail.reference_schemes scheme
        WHERE scheme.id = ${params.schemeId}::uuid AND scheme.mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
        if (!current) return fail(err.notFound("Conversation reference scheme"));
        if (Number(current.revision) !== params.input.expectedRevision) return fail(err.conflict("Reference scheme was changed"));
        const name = params.input.name === undefined ? current.name : normalizeName(params.input.name);
        const nextPattern = pattern ?? current.pattern;
        const enabled = params.input.enabled ?? current.enabled;
        const makeDefault = params.input.makeDefault ?? current.is_default;
        if (makeDefault && !enabled) return fail(err.badInput("A disabled reference scheme cannot be the default"));
        const actor = requestActor(params.context);
        const activityEvents = makeDefault
          ? await demoteDefaultSchemes({
              db: tx,
              context: params.context,
              mailboxId: params.mailboxId,
              actor,
              exceptSchemeId: params.schemeId,
            })
          : [];
        const changed =
          name !== current.name || nextPattern !== current.pattern || enabled !== current.enabled || makeDefault !== current.is_default;
        if (!changed) return ok({ scheme: mapScheme(current), activityEvents });
        const [updated] = await tx<ReferenceSchemeRow[]>`
        UPDATE mail.reference_schemes scheme
        SET
          name = ${name},
          normalized_name = lower(regexp_replace(${name}, '\\s+', ' ', 'g')),
          pattern = ${nextPattern},
          enabled = ${enabled},
          is_default = ${makeDefault},
          revision = revision + 1
        WHERE scheme.id = ${params.schemeId}::uuid
        RETURNING scheme.id, scheme.mailbox_id, scheme.name, scheme.pattern, scheme.next_sequence,
          scheme.enabled, scheme.is_default, scheme.revision, scheme.created_at, scheme.updated_at
      `;
        if (!updated) throw new Error("Reference scheme update returned no row");
        const scheme = mapScheme(updated);
        const activityId = await insertActivity({
          db: tx,
          mailboxId: params.mailboxId,
          conversationId: null,
          actor,
          action: "reference_scheme.updated",
          targetId: scheme.id,
          metadata: {
            name: scheme.name,
            pattern: scheme.pattern,
            enabled: scheme.enabled,
            isDefault: scheme.isDefault,
            revision: scheme.revision,
          },
        });
        await audit.record(
          {
            action: "mail.reference_scheme.update",
            outcome: "allowed",
            actor: auditActorFromRequest(params.context),
            target: { type: "reference_scheme", id: scheme.id, label: scheme.name },
            requestId: params.context.requestId,
            metadata: { mailboxId: params.mailboxId, enabled: scheme.enabled, isDefault: scheme.isDefault, revision: scheme.revision },
          },
          tx,
        );
        return ok({ scheme, activityEvents: [...activityEvents, { targetId: scheme.id, activityId }] });
      },
    );
    if (!result.ok) return result;
    for (const event of result.data.activityEvents) {
      await publishMailMailboxEvent({
        mailboxId: params.mailboxId,
        conversationId: null,
        reason: "reference_scheme",
        targetId: event.targetId,
        activityId: event.activityId,
      });
    }
    return ok(result.data.scheme);
  } catch (error) {
    return failure(error, "Failed to update conversation reference scheme");
  }
};

export const listConversationReferences = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
}): Promise<Result<ConversationReference[]>> => {
  const allowed = await requireMailboxCollaborationPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<ConversationReferenceRow[]>`
    SELECT ${referenceColumns}
    FROM mail.conversation_references reference
    JOIN mail.reference_schemes scheme ON scheme.id = reference.scheme_id
    WHERE reference.mailbox_id = ${params.mailboxId}::uuid
      AND reference.conversation_id = ${params.conversationId}::uuid
    ORDER BY reference.role = 'primary' DESC, reference.allocated_at, reference.id
  `;
  if (rows.length === 0) {
    const [conversation] = await sql<{ id: string }[]>`
      SELECT id FROM mail.conversations
      WHERE id = ${params.conversationId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
    `;
    if (!conversation) return fail(err.notFound("Conversation"));
  }
  return ok(rows.map(mapReference));
};

export const findConversationByReference = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  value: string;
}): Promise<Result<{ conversationId: string; reference: ConversationReference }>> => {
  const allowed = await requireMailboxCollaborationPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const [row] = await sql<ConversationReferenceRow[]>`
    SELECT ${referenceColumns}
    FROM mail.conversation_references reference
    JOIN mail.reference_schemes scheme ON scheme.id = reference.scheme_id
    WHERE reference.mailbox_id = ${params.mailboxId}::uuid
      AND reference.normalized_value = lower(btrim(${params.value}))
  `;
  return row ? ok({ conversationId: row.conversation_id, reference: mapReference(row) }) : fail(err.notFound("Conversation reference"));
};

export const ensureConversationReferenceInTransaction = async (params: {
  db: SqlClient;
  mailboxId: string;
  conversationId: string;
  schemeId?: string;
  idempotencyKey: string;
  actor: ReferenceActor;
}): Promise<Result<{ result: EnsureConversationReferenceResult; activityId: string | null }>> => {
  await params.db`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${params.mailboxId}:conversation-reference:${params.idempotencyKey}`}, 0)
    )
  `;
  const [replayed] = await params.db<
    (ConversationReferenceRow & {
      origin_conversation_id: string;
      requested_scheme_id: string;
      conversation_revision: string | number;
    })[]
  >`
    SELECT
      ${referenceColumns},
      request.origin_conversation_id,
      request.scheme_id AS requested_scheme_id,
      current_conversation.revision AS conversation_revision
    FROM mail.conversation_reference_requests request
    JOIN mail.conversation_references reference ON reference.id = request.reference_id
    JOIN mail.reference_schemes scheme ON scheme.id = reference.scheme_id
    JOIN mail.conversations current_conversation ON current_conversation.id = reference.conversation_id
    WHERE request.mailbox_id = ${params.mailboxId}::uuid
      AND request.idempotency_key = ${params.idempotencyKey}
  `;
  if (replayed) {
    if (
      replayed.origin_conversation_id !== params.conversationId ||
      (params.schemeId !== undefined && replayed.requested_scheme_id !== params.schemeId)
    ) {
      return fail(err.conflict("Conversation reference idempotency key was already used for another request"));
    }
    return ok({
      result: { reference: mapReference(replayed), conversationRevision: Number(replayed.conversation_revision), created: false },
      activityId: null,
    });
  }
  const [conversation] = await params.db<{ id: string; revision: string | number }[]>`
    SELECT id, revision
    FROM mail.conversations
    WHERE id = ${params.conversationId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
    FOR UPDATE
  `;
  if (!conversation) return fail(err.notFound("Conversation"));
  const [scheme] = await params.db<ReferenceSchemeRow[]>`
    SELECT ${schemeColumns}
    FROM mail.reference_schemes scheme
    WHERE scheme.mailbox_id = ${params.mailboxId}::uuid
      AND scheme.enabled
      AND (${params.schemeId ?? null}::uuid IS NULL OR scheme.id = ${params.schemeId ?? null}::uuid)
      AND (${params.schemeId ?? null}::uuid IS NOT NULL OR scheme.is_default)
    ORDER BY scheme.is_default DESC, scheme.id
    LIMIT 1
    FOR UPDATE
  `;
  if (!scheme) return fail(err.badInput(params.schemeId ? "Reference scheme is unavailable" : "No default reference scheme is configured"));
  const [existing] = await params.db<ConversationReferenceRow[]>`
    SELECT ${referenceColumns}
    FROM mail.conversation_references reference
    JOIN mail.reference_schemes scheme ON scheme.id = reference.scheme_id
    WHERE reference.conversation_id = ${params.conversationId}::uuid AND reference.scheme_id = ${scheme.id}::uuid
    ORDER BY reference.role = 'primary' DESC, reference.allocated_at, reference.id
    LIMIT 1
  `;
  if (existing) {
    await params.db`
      INSERT INTO mail.conversation_reference_requests (
        mailbox_id, idempotency_key, origin_conversation_id, scheme_id, reference_id
      ) VALUES (
        ${params.mailboxId}::uuid,
        ${params.idempotencyKey},
        ${params.conversationId}::uuid,
        ${scheme.id}::uuid,
        ${existing.id}::uuid
      )
    `;
    return ok({
      result: { reference: mapReference(existing), conversationRevision: Number(conversation.revision), created: false },
      activityId: null,
    });
  }

  const [clock] = await params.db<{ allocated_at: Date | string }[]>`
    SELECT transaction_timestamp() AS allocated_at
  `;
  if (!clock) throw new Error("Reference allocation clock returned no row");
  const allocatedAt = clock.allocated_at instanceof Date ? clock.allocated_at : new Date(clock.allocated_at);
  const [primary] = await params.db<{ id: string }[]>`
    SELECT id FROM mail.conversation_references
    WHERE conversation_id = ${params.conversationId}::uuid AND role = 'primary'
    FOR SHARE
  `;
  const role: ConversationReference["role"] = primary ? "alias" : "primary";
  let sequence = BigInt(scheme.next_sequence);
  let created: ConversationReferenceRow | undefined;
  for (let attempt = 0; attempt < 1_000 && !created; attempt += 1) {
    const rendered = formatConversationReference({ pattern: scheme.pattern, sequence, allocatedAt });
    if (!rendered.ok) return rendered;
    [created] = await params.db<ConversationReferenceRow[]>`
      INSERT INTO mail.conversation_references (
        mailbox_id, conversation_id, origin_conversation_id, scheme_id, scheme_revision,
        value, normalized_value, sequence, role, allocated_by_actor_kind, allocated_by_actor_id,
        idempotency_key, allocated_at
      ) VALUES (
        ${params.mailboxId}::uuid,
        ${params.conversationId}::uuid,
        ${params.conversationId}::uuid,
        ${scheme.id}::uuid,
        ${scheme.revision},
        ${rendered.data},
        lower(${rendered.data}),
        ${sequence.toString()},
        ${role},
        ${params.actor.kind},
        ${params.actor.id}::uuid,
        ${params.idempotencyKey},
        ${allocatedAt}
      )
      ON CONFLICT (mailbox_id, normalized_value) DO NOTHING
      RETURNING id, mailbox_id, conversation_id, scheme_id, ${scheme.name} AS scheme_name,
        value, sequence, role, allocated_by_actor_kind, allocated_by_actor_id, allocated_at
    `;
    sequence += 1n;
  }
  if (!created) return fail(err.conflict("Reference scheme overlaps too many existing values; change its pattern"));
  await params.db`
    INSERT INTO mail.conversation_reference_requests (
      mailbox_id, idempotency_key, origin_conversation_id, scheme_id, reference_id
    ) VALUES (
      ${params.mailboxId}::uuid,
      ${params.idempotencyKey},
      ${params.conversationId}::uuid,
      ${scheme.id}::uuid,
      ${created.id}::uuid
    )
  `;
  await params.db`
    UPDATE mail.reference_schemes
    SET next_sequence = ${sequence.toString()}
    WHERE id = ${scheme.id}::uuid
  `;
  const [updatedConversation] = await params.db<{ revision: string | number }[]>`
    UPDATE mail.conversations
    SET revision = revision + 1, updated_at = now()
    WHERE id = ${params.conversationId}::uuid
    RETURNING revision
  `;
  if (!updatedConversation) throw new Error("Conversation revision update returned no row");
  const reference = mapReference(created);
  const activityId = await insertActivity({
    db: params.db,
    mailboxId: params.mailboxId,
    conversationId: params.conversationId,
    actor: params.actor,
    action: "conversation.reference_allocated",
    targetId: reference.id,
    metadata: { value: reference.value, schemeId: reference.schemeId, role: reference.role, sequence: reference.sequence },
  });
  return ok({
    result: { reference, conversationRevision: Number(updatedConversation.revision), created: true },
    activityId,
  });
};

export const ensureConversationReference = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  input: EnsureConversationReference;
}): Promise<Result<EnsureConversationReferenceResult>> => {
  try {
    const result = await sql.begin(
      async (tx): Promise<Result<{ result: EnsureConversationReferenceResult; activityId: string | null }>> => {
        const allowed = await lockMailbox(params.context, params.mailboxId, "write", tx);
        if (!allowed.ok) return allowed;
        return ensureConversationReferenceInTransaction({
          db: tx,
          mailboxId: params.mailboxId,
          conversationId: params.conversationId,
          schemeId: params.input.schemeId,
          idempotencyKey: params.input.idempotencyKey,
          actor: requestActor(params.context),
        });
      },
    );
    if (!result.ok) return result;
    if (result.data.activityId) {
      await publishMailCollaborationEvent({
        mailboxId: params.mailboxId,
        conversationId: params.conversationId,
        reason: "reference",
        targetId: result.data.result.reference.id,
        activityId: result.data.activityId,
      });
    }
    return ok(result.data.result);
  } catch (error) {
    log.error("Failed to allocate conversation reference", {
      mailboxId: params.mailboxId,
      conversationId: params.conversationId,
      code: databaseCode(error),
      error: error instanceof Error ? error.message : String(error),
    });
    return failure(error, "Failed to allocate conversation reference");
  }
};

export const mergeConversationReferencesInTransaction = async (params: {
  db: SqlClient;
  mailboxId: string;
  targetConversationId: string;
  sourceConversationId: string;
}): Promise<{ moved: number; primaryValue: string | null }> => {
  const references = await params.db<{ id: string; conversation_id: string; value: string; role: "primary" | "alias" }[]>`
    SELECT id, conversation_id, value, role
    FROM mail.conversation_references
    WHERE mailbox_id = ${params.mailboxId}::uuid
      AND conversation_id IN (${params.targetConversationId}::uuid, ${params.sourceConversationId}::uuid)
    ORDER BY conversation_id, role = 'primary' DESC, allocated_at, id
    FOR UPDATE
  `;
  const targetPrimary = references.find(
    (reference) => reference.conversation_id === params.targetConversationId && reference.role === "primary",
  );
  const sourcePrimary = references.find(
    (reference) => reference.conversation_id === params.sourceConversationId && reference.role === "primary",
  );
  const primary = targetPrimary ?? sourcePrimary ?? null;
  const moved = await params.db<{ id: string }[]>`
    UPDATE mail.conversation_references
    SET
      conversation_id = ${params.targetConversationId}::uuid,
      role = CASE WHEN id = ${primary?.id ?? null}::uuid THEN 'primary' ELSE 'alias' END
    WHERE conversation_id = ${params.sourceConversationId}::uuid
    RETURNING id
  `;
  return { moved: moved.length, primaryValue: primary?.value ?? null };
};
