import { audit } from "@valentinkolb/cloud/services";
import { err, fail, isServiceError, ok, type Result, unwrap } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { stringify } from "yaml";
import {
  type CreateSenderRule,
  createSenderRuleSchema,
  type DeleteSenderRule,
  deleteSenderRuleSchema,
  type SenderRuleAction,
  type SenderRuleMatchKind,
  type SetSenderRuleEnabled,
  setSenderRuleEnabledSchema,
  type UpdateSenderRule,
  updateSenderRuleSchema,
  type WorkflowEffectBudget,
} from "../contracts";
import { normalizeEmailAddress, normalizeEmailDomain } from "./address-normalization";
import { requireMailboxPermission } from "./access";
import { actorRefFromRequest, auditActorFromRequest, type MailRequestContext } from "./auth";
import { databaseErrorCode } from "./database-errors";
import { publishMailMailboxEvent } from "./events";
import type { SqlClient } from "./workflow-data";
import {
  replaceManagedWorkflowInTransaction,
  setManagedWorkflowEnabledInTransaction,
} from "./workflow-definition-service";

export type SenderRule = {
  id: string;
  mailboxId: string;
  workflowId: string;
  name: string;
  enabled: boolean;
  matchKind: SenderRuleMatchKind;
  matchValue: string;
  action: SenderRuleAction;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

type SenderRuleRow = {
  id: string;
  mailbox_id: string;
  workflow_id: string;
  name: string;
  enabled: boolean;
  match_kind: SenderRuleMatchKind;
  match_value: string;
  action: SenderRuleAction | string;
  revision: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

type RuleActor = { kind: "user" | "service_account"; id: string };

const senderRuleColumns = sql`
  rule.id,
  rule.mailbox_id,
  rule.workflow_id,
  rule.name,
  rule.enabled,
  rule.match_kind,
  rule.match_value,
  rule.action,
  rule.revision,
  rule.created_at,
  rule.updated_at
`;

const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const normalizeName = (value: string): string => value.trim().replace(/\s+/gu, " ");
const parseJson = <T>(value: T | string): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);
const internalWorkflowName = (id: string): string => `Sender rule ${id}`;

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
  name: row.name,
  enabled: row.enabled,
  matchKind: row.match_kind,
  matchValue: row.match_value,
  action: parseJson(row.action),
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
        internalDomains.has(params.matchValue.slice(params.matchValue.lastIndexOf("@") + 1))
      : identityDomains.has(params.matchValue) || internalDomains.has(params.matchValue);
  return protectedMatch
    ? fail(err.badInput("Mailbox identities and internal domains cannot be routed to junk or trash"))
    : ok();
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

const loadSenderRule = async (
  mailboxId: string,
  ruleId: string,
  db: SqlClient,
  lock = false,
): Promise<Result<SenderRule>> => {
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
      unwrap(
        await protectMailboxSenders({
          mailboxId: params.mailboxId,
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
