import { audit, toPgTextArray, toPgUuidArray } from "@valentinkolb/cloud/services";
import type { WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { emitWorkflowEvent } from "@valentinkolb/cloud/workflows/store";
import { err, fail, isServiceError, ok, type Result, unwrap } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { stringify } from "yaml";
import {
  type ApplySenderRuleToExistingInput,
  type ApplySenderRuleToExistingResult,
  applySenderRuleToExistingInputSchema,
  type CreateSenderRule,
  createSenderRuleSchema,
  type DeleteSenderRule,
  deleteSenderRuleSchema,
  type MailCommand,
  type MarkSenderMessagesReadInput,
  type MarkSenderMessagesReadResult,
  markSenderMessagesReadInputSchema,
  type PreviewSenderRuleMatchesInput,
  previewSenderRuleMatchesInputSchema,
  type SenderRuleAction,
  type SenderRuleMatchKind,
  type SenderRuleMatchPreview,
  type SetSenderRuleEnabled,
  setSenderRuleEnabledSchema,
  type UpdateSenderRule,
  updateSenderRuleSchema,
  type WorkflowEffectBudget,
} from "../contracts";
import { MAIL_WORKFLOW_APP_ID, MAIL_WORKFLOW_EVENT } from "../workflows/events";
import { requireMailboxPermission } from "./access";
import { normalizeEmailAddress, normalizeEmailDomain } from "./address-normalization";
import { actorRefFromRequest, auditActorFromRequest, type MailRequestContext } from "./auth";
import { sha256Json } from "./canonical";
import { createActorCommandsInTransaction, enqueueCreatedActorCommands } from "./commands";
import { databaseErrorCode } from "./database-errors";
import { publishMailMailboxEvent } from "./events";
import type { SqlClient } from "./workflow-data";
import { getWorkflowSnapshots, mailWorkflowEventContext } from "./workflow-data";
import { replaceManagedWorkflowInTransaction, setManagedWorkflowEnabledInTransaction } from "./workflow-definition-service";

export type SenderRule = {
  id: string;
  mailboxId: string;
  workflowId: string;
  workflowVersionId: string;
  name: string;
  enabled: boolean;
  matchKind: SenderRuleMatchKind;
  matchValue: string;
  action: SenderRuleAction;
  workflowSource: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

type SenderRuleRow = {
  id: string;
  mailbox_id: string;
  workflow_id: string;
  workflow_version_id: string;
  name: string;
  enabled: boolean;
  match_kind: SenderRuleMatchKind;
  match_value: string;
  action: SenderRuleAction | string;
  workflow_source: string;
  revision: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

type RuleActor = { kind: "user" | "service_account"; id: string };

const senderRuleColumns = sql`
  rule.id,
  rule.mailbox_id,
  rule.workflow_id,
  (
    SELECT workflow.active_version_id
    FROM workflows.workflow workflow
    WHERE workflow.id = rule.workflow_id
  ) AS workflow_version_id,
  rule.name,
  rule.enabled,
  rule.match_kind,
  rule.match_value,
  rule.action,
  (
    SELECT version.source
    FROM workflows.workflow workflow
    JOIN workflows.version version ON version.id = workflow.active_version_id
    WHERE workflow.id = rule.workflow_id
  ) AS workflow_source,
  rule.revision,
  rule.created_at,
  rule.updated_at
`;

const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const normalizeName = (value: string): string => value.trim().replace(/\s+/gu, " ");
const parseJson = <T>(value: T | string): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);
const internalWorkflowName = (id: string): string => `Sender rule ${id}`;
const EXISTING_MESSAGE_APPLICATION_LIMIT = 100;
const EXISTING_MESSAGE_APPLICATION_BYTES = 8 * 1024 * 1024;
const MAX_SENDER_RULES = 500;
const isSameOrSubdomain = (candidate: string, domain: string): boolean => candidate === domain || candidate.endsWith(`.${domain}`);
const senderRuleExistingDedupePrefix = (ruleId: string, workflowVersionId: string): string =>
  `sender-rule-existing:${ruleId}:v${workflowVersionId}:`;
export const senderRuleExistingDedupeKey = (ruleId: string, workflowVersionId: string, targetKey: string): string =>
  `${senderRuleExistingDedupePrefix(ruleId, workflowVersionId)}${targetKey}`;

const requestActor = (context: MailRequestContext): RuleActor => {
  const actor = actorRefFromRequest(context);
  if (actor.kind === "user") return { kind: actor.kind, id: actor.userId };
  if (actor.kind === "service_account") return { kind: actor.kind, id: actor.serviceAccountId };
  throw new TypeError("Request actor cannot configure sender rules");
};

const mapSenderRule = (row: SenderRuleRow): SenderRule => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  workflowId: row.workflow_id,
  workflowVersionId: row.workflow_version_id,
  name: row.name,
  enabled: row.enabled,
  matchKind: row.match_kind,
  matchValue: row.match_value,
  action: parseJson(row.action),
  workflowSource: row.workflow_source,
  revision: Number(row.revision),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const workflowBudget = (action: SenderRuleAction): WorkflowEffectBudget => ({
  maxTargets: 50_000,
  maxMoves: action.kind === "junk" || action.kind === "trash" ? 50_000 : 0,
  maxCopies: 0,
  maxSends: 0,
  maxDrafts: 0,
  maxFlagChanges: action.kind === "mark_read" ? 50_000 : 0,
  maxNotifications: 0,
  maxKeywordChanges: action.kind === "add_keyword" ? 50_000 : 0,
  maxCollaborationChanges: 0,
});

const workflowAction = (action: SenderRuleAction): Record<string, unknown> => {
  if (action.kind === "junk") return { junkMessage: { message: "${{ inputs.message }}" } };
  if (action.kind === "trash") return { trashMessage: { message: "${{ inputs.message }}" } };
  if (action.kind === "mark_read") {
    return { addFlag: { message: "${{ inputs.message }}", flag: "seen" } };
  }
  return { addKeyword: { message: "${{ inputs.message }}", keyword: action.keyword } };
};

export const buildSenderRuleWorkflowSource = (params: {
  matchKind: SenderRuleMatchKind;
  matchValue: string;
  action: SenderRuleAction;
}): string =>
  stringify(
    {
      inputs: {
        message: { type: "mailMessage", required: true },
        conversation: { type: "mailConversation", required: false },
      },
      triggers: {
        messageReceived: {
          with: {
            message: "${{ trigger.message }}",
            conversation: "${{ trigger.conversation }}",
          },
        },
      },
      steps: [
        {
          if: {
            equals: [
              params.matchKind === "sender" ? "${{ inputs.message.fromAddress }}" : "${{ inputs.message.fromDomain }}",
              params.matchValue,
            ],
          },
          then: [workflowAction(params.action)],
        },
      ],
    },
    { lineWidth: 0 },
  );

const normalizeRuleMatch = (kind: SenderRuleMatchKind, value: string): Result<string> => {
  const normalized = kind === "sender" ? normalizeEmailAddress(value) : normalizeEmailDomain(value);
  if (!normalized) return fail(err.badInput(kind === "sender" ? "Enter a valid sender email address" : "Enter a valid sender domain"));
  if (kind === "domain" && !normalized.includes(".")) {
    return fail(err.badInput("Enter a complete sender domain, for example example.com"));
  }
  return ok(normalized);
};

const senderRuleMatchSql = (kind: SenderRuleMatchKind, value: string) =>
  kind === "sender" ? sql`sender.normalized_email = ${value}` : sql`split_part(sender.normalized_email, '@', 2) = ${value}`;

const senderRuleTargetFrom = sql`
  FROM mail.remote_message_refs remote_ref
  JOIN mail.message_placements placement
    ON placement.remote_message_ref_id = remote_ref.id
   AND placement.deleted_at IS NULL
  JOIN mail.folders folder
    ON folder.id = placement.folder_id
   AND folder.discovery_state = 'active'
  JOIN mail.remote_resources resource
    ON resource.id = folder.remote_resource_id
  JOIN mail.message_contents message
    ON message.id = remote_ref.message_id
  JOIN mail.message_addresses sender
    ON sender.message_id = message.id
   AND sender.role = 'from'
  LEFT JOIN mail.conversation_messages conversation_message
    ON conversation_message.message_id = message.id
`;

const inboundSenderRuleTarget = sql`
  NOT EXISTS (
    SELECT 1
    FROM mail.sender_identities identity
    WHERE identity.mailbox_id = resource.mailbox_id
      AND lower(identity.from_address) = sender.normalized_email
      AND identity.status <> 'disabled'
  )
`;

const normalizePreviewMatch = (input: PreviewSenderRuleMatchesInput): Result<{ matchKind: SenderRuleMatchKind; matchValue: string }> => {
  const parsed = previewSenderRuleMatchesInputSchema.safeParse(input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid sender rule match"));
  const normalized = normalizeRuleMatch(parsed.data.matchKind, parsed.data.matchValue);
  return normalized.ok ? ok({ matchKind: parsed.data.matchKind, matchValue: normalized.data }) : normalized;
};

const protectMailboxSenders = async (params: {
  mailboxId: string;
  matchKind: SenderRuleMatchKind;
  matchValue: string;
  action: SenderRuleAction;
  db: SqlClient;
}): Promise<Result<void>> => {
  if (params.action.kind !== "junk" && params.action.kind !== "trash") return ok();
  const [mailbox] = await params.db<{ compose_safety: { internalDomains?: unknown } | string }[]>`
    SELECT compose_safety
    FROM mail.mailboxes
    WHERE id = ${params.mailboxId}::uuid AND deleted_at IS NULL
  `;
  const identities = await params.db<{ from_address: string }[]>`
    SELECT from_address
    FROM mail.sender_identities
    WHERE mailbox_id = ${params.mailboxId}::uuid
  `;
  const composeSafety = mailbox ? parseJson(mailbox.compose_safety) : {};
  const internalDomains = new Set(
    (Array.isArray(composeSafety.internalDomains) ? composeSafety.internalDomains : [])
      .flatMap((value) => (typeof value === "string" ? [normalizeEmailDomain(value)] : []))
      .filter((value): value is string => Boolean(value)),
  );
  const identityAddresses = new Set(
    identities.map((identity) => normalizeEmailAddress(identity.from_address)).filter((value): value is string => Boolean(value)),
  );
  const identityDomains = new Set(
    [...identityAddresses]
      .map((address) => normalizeEmailDomain(address.slice(address.lastIndexOf("@") + 1)))
      .filter((value): value is string => Boolean(value)),
  );
  const protectedMatch =
    params.matchKind === "sender"
      ? identityAddresses.has(params.matchValue) ||
        [...internalDomains].some((domain) => isSameOrSubdomain(params.matchValue.slice(params.matchValue.lastIndexOf("@") + 1), domain))
      : [...identityDomains, ...internalDomains].some(
          (domain) => isSameOrSubdomain(params.matchValue, domain) || isSameOrSubdomain(domain, params.matchValue),
        );
  return protectedMatch ? fail(err.badInput("Mailbox identities and internal domains cannot be routed to junk or trash")) : ok();
};

const destructiveAction = (action: SenderRuleAction): action is Extract<SenderRuleAction, { kind: "junk" | "trash" }> =>
  action.kind === "junk" || action.kind === "trash";

const matchesOverlap = (
  left: { matchKind: SenderRuleMatchKind; matchValue: string },
  right: { matchKind: SenderRuleMatchKind; matchValue: string },
): boolean => {
  if (left.matchKind === right.matchKind) return left.matchValue === right.matchValue;
  const sender = left.matchKind === "sender" ? left.matchValue : right.matchValue;
  const domain = left.matchKind === "domain" ? left.matchValue : right.matchValue;
  return sender.slice(sender.lastIndexOf("@") + 1) === domain;
};

const protectAgainstConflictingRules = async (params: {
  mailboxId: string;
  ruleId?: string;
  enabled: boolean;
  matchKind: SenderRuleMatchKind;
  matchValue: string;
  action: SenderRuleAction;
  db: SqlClient;
}): Promise<Result<void>> => {
  if (!params.enabled || !destructiveAction(params.action)) return ok();
  const rows = await params.db<
    Array<{
      id: string;
      name: string;
      match_kind: SenderRuleMatchKind;
      match_value: string;
      action: SenderRuleAction | string;
    }>
  >`
    SELECT id, name, match_kind, match_value, action
    FROM mail.sender_rules
    WHERE mailbox_id = ${params.mailboxId}::uuid
      AND deleted_at IS NULL
      AND enabled = true
      AND action->>'kind' IN ('junk', 'trash')
      AND (${params.ruleId ?? null}::uuid IS NULL OR id <> ${params.ruleId ?? null}::uuid)
    FOR UPDATE
  `;
  const conflict = rows.find((row) => {
    const action = parseJson<SenderRuleAction>(row.action);
    return (
      destructiveAction(action) &&
      action.kind !== params.action.kind &&
      matchesOverlap(
        { matchKind: params.matchKind, matchValue: params.matchValue },
        { matchKind: row.match_kind, matchValue: row.match_value },
      )
    );
  });
  return conflict ? fail(err.conflict(`Sender rule conflicts with “${conflict.name}”`)) : ok();
};

export const validateDestructiveSenderRulesForMailbox = async (params: {
  mailboxId: string;
  internalDomains?: readonly string[];
  identityAddresses?: readonly string[];
  db: SqlClient;
}): Promise<Result<void>> => {
  const [mailbox] = await params.db<{ compose_safety: { internalDomains?: unknown } | string }[]>`
    SELECT compose_safety FROM mail.mailboxes WHERE id = ${params.mailboxId}::uuid AND deleted_at IS NULL
  `;
  if (!mailbox) return fail(err.notFound("Mailbox"));
  const identityRows =
    params.identityAddresses === undefined
      ? await params.db<{ from_address: string }[]>`
          SELECT from_address FROM mail.sender_identities
          WHERE mailbox_id = ${params.mailboxId}::uuid AND status <> 'disabled'
        `
      : params.identityAddresses.map((from_address) => ({ from_address }));
  const configuredSafety = parseJson(mailbox.compose_safety);
  const internalDomains = new Set(
    (params.internalDomains ?? (Array.isArray(configuredSafety.internalDomains) ? configuredSafety.internalDomains : []))
      .flatMap((value) => (typeof value === "string" ? [normalizeEmailDomain(value)] : []))
      .filter((value): value is string => Boolean(value)),
  );
  const identityAddresses = new Set(
    identityRows.map((identity) => normalizeEmailAddress(identity.from_address)).filter((value): value is string => Boolean(value)),
  );
  const identityDomains = new Set(
    [...identityAddresses]
      .map((address) => normalizeEmailDomain(address.slice(address.lastIndexOf("@") + 1)))
      .filter((value): value is string => Boolean(value)),
  );
  const rules = await params.db<
    Array<{ id: string; name: string; match_kind: SenderRuleMatchKind; match_value: string; action: SenderRuleAction | string }>
  >`
    SELECT id, name, match_kind, match_value, action
    FROM mail.sender_rules
    WHERE mailbox_id = ${params.mailboxId}::uuid
      AND deleted_at IS NULL
      AND enabled = true
      AND action->>'kind' IN ('junk', 'trash')
    FOR UPDATE
  `;
  const unsafe = rules.find((rule) => {
    const protectedMatch =
      rule.match_kind === "sender"
        ? identityAddresses.has(rule.match_value) ||
          [...internalDomains].some((domain) => isSameOrSubdomain(rule.match_value.slice(rule.match_value.lastIndexOf("@") + 1), domain))
        : [...identityDomains, ...internalDomains].some(
            (domain) => isSameOrSubdomain(rule.match_value, domain) || isSameOrSubdomain(domain, rule.match_value),
          );
    return protectedMatch;
  });
  return unsafe ? fail(err.conflict(`Sender rule “${unsafe.name}” must be changed before updating mailbox sender safety`)) : ok();
};

const lockMailbox = async (context: MailRequestContext, mailboxId: string, db: SqlClient): Promise<Result<void>> => {
  const [mailbox] = await db<{ id: string }[]>`
    SELECT id
    FROM mail.mailboxes
    WHERE id = ${mailboxId}::uuid AND deleted_at IS NULL
    FOR UPDATE
  `;
  if (!mailbox) return fail(err.notFound("Mailbox"));
  const allowed = await requireMailboxPermission(context, mailboxId, "admin", db);
  return allowed.ok ? ok() : allowed;
};

const loadSenderRule = async (mailboxId: string, ruleId: string, db: SqlClient, lock = false): Promise<Result<SenderRule>> => {
  const [row] = await db<SenderRuleRow[]>`
    SELECT ${senderRuleColumns}
    FROM mail.sender_rules rule
    WHERE rule.id = ${ruleId}::uuid
      AND rule.mailbox_id = ${mailboxId}::uuid
      AND rule.deleted_at IS NULL
    ${lock ? sql`FOR UPDATE OF rule` : sql``}
  `;
  return row ? ok(mapSenderRule(row)) : fail(err.notFound("Sender rule"));
};

const recordActivity = async (params: {
  db: SqlClient;
  context: MailRequestContext;
  rule: SenderRule;
  action: "sender_rule.created" | "sender_rule.updated" | "sender_rule.deleted";
}): Promise<string> => {
  const actor = requestActor(params.context);
  const [activity] = await params.db<{ id: string | number }[]>`
    INSERT INTO mail.activity_events (
      mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
    ) VALUES (
      ${params.rule.mailboxId}::uuid,
      ${actor.kind},
      ${actor.id}::uuid,
      ${params.action},
      'confirmed',
      'sender_rule',
      ${params.rule.id}::uuid,
      ${{
        workflowId: params.rule.workflowId,
        enabled: params.rule.enabled,
        matchKind: params.rule.matchKind,
        matchValue: params.rule.matchValue,
        action: params.rule.action,
        revision: params.rule.revision,
      }}::jsonb
    )
    RETURNING id
  `;
  if (!activity) throw new Error("Sender rule activity insert returned no row");
  return String(activity.id);
};

const publishRuleChange = async (rule: SenderRule, activityId: string): Promise<void> =>
  publishMailMailboxEvent({
    mailboxId: rule.mailboxId,
    conversationId: null,
    reason: "sender_rule",
    targetId: rule.id,
    activityId,
  });

const mutationFailure = (error: unknown, fallback: string): Result<never> => {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    if (isServiceError(current)) return fail(current);
    current = (current as { cause?: unknown }).cause;
  }
  if (databaseErrorCode(error) === "23505") return fail(err.conflict("Sender rule name already exists"));
  return fail(err.internal(fallback));
};

export const listSenderRules = async (context: MailRequestContext, mailboxId: string): Promise<Result<SenderRule[]>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<SenderRuleRow[]>`
    SELECT ${senderRuleColumns}
    FROM mail.sender_rules rule
    WHERE rule.mailbox_id = ${mailboxId}::uuid
      AND rule.deleted_at IS NULL
    ORDER BY rule.enabled DESC, rule.normalized_name, rule.id
    LIMIT 500
  `;
  return ok(rows.map(mapSenderRule));
};

export const getSenderRule = async (context: MailRequestContext, mailboxId: string, ruleId: string): Promise<Result<SenderRule>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  return loadSenderRule(mailboxId, ruleId, sql);
};

export const previewSenderRuleMatches = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: PreviewSenderRuleMatchesInput;
}): Promise<Result<SenderRuleMatchPreview>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const match = normalizePreviewMatch(params.input);
  if (!match.ok) return match;
  const [counts] = await sql<{ message_count: string | number; conversation_count: string | number }[]>`
    SELECT
      COUNT(DISTINCT remote_ref.id)::int AS message_count,
      COUNT(DISTINCT conversation_message.conversation_id)::int AS conversation_count
    ${senderRuleTargetFrom}
    WHERE resource.mailbox_id = ${params.mailboxId}::uuid
      AND remote_ref.stale_at IS NULL
      AND ${inboundSenderRuleTarget}
      AND ${senderRuleMatchSql(match.data.matchKind, match.data.matchValue)}
  `;
  const messageCount = Number(counts?.message_count ?? 0);
  return ok({
    messageCount,
    conversationCount: Number(counts?.conversation_count ?? 0),
    applicationLimit: EXISTING_MESSAGE_APPLICATION_LIMIT,
    capped: messageCount > EXISTING_MESSAGE_APPLICATION_LIMIT,
  });
};

export const markSenderMessagesRead = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: MarkSenderMessagesReadInput;
}): Promise<Result<MarkSenderMessagesReadResult>> => {
  const parsed = markSenderMessagesReadInputSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid sender read action"));
  const match = normalizePreviewMatch({ matchKind: parsed.data.matchKind, matchValue: parsed.data.matchValue });
  if (!match.ok) return match;
  const actor = requestActor(params.context);
  const correlationId = `sender-read:${parsed.data.idempotencyKey}`;
  try {
    const outcome: { result: MarkSenderMessagesReadResult; commands: MailCommand[] } = await sql.begin(async (tx) => {
      unwrap(await requireMailboxPermission(params.context, params.mailboxId, "write", tx));
      const [claimed] = await tx<{ id: string }[]>`
        INSERT INTO mail.sender_read_batches (
          mailbox_id, actor_kind, actor_id, idempotency_key, match_kind, match_value,
          command_ids, capped, application_limit
        ) VALUES (
          ${params.mailboxId}::uuid, ${actor.kind}, ${actor.id}::uuid, ${parsed.data.idempotencyKey},
          ${match.data.matchKind}, ${match.data.matchValue}, ARRAY[]::uuid[], false, ${EXISTING_MESSAGE_APPLICATION_LIMIT}
        )
        ON CONFLICT (mailbox_id, actor_kind, actor_id, idempotency_key) DO NOTHING
        RETURNING id
      `;
      if (!claimed) {
        const [existing] = await tx<
          {
            match_kind: SenderRuleMatchKind;
            match_value: string;
            command_ids: string[];
            capped: boolean;
            application_limit: number;
          }[]
        >`
          SELECT match_kind, match_value, command_ids::text[] AS command_ids, capped, application_limit
          FROM mail.sender_read_batches
          WHERE mailbox_id = ${params.mailboxId}::uuid
            AND actor_kind = ${actor.kind}
            AND actor_id = ${actor.id}::uuid
            AND idempotency_key = ${parsed.data.idempotencyKey}
        `;
        if (!existing) throw new Error("Sender read batch disappeared");
        if (existing.match_kind !== match.data.matchKind || existing.match_value !== match.data.matchValue) {
          unwrap(fail(err.conflict("Idempotency key is already in use for a different sender read action")));
        }
        return {
          result: {
            commandIds: existing.command_ids,
            messageCount: existing.command_ids.length,
            applicationLimit: existing.application_limit,
            capped: existing.capped,
          },
          commands: [],
        };
      }
      const targets = await tx<
        {
          remote_message_ref_id: string;
          folder_id: string;
          flags: string[];
          keywords: string[];
        }[]
      >`
        SELECT DISTINCT
          remote_ref.id AS remote_message_ref_id,
          placement.folder_id,
          placement.flags,
          placement.keywords,
          message.internal_date
        ${senderRuleTargetFrom}
        WHERE resource.mailbox_id = ${params.mailboxId}::uuid
          AND remote_ref.stale_at IS NULL
          AND ${inboundSenderRuleTarget}
          AND NOT ('\\Seen' = ANY(placement.flags))
          AND ${senderRuleMatchSql(match.data.matchKind, match.data.matchValue)}
        ORDER BY message.internal_date DESC, remote_ref.id, placement.folder_id
        LIMIT ${EXISTING_MESSAGE_APPLICATION_LIMIT + 1}
      `;
      const capped = targets.length > EXISTING_MESSAGE_APPLICATION_LIMIT;
      const selected = capped ? targets.slice(0, EXISTING_MESSAGE_APPLICATION_LIMIT) : targets;
      if (selected.length === 0) {
        return {
          result: { commandIds: [], messageCount: 0, applicationLimit: EXISTING_MESSAGE_APPLICATION_LIMIT, capped: false },
          commands: [],
        };
      }
      const commands = await createActorCommandsInTransaction(
        {
          context: params.context,
          mailboxId: params.mailboxId,
          inputs: selected.map((target) => ({
            kind: "change_message_state",
            remoteMessageRefId: target.remote_message_ref_id,
            folderId: target.folder_id,
            change: { addFlags: ["seen" as const], removeFlags: [], addKeywords: [], removeKeywords: [] },
            idempotencyKey: `sender-read:${sha256Json([parsed.data.idempotencyKey, target.remote_message_ref_id, target.folder_id])}`,
            correlationId,
          })),
          afterCreate: async (commandTx, createdCommands) => {
            const currentPlacements = await commandTx<
              Array<{ remote_message_ref_id: string; folder_id: string; flags: string[]; keywords: string[] }>
            >`
              SELECT remote_message_ref_id, folder_id, flags, keywords
              FROM mail.message_placements
              WHERE remote_message_ref_id = ANY(${toPgUuidArray(selected.map((target) => target.remote_message_ref_id))}::uuid[])
                AND folder_id = ANY(${toPgUuidArray(selected.map((target) => target.folder_id))}::uuid[])
                AND deleted_at IS NULL
              FOR UPDATE
            `;
            const placementByTarget = new Map(
              currentPlacements.map((placement) => [`${placement.remote_message_ref_id}:${placement.folder_id}`, placement]),
            );
            for (const [index, command] of createdCommands.entries()) {
              if (!["queued", "executing", "ambiguous"].includes(command.state)) continue;
              const target = selected[index];
              if (!target) throw new Error("Sender read target changed");
              const placement = placementByTarget.get(`${target.remote_message_ref_id}:${target.folder_id}`);
              if (!placement) throw new Error("Sender read placement changed");
              const projectedFlags = [...new Set([...placement.flags, "\\Seen"])].sort((left, right) => left.localeCompare(right));
              await commandTx`
                UPDATE mail.commands
                SET transport_metadata = transport_metadata || ${{
                  localStateProjection: {
                    remoteMessageRefId: target.remote_message_ref_id,
                    previousFlags: placement.flags,
                    previousKeywords: placement.keywords,
                    projectedFlags,
                    projectedKeywords: placement.keywords,
                  },
                  senderReadBatch: {
                    capped,
                    applicationLimit: EXISTING_MESSAGE_APPLICATION_LIMIT,
                    matchKind: match.data.matchKind,
                    matchValue: match.data.matchValue,
                  },
                }}::jsonb
                WHERE id = ${command.id}::uuid
                  AND NOT (transport_metadata ? 'localStateProjection')
              `;
              await commandTx`
                UPDATE mail.message_placements
                SET flags = ${toPgTextArray(projectedFlags)}::text[], updated_at = now()
                WHERE remote_message_ref_id = ${target.remote_message_ref_id}::uuid
                  AND folder_id = ${target.folder_id}::uuid
                  AND deleted_at IS NULL
              `;
            }
          },
        },
        tx,
      );
      await tx`
        UPDATE mail.sender_read_batches
        SET command_ids = ${toPgUuidArray(commands.map((command) => command.id))}::uuid[], capped = ${capped}
        WHERE id = ${claimed.id}::uuid
      `;
      return {
        result: {
          commandIds: commands.map((command) => command.id),
          messageCount: commands.length,
          applicationLimit: EXISTING_MESSAGE_APPLICATION_LIMIT,
          capped,
        },
        commands,
      };
    });
    await enqueueCreatedActorCommands(outcome.commands);
    return ok(outcome.result);
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to mark sender messages as read"));
  }
};

export const applySenderRuleToExisting = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  ruleId: string;
  input: ApplySenderRuleToExistingInput;
}): Promise<Result<ApplySenderRuleToExistingResult>> => {
  const parsed = applySenderRuleToExistingInputSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid sender rule application"));
  try {
    return await sql.begin(async (tx) => {
      unwrap(await requireMailboxPermission(params.context, params.mailboxId, "admin", tx));
      const rule = unwrap(await loadSenderRule(params.mailboxId, params.ruleId, tx, true));
      if (rule.revision !== parsed.data.expectedRevision) unwrap(fail(err.conflict("Sender rule was changed")));
      if (!rule.enabled) unwrap(fail(err.badInput("Enable the sender rule before applying it to existing messages")));
      unwrap(
        await protectMailboxSenders({
          mailboxId: params.mailboxId,
          matchKind: rule.matchKind,
          matchValue: rule.matchValue,
          action: rule.action,
          db: tx,
        }),
      );

      const targets = await tx<{ remote_message_ref_id: string; size_bytes: string | number }[]>`
        SELECT DISTINCT remote_ref.id AS remote_message_ref_id, message.internal_date, message.size_bytes
        ${senderRuleTargetFrom}
        WHERE resource.mailbox_id = ${params.mailboxId}::uuid
          AND remote_ref.stale_at IS NULL
          AND ${inboundSenderRuleTarget}
          AND ${senderRuleMatchSql(rule.matchKind, rule.matchValue)}
          AND NOT EXISTS (
            SELECT 1
            FROM workflows.event existing_event
            WHERE existing_event.app_id = ${MAIL_WORKFLOW_APP_ID}
              AND existing_event.scope_id = ${params.mailboxId}
              AND existing_event.type = ${MAIL_WORKFLOW_EVENT.messageReceived}
              AND existing_event.dedupe_key = ${senderRuleExistingDedupePrefix(rule.id, rule.workflowVersionId)} || remote_ref.id::text
          )
        ORDER BY message.internal_date DESC, remote_ref.id
        LIMIT ${EXISTING_MESSAGE_APPLICATION_LIMIT + 1}
      `;
      let selectedBytes = 0;
      const selected: typeof targets = [];
      for (const target of targets.slice(0, EXISTING_MESSAGE_APPLICATION_LIMIT)) {
        const sizeBytes = Math.max(0, Number(target.size_bytes));
        if (selected.length > 0 && selectedBytes + sizeBytes > EXISTING_MESSAGE_APPLICATION_BYTES) break;
        selected.push(target);
        selectedBytes += sizeBytes;
      }
      const capped = selected.length < targets.length;
      const snapshots = await getWorkflowSnapshots({
        mailboxId: params.mailboxId,
        remoteMessageRefIds: selected.map((target) => target.remote_message_ref_id),
        db: tx,
      });
      const eventIds: string[] = [];
      for (const target of selected) {
        const snapshot = snapshots.get(target.remote_message_ref_id);
        if (!snapshot) continue;
        const emission = await emitWorkflowEvent(
          {
            appId: MAIL_WORKFLOW_APP_ID,
            scopeId: params.mailboxId,
            type: MAIL_WORKFLOW_EVENT.messageReceived,
            targetWorkflowId: rule.workflowId,
            data: {
              message: snapshot.source.message as unknown as WorkflowJsonValue,
              conversation: snapshot.source.conversation as unknown as WorkflowJsonValue,
            },
            context: mailWorkflowEventContext(params.mailboxId, snapshot),
            dedupeKey: senderRuleExistingDedupeKey(rule.id, rule.workflowVersionId, snapshot.targetKey),
            occurredAt: new Date(snapshot.internalDate),
          },
          { db: tx },
        );
        if (!emission.duplicate) eventIds.push(emission.eventId);
      }
      await audit.record(
        {
          action: "mail.sender_rule.apply_existing",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "sender_rule", id: rule.id, label: rule.name },
          requestId: params.context.requestId,
          metadata: {
            mailboxId: params.mailboxId,
            workflowId: rule.workflowId,
            eventCount: eventIds.length,
            eventIds,
            capped,
            applicationLimit: EXISTING_MESSAGE_APPLICATION_LIMIT,
          },
        },
        tx,
      );
      return ok({
        ruleId: rule.id,
        eventCount: eventIds.length,
        eventIds,
        applicationLimit: EXISTING_MESSAGE_APPLICATION_LIMIT,
        capped,
      });
    });
  } catch (error) {
    return mutationFailure(error, "Failed to apply sender rule to existing messages");
  }
};

export const createSenderRule = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: CreateSenderRule;
}): Promise<Result<SenderRule>> => {
  const parsed = createSenderRuleSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid sender rule"));
  const ruleId = crypto.randomUUID();
  const name = normalizeName(parsed.data.name);
  const normalizedMatch = normalizeRuleMatch(parsed.data.matchKind, parsed.data.matchValue);
  if (!normalizedMatch.ok) return normalizedMatch;
  const matchValue = normalizedMatch.data;
  try {
    const result = await sql.begin(async (tx) => {
      unwrap(await lockMailbox(params.context, params.mailboxId, tx));
      const [count] = await tx<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM mail.sender_rules
        WHERE mailbox_id = ${params.mailboxId}::uuid AND deleted_at IS NULL
      `;
      if ((count?.count ?? 0) >= MAX_SENDER_RULES) {
        unwrap(fail(err.conflict(`A mailbox can have at most ${MAX_SENDER_RULES} sender rules`)));
      }
      unwrap(
        await protectMailboxSenders({
          mailboxId: params.mailboxId,
          matchKind: parsed.data.matchKind,
          matchValue,
          action: parsed.data.action,
          db: tx,
        }),
      );
      unwrap(
        await protectAgainstConflictingRules({
          mailboxId: params.mailboxId,
          enabled: parsed.data.enabled,
          matchKind: parsed.data.matchKind,
          matchValue,
          action: parsed.data.action,
          db: tx,
        }),
      );
      const actor = requestActor(params.context);
      const workflow = unwrap(
        await replaceManagedWorkflowInTransaction({
          db: tx,
          context: params.context,
          mailboxId: params.mailboxId,
          workflowId: null,
          name: internalWorkflowName(ruleId),
          description: "Managed by Mail sender rules.",
          priority: 50,
          managedBy: "sender_rule",
          source: buildSenderRuleWorkflowSource({ ...parsed.data, matchValue }),
          effectBudget: workflowBudget(parsed.data.action),
          enabled: parsed.data.enabled,
        }),
      );
      const [row] = await tx<SenderRuleRow[]>`
        INSERT INTO mail.sender_rules AS rule (
          id, mailbox_id, workflow_id, name, normalized_name, match_kind, match_value,
          action, enabled, created_by_actor_kind, created_by_actor_id
        ) VALUES (
          ${ruleId}::uuid,
          ${params.mailboxId}::uuid,
          ${workflow.id}::uuid,
          ${name},
          lower(regexp_replace(${name}, '\\s+', ' ', 'g')),
          ${parsed.data.matchKind},
          ${matchValue},
          ${parsed.data.action}::jsonb,
          ${parsed.data.enabled},
          ${actor.kind},
          ${actor.id}::uuid
        )
        RETURNING ${senderRuleColumns}
      `;
      if (!row) throw new Error("Sender rule insert returned no row");
      const rule = mapSenderRule(row);
      const activityId = await recordActivity({ db: tx, context: params.context, rule, action: "sender_rule.created" });
      await audit.record(
        {
          action: "mail.sender_rule.create",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "sender_rule", id: rule.id, label: rule.name },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, workflowId: rule.workflowId, enabled: rule.enabled },
        },
        tx,
      );
      return { rule, activityId };
    });
    await publishRuleChange(result.rule, result.activityId);
    return ok(result.rule);
  } catch (error) {
    return mutationFailure(error, "Failed to create sender rule");
  }
};

export const updateSenderRule = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  ruleId: string;
  input: UpdateSenderRule;
}): Promise<Result<SenderRule>> => {
  const parsed = updateSenderRuleSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid sender rule"));
  const name = normalizeName(parsed.data.name);
  const normalizedMatch = normalizeRuleMatch(parsed.data.matchKind, parsed.data.matchValue);
  if (!normalizedMatch.ok) return normalizedMatch;
  const matchValue = normalizedMatch.data;
  try {
    const result = await sql.begin(async (tx) => {
      unwrap(await lockMailbox(params.context, params.mailboxId, tx));
      const current = unwrap(await loadSenderRule(params.mailboxId, params.ruleId, tx, true));
      if (current.revision !== parsed.data.expectedRevision) unwrap(fail(err.conflict("Sender rule was changed")));
      unwrap(
        await protectMailboxSenders({
          mailboxId: params.mailboxId,
          matchKind: parsed.data.matchKind,
          matchValue,
          action: parsed.data.action,
          db: tx,
        }),
      );
      unwrap(
        await protectAgainstConflictingRules({
          mailboxId: params.mailboxId,
          ruleId: params.ruleId,
          enabled: parsed.data.enabled,
          matchKind: parsed.data.matchKind,
          matchValue,
          action: parsed.data.action,
          db: tx,
        }),
      );
      const definitionChanged =
        current.matchKind !== parsed.data.matchKind ||
        current.matchValue !== matchValue ||
        JSON.stringify(current.action) !== JSON.stringify(parsed.data.action);
      const enabledChanged = current.enabled !== parsed.data.enabled;
      const changed = current.name !== name || definitionChanged || enabledChanged;
      if (!changed) return { rule: current, activityId: null as string | null };
      if (definitionChanged) {
        unwrap(
          await replaceManagedWorkflowInTransaction({
            db: tx,
            context: params.context,
            mailboxId: params.mailboxId,
            workflowId: current.workflowId,
            name: internalWorkflowName(params.ruleId),
            description: "Managed by Mail sender rules.",
            priority: 50,
            managedBy: "sender_rule",
            source: buildSenderRuleWorkflowSource({ ...parsed.data, matchValue }),
            effectBudget: workflowBudget(parsed.data.action),
            enabled: parsed.data.enabled,
          }),
        );
      } else if (enabledChanged) {
        unwrap(
          await setManagedWorkflowEnabledInTransaction({
            db: tx,
            context: params.context,
            mailboxId: params.mailboxId,
            workflowId: current.workflowId,
            enabled: parsed.data.enabled,
          }),
        );
      }
      await tx`
        UPDATE mail.sender_rules
        SET
          name = ${name},
          normalized_name = lower(regexp_replace(${name}, '\\s+', ' ', 'g')),
          match_kind = ${parsed.data.matchKind},
          match_value = ${matchValue},
          action = ${parsed.data.action}::jsonb,
          enabled = ${parsed.data.enabled},
          revision = revision + 1
        WHERE id = ${params.ruleId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
      `;
      const rule = unwrap(await loadSenderRule(params.mailboxId, params.ruleId, tx));
      const activityId = await recordActivity({ db: tx, context: params.context, rule, action: "sender_rule.updated" });
      await audit.record(
        {
          action: "mail.sender_rule.update",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "sender_rule", id: rule.id, label: rule.name },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, workflowId: rule.workflowId, enabled: rule.enabled, revision: rule.revision },
        },
        tx,
      );
      return { rule, activityId };
    });
    if (result.activityId) await publishRuleChange(result.rule, result.activityId);
    return ok(result.rule);
  } catch (error) {
    return mutationFailure(error, "Failed to update sender rule");
  }
};

export const setSenderRuleEnabled = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  ruleId: string;
  input: SetSenderRuleEnabled;
}): Promise<Result<SenderRule>> => {
  const parsed = setSenderRuleEnabledSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid sender rule state"));
  try {
    const result = await sql.begin(async (tx) => {
      unwrap(await lockMailbox(params.context, params.mailboxId, tx));
      const current = unwrap(await loadSenderRule(params.mailboxId, params.ruleId, tx, true));
      if (current.revision !== parsed.data.expectedRevision) unwrap(fail(err.conflict("Sender rule was changed")));
      if (current.enabled === parsed.data.enabled) return { rule: current, activityId: null as string | null };
      if (parsed.data.enabled) {
        unwrap(
          await protectMailboxSenders({
            mailboxId: params.mailboxId,
            matchKind: current.matchKind,
            matchValue: current.matchValue,
            action: current.action,
            db: tx,
          }),
        );
        unwrap(
          await protectAgainstConflictingRules({
            mailboxId: params.mailboxId,
            ruleId: params.ruleId,
            enabled: true,
            matchKind: current.matchKind,
            matchValue: current.matchValue,
            action: current.action,
            db: tx,
          }),
        );
      }
      unwrap(
        await setManagedWorkflowEnabledInTransaction({
          db: tx,
          context: params.context,
          mailboxId: params.mailboxId,
          workflowId: current.workflowId,
          enabled: parsed.data.enabled,
        }),
      );
      await tx`
        UPDATE mail.sender_rules
        SET enabled = ${parsed.data.enabled}, revision = revision + 1
        WHERE id = ${params.ruleId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
      `;
      const rule = unwrap(await loadSenderRule(params.mailboxId, params.ruleId, tx));
      const activityId = await recordActivity({ db: tx, context: params.context, rule, action: "sender_rule.updated" });
      await audit.record(
        {
          action: "mail.sender_rule.update",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "sender_rule", id: rule.id, label: rule.name },
          requestId: params.context.requestId,
          metadata: {
            mailboxId: params.mailboxId,
            workflowId: rule.workflowId,
            enabled: rule.enabled,
            revision: rule.revision,
          },
        },
        tx,
      );
      return { rule, activityId };
    });
    if (result.activityId) await publishRuleChange(result.rule, result.activityId);
    return ok(result.rule);
  } catch (error) {
    return mutationFailure(error, "Failed to change sender rule");
  }
};

export const deleteSenderRule = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  ruleId: string;
  input: DeleteSenderRule;
}): Promise<Result<SenderRule>> => {
  const parsed = deleteSenderRuleSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid sender rule deletion"));
  try {
    const result = await sql.begin(async (tx) => {
      unwrap(await lockMailbox(params.context, params.mailboxId, tx));
      const current = unwrap(await loadSenderRule(params.mailboxId, params.ruleId, tx, true));
      if (current.revision !== parsed.data.expectedRevision) unwrap(fail(err.conflict("Sender rule was changed")));
      unwrap(
        await setManagedWorkflowEnabledInTransaction({
          db: tx,
          context: params.context,
          mailboxId: params.mailboxId,
          workflowId: current.workflowId,
          enabled: false,
        }),
      );
      const [row] = await tx<SenderRuleRow[]>`
        UPDATE mail.sender_rules AS rule
        SET enabled = false, revision = revision + 1, deleted_at = now()
        WHERE rule.id = ${params.ruleId}::uuid AND rule.mailbox_id = ${params.mailboxId}::uuid
        RETURNING ${senderRuleColumns}
      `;
      if (!row) throw new Error("Deleted sender rule could not be reloaded");
      const rule = mapSenderRule(row);
      const activityId = await recordActivity({ db: tx, context: params.context, rule, action: "sender_rule.deleted" });
      await audit.record(
        {
          action: "mail.sender_rule.delete",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "sender_rule", id: rule.id, label: rule.name },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, workflowId: rule.workflowId, revision: rule.revision },
        },
        tx,
      );
      return { rule, activityId };
    });
    await publishRuleChange(result.rule, result.activityId);
    return ok(result.rule);
  } catch (error) {
    return mutationFailure(error, "Failed to delete sender rule");
  }
};
