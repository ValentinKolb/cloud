import { err, fail, isServiceError, ok, type Result, unwrap } from "@k2b/stdlib";
import { type PumpHandle, type PumpState, pump } from "@k2b/sync";
import { audit, toPgTextArray, toPgUuidArray, trace } from "@valentinkolb/cloud/services";
import type { WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { emitWorkflowEvent } from "@valentinkolb/cloud/workflows/store";
import { sql } from "bun";
import { stringify } from "yaml";
import {
  type CreateMailRule,
  createMailRuleSchema,
  type DeleteMailRule,
  deleteMailRuleSchema,
  type MailCommand,
  type MailRuleAction,
  type MailRuleBackfill,
  type MailRuleCondition,
  type MailRuleConditions,
  type MailRuleMatchPreview,
  type MarkSenderMessagesReadInput,
  type MarkSenderMessagesReadResult,
  markSenderMessagesReadInputSchema,
  type PreviewMailRuleMatchesInput,
  previewMailRuleMatchesInputSchema,
  type SenderMatchKind,
  type SetMailRuleEnabled,
  type StartMailRuleBackfillInput,
  setMailRuleEnabledSchema,
  startMailRuleBackfillInputSchema,
  type UpdateMailRule,
  updateMailRuleSchema,
  type WorkflowEffectBudget,
} from "../contracts";
import { type MailWorkflowCatalogSnapshot, snapshotMailWorkflowCatalog } from "../workflows/catalog";
import { MAIL_WORKFLOW_APP_ID, MAIL_WORKFLOW_EVENT } from "../workflows/events";
import { requireMailboxPermission } from "./access";
import { normalizeEmailAddress, normalizeEmailDomain } from "./address-normalization";
import { actorRefFromRequest, auditActorFromRequest, type MailRequestContext } from "./auth";
import { sha256Json } from "./canonical";
import { createActorCommandsInTransaction, enqueueCreatedActorCommands } from "./commands";
import { databaseErrorCode } from "./database-errors";
import { publishMailMailboxEvent } from "./events";
import { loadMailWorkflowCatalog } from "./workflow-catalog-service";
import type { SqlClient } from "./workflow-data";
import { getWorkflowSnapshot, mailWorkflowEventContext } from "./workflow-data";
import { replaceManagedWorkflowInTransaction, setManagedWorkflowEnabledInTransaction } from "./workflow-definition-service";

export type MailRule = {
  id: string;
  mailboxId: string;
  workflowId: string;
  workflowVersionId: string;
  name: string;
  enabled: boolean;
  conditions: MailRuleConditions;
  actions: MailRuleAction[];
  latestBackfillOperationId: string | null;
  workflowSource: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

type MailRuleRow = {
  id: string;
  mailbox_id: string;
  workflow_id: string;
  workflow_version_id: string;
  name: string;
  enabled: boolean;
  conditions: MailRuleConditions | string;
  actions: MailRuleAction[] | string;
  latest_backfill_operation_id: string | null;
  workflow_source: string;
  revision: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

type RuleActor = { kind: "user" | "service_account"; id: string };

const mailRuleColumns = sql`
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
  rule.conditions,
  rule.actions,
  rule.latest_backfill_operation_id,
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
const internalWorkflowName = (id: string): string => `Mail rule ${id}`;
const EXISTING_MESSAGE_APPLICATION_LIMIT = 100;
const MAX_MAIL_RULES = 500;
const isSameOrSubdomain = (candidate: string, domain: string): boolean => candidate === domain || candidate.endsWith(`.${domain}`);
const mailRuleExistingDedupePrefix = (ruleId: string, workflowVersionId: string): string =>
  `mail-rule-existing:${ruleId}:v${workflowVersionId}:`;
export const mailRuleExistingDedupeKey = (ruleId: string, workflowVersionId: string, targetKey: string): string =>
  `${mailRuleExistingDedupePrefix(ruleId, workflowVersionId)}${targetKey}`;

type MailRuleBackfillInput = {
  operationId: string;
  mailboxId: string;
  ruleId: string;
  workflowId: string;
  workflowVersionId: string;
  conditions: MailRuleConditions;
  cutoffAt: string;
};

type MailRuleBackfillCursor = {
  internalDate: string;
  remoteMessageRefId: string;
};

type MailRuleBackfillItem = {
  key: string;
  remoteMessageRefId: string;
};

type MailRuleBackfillPump = PumpHandle<MailRuleBackfillInput, MailRuleBackfillCursor>;

const mailRuleBackfillKey = (ruleId: string, operationId: string): string => `mail-rule:${ruleId}:backfill:${operationId}`;

const requestActor = (context: MailRequestContext): RuleActor => {
  const actor = actorRefFromRequest(context);
  if (actor.kind === "user") return { kind: actor.kind, id: actor.userId };
  if (actor.kind === "service_account") return { kind: actor.kind, id: actor.serviceAccountId };
  throw new TypeError("Request actor cannot configure mail rules");
};

const mapMailRule = (row: MailRuleRow): MailRule => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  workflowId: row.workflow_id,
  workflowVersionId: row.workflow_version_id,
  name: row.name,
  enabled: row.enabled,
  conditions: parseJson(row.conditions),
  actions: parseJson(row.actions),
  latestBackfillOperationId: row.latest_backfill_operation_id,
  workflowSource: row.workflow_source,
  revision: Number(row.revision),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const workflowBudget = (actions: MailRuleAction[]): WorkflowEffectBudget => ({
  maxTargets: 50_000,
  maxMoves: actions.some((action) => action.kind === "junk" || action.kind === "trash" || action.kind === "move_to_folder") ? 50_000 : 0,
  maxCopies: 0,
  maxSends: 0,
  maxDrafts: 0,
  maxFlagChanges: actions.some((action) => action.kind === "mark_read") ? 50_000 : 0,
  maxNotifications: 0,
  maxKeywordChanges: actions.some((action) => action.kind === "add_keyword") ? 50_000 : 0,
  maxCollaborationChanges: actions.some(
    (action) => action.kind === "add_local_tag" || action.kind === "assign_user" || action.kind === "set_status",
  )
    ? 100_000
    : 0,
  maxAiCalls: 0,
});

export const buildMailRuleActionStep = (action: MailRuleAction): Record<string, unknown> => {
  if (action.kind === "junk") return { junkMessage: { message: "${{ inputs.message }}" } };
  if (action.kind === "trash") return { trashMessage: { message: "${{ inputs.message }}" } };
  if (action.kind === "mark_read") {
    return { addFlag: { message: "${{ inputs.message }}", flag: "seen" } };
  }
  if (action.kind === "add_keyword") return { addKeyword: { message: "${{ inputs.message }}", keyword: action.keyword } };
  if (action.kind === "move_to_folder") {
    return { moveMessage: { message: "${{ inputs.message }}", folder: action.folderId } };
  }
  if (action.kind === "add_local_tag") {
    return { addLocalTag: { conversation: "${{ inputs.conversation }}", tag: action.tagId } };
  }
  if (action.kind === "assign_user") {
    return { assignConversation: { conversation: "${{ inputs.conversation }}", user: action.userId } };
  }
  return { setConversationStatus: { conversation: "${{ inputs.conversation }}", status: action.status } };
};

const workflowCondition = (condition: MailRuleCondition): Record<string, unknown> => {
  if (condition.field === "attachment_presence") {
    const exists = { exists: "inputs.message.attachments.0" };
    return condition.value ? exists : { not: exists };
  }
  const reference =
    condition.field === "sender_address"
      ? "${{ inputs.message.fromAddress }}"
      : condition.field === "sender_domain"
        ? "${{ inputs.message.fromDomain }}"
        : condition.field === "subject"
          ? "${{ inputs.message.subject }}"
          : "${{ inputs.message.bodyText }}";
  const operator =
    condition.field === "sender_address" || condition.field === "sender_domain"
      ? "equals"
      : condition.operator === "is"
        ? "textEquals"
        : condition.operator === "starts_with"
          ? "startsWith"
          : condition.operator === "ends_with"
            ? "endsWith"
            : "contains";
  return { [operator]: [reference, condition.value] };
};

export const buildMailRuleConditionExpression = (conditions: MailRuleConditions): Record<string, unknown> => {
  const items = conditions.items.map(workflowCondition);
  return items.length === 1 ? items[0]! : { [conditions.mode]: items };
};

export const buildMailRuleWorkflowSource = (params: { conditions: MailRuleConditions; actions: MailRuleAction[] }): string =>
  stringify(
    {
      inputs: {
        message: { type: "mailMessage", required: true },
        conversation: {
          type: "mailConversation",
          required: params.actions.some(
            (action) => action.kind === "add_local_tag" || action.kind === "assign_user" || action.kind === "set_status",
          ),
        },
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
          if: buildMailRuleConditionExpression(params.conditions),
          then: params.actions.map(buildMailRuleActionStep),
        },
      ],
    },
    { lineWidth: 0 },
  );

const normalizeSenderMatch = (kind: SenderMatchKind, value: string): Result<string> => {
  const normalized = kind === "sender" ? normalizeEmailAddress(value) : normalizeEmailDomain(value);
  if (!normalized) return fail(err.badInput(kind === "sender" ? "Enter a valid sender email address" : "Enter a valid sender domain"));
  if (kind === "domain" && !normalized.includes(".")) {
    return fail(err.badInput("Enter a complete sender domain, for example example.com"));
  }
  return ok(normalized);
};

const senderMatchSql = (kind: SenderMatchKind, value: string) =>
  kind === "sender" ? sql`sender.normalized_email = ${value}` : sql`split_part(sender.normalized_email, '@', 2) = ${value}`;
type SqlFragment = ReturnType<typeof senderMatchSql>;

export const normalizeMailRuleConditions = (conditions: MailRuleConditions): Result<MailRuleConditions> => {
  const items: MailRuleCondition[] = [];
  for (const condition of conditions.items) {
    if (condition.field !== "sender_address" && condition.field !== "sender_domain") {
      items.push(condition);
      continue;
    }
    const kind = condition.field === "sender_address" ? "sender" : "domain";
    const normalized = normalizeSenderMatch(kind, condition.value);
    if (!normalized.ok) return normalized;
    items.push({ ...condition, value: normalized.data });
  }
  return ok({ mode: conditions.mode, items });
};

const senderCondition = (condition: MailRuleCondition): { kind: SenderMatchKind; value: string } | null =>
  condition.field === "sender_address"
    ? { kind: "sender", value: condition.value }
    : condition.field === "sender_domain"
      ? { kind: "domain", value: condition.value }
      : null;

const combineSql = (parts: SqlFragment[], operator: "AND" | "OR"): SqlFragment => {
  const first = parts[0];
  if (!first) return sql`TRUE`;
  return parts
    .slice(1)
    .reduce((combined, part) => (operator === "AND" ? sql`(${combined} AND ${part})` : sql`(${combined} OR ${part})`), first);
};

const mailRuleCandidateSql = (conditions: MailRuleConditions) => {
  const senderConditions = conditions.items.flatMap((condition) => {
    const sender = senderCondition(condition);
    return sender ? [senderMatchSql(sender.kind, sender.value)] : [];
  });
  if (conditions.mode === "all") return combineSql(senderConditions, "AND");
  return senderConditions.length === conditions.items.length ? combineSql(senderConditions, "OR") : sql`TRUE`;
};

const mailRulePreviewIsExact = (conditions: MailRuleConditions): boolean =>
  conditions.items.every((condition) => condition.field === "sender_address" || condition.field === "sender_domain");

const mailRuleTargetFrom = sql`
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

const inboundMailRuleTarget = sql`
  NOT EXISTS (
    SELECT 1
    FROM mail.sender_identities identity
    WHERE identity.mailbox_id = resource.mailbox_id
      AND lower(identity.from_address) = sender.normalized_email
      AND identity.status <> 'disabled'
  )
`;

const normalizePreviewConditions = (input: PreviewMailRuleMatchesInput): Result<MailRuleConditions> => {
  const parsed = previewMailRuleMatchesInputSchema.safeParse(input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid mail rule conditions"));
  return normalizeMailRuleConditions(parsed.data.conditions);
};

const rejectOwnSenderTargets = async (params: {
  mailboxId: string;
  conditions: MailRuleConditions;
  db: SqlClient;
}): Promise<Result<void>> => {
  const addresses = params.conditions.items.flatMap((condition) => (condition.field === "sender_address" ? [condition.value] : []));
  if (addresses.length === 0) return ok();
  const [identity] = await params.db<{ id: string }[]>`
    SELECT id
    FROM mail.sender_identities
    WHERE mailbox_id = ${params.mailboxId}::uuid
      AND lower(from_address) = ANY(${toPgTextArray(addresses)}::text[])
      AND status <> 'disabled'
    LIMIT 1
  `;
  return identity ? fail(err.badInput("Mail rules apply only to incoming mail; remove the mailbox's own sender address")) : ok();
};

const protectMailboxSenders = async (params: {
  mailboxId: string;
  conditions: MailRuleConditions;
  actions: MailRuleAction[];
  db: SqlClient;
}): Promise<Result<void>> => {
  const genericMove = params.actions.find(
    (action): action is Extract<MailRuleAction, { kind: "move_to_folder" }> => action.kind === "move_to_folder",
  );
  if (genericMove) {
    const [folder] = await params.db<{ role: string | null }[]>`
      SELECT COALESCE(role_override.role, folder.role) AS role
      FROM mail.folders folder
      JOIN mail.remote_resources resource ON resource.id = folder.remote_resource_id
      LEFT JOIN mail.folder_role_overrides role_override
        ON role_override.mailbox_id = resource.mailbox_id AND role_override.folder_id = folder.id
      WHERE resource.mailbox_id = ${params.mailboxId}::uuid
        AND folder.id = ${genericMove.folderId}::uuid
        AND folder.discovery_state = 'active'
        AND folder.selectable
    `;
    if (!folder) return fail(err.badInput("Choose an available destination folder"));
    if (folder.role === "junk" || folder.role === "trash") {
      return fail(err.badInput(`Use the dedicated move-to-${folder.role} action for protected sender checks`));
    }
  }
  const destructive = destructiveActionFrom(params.actions);
  if (!destructive) return ok();
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
  const protectedScope = (scope: { kind: SenderMatchKind; value: string }): boolean =>
    scope.kind === "sender"
      ? identityAddresses.has(scope.value) ||
        [...internalDomains].some((domain) => isSameOrSubdomain(scope.value.slice(scope.value.lastIndexOf("@") + 1), domain))
      : [...identityDomains, ...internalDomains].some(
          (domain) => isSameOrSubdomain(scope.value, domain) || isSameOrSubdomain(domain, scope.value),
        );
  const scopes = params.conditions.items.flatMap((condition) => {
    const scope = senderCondition(condition);
    return scope ? [scope] : [];
  });
  const safelyScoped =
    params.conditions.mode === "all"
      ? scopes.some((scope) => !protectedScope(scope))
      : scopes.length === params.conditions.items.length && scopes.every((scope) => !protectedScope(scope));
  return safelyScoped
    ? ok()
    : fail(err.badInput("Rules that move mail to junk or trash must restrict every possible match to an external sender or domain"));
};

const destructiveAction = (action: MailRuleAction): action is Extract<MailRuleAction, { kind: "junk" | "trash" }> =>
  action.kind === "junk" || action.kind === "trash";

const destructiveActionFrom = (actions: MailRuleAction[]): Extract<MailRuleAction, { kind: "junk" | "trash" }> | undefined =>
  actions.find(destructiveAction);

const senderScopesOverlap = (left: { kind: SenderMatchKind; value: string }, right: { kind: SenderMatchKind; value: string }): boolean => {
  if (left.kind === right.kind) return left.value === right.value;
  const sender = left.kind === "sender" ? left.value : right.value;
  const domain = left.kind === "domain" ? left.value : right.value;
  return sender.slice(sender.lastIndexOf("@") + 1) === domain;
};

const mandatorySenderScope = (conditions: MailRuleConditions): { kind: SenderMatchKind; value: string } | null => {
  if (conditions.mode === "any" && conditions.items.some((condition) => !senderCondition(condition))) return null;
  for (const condition of conditions.items) {
    const scope = senderCondition(condition);
    if (scope) return scope;
  }
  return null;
};

const conditionsPotentiallyOverlap = (left: MailRuleConditions, right: MailRuleConditions): boolean => {
  if (JSON.stringify(left) === JSON.stringify(right)) return true;
  const leftScope = mandatorySenderScope(left);
  const rightScope = mandatorySenderScope(right);
  return !leftScope || !rightScope || senderScopesOverlap(leftScope, rightScope);
};

const protectAgainstConflictingRules = async (params: {
  mailboxId: string;
  ruleId?: string;
  enabled: boolean;
  conditions: MailRuleConditions;
  actions: MailRuleAction[];
  db: SqlClient;
}): Promise<Result<void>> => {
  const destructive = destructiveActionFrom(params.actions);
  if (!params.enabled || !destructive) return ok();
  const rows = await params.db<
    Array<{
      id: string;
      name: string;
      conditions: MailRuleConditions | string;
      actions: MailRuleAction[] | string;
    }>
  >`
    SELECT rule.id, rule.name, rule.conditions, rule.actions
    FROM mail.mail_rules rule
    WHERE rule.mailbox_id = ${params.mailboxId}::uuid
      AND rule.deleted_at IS NULL
      AND rule.enabled = true
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(rule.actions) AS action
        WHERE action->>'kind' IN ('junk', 'trash')
      )
      AND (${params.ruleId ?? null}::uuid IS NULL OR rule.id <> ${params.ruleId ?? null}::uuid)
    FOR UPDATE
  `;
  const conflict = rows.find((row) => {
    const action = destructiveActionFrom(parseJson<MailRuleAction[]>(row.actions));
    return action && action.kind !== destructive.kind && conditionsPotentiallyOverlap(params.conditions, parseJson(row.conditions));
  });
  return conflict ? fail(err.conflict(`Mail rule conflicts with “${conflict.name}”`)) : ok();
};

export const validateDestructiveMailRulesForMailbox = async (params: {
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
    Array<{ id: string; name: string; conditions: MailRuleConditions | string; actions: MailRuleAction[] | string }>
  >`
    SELECT rule.id, rule.name, rule.conditions, rule.actions
    FROM mail.mail_rules rule
    WHERE rule.mailbox_id = ${params.mailboxId}::uuid
      AND rule.deleted_at IS NULL
      AND rule.enabled = true
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(rule.actions) AS action
        WHERE action->>'kind' IN ('junk', 'trash')
      )
    FOR UPDATE
  `;
  const unsafe = rules.find((rule) => {
    const conditions = parseJson<MailRuleConditions>(rule.conditions);
    const protectedScope = (scope: { kind: SenderMatchKind; value: string }): boolean =>
      scope.kind === "sender"
        ? identityAddresses.has(scope.value) ||
          [...internalDomains].some((domain) => isSameOrSubdomain(scope.value.slice(scope.value.lastIndexOf("@") + 1), domain))
        : [...identityDomains, ...internalDomains].some(
            (domain) => isSameOrSubdomain(scope.value, domain) || isSameOrSubdomain(domain, scope.value),
          );
    const scopes = conditions.items.flatMap((condition) => {
      const scope = senderCondition(condition);
      return scope ? [scope] : [];
    });
    return conditions.mode === "all"
      ? !scopes.some((scope) => !protectedScope(scope))
      : scopes.length !== conditions.items.length || scopes.some(protectedScope);
  });
  return unsafe ? fail(err.conflict(`Mail rule “${unsafe.name}” must be changed before updating mailbox sender safety`)) : ok();
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

const loadMailRule = async (mailboxId: string, ruleId: string, db: SqlClient, lock = false): Promise<Result<MailRule>> => {
  const [row] = await db<MailRuleRow[]>`
    SELECT ${mailRuleColumns}
    FROM mail.mail_rules rule
    WHERE rule.id = ${ruleId}::uuid
      AND rule.mailbox_id = ${mailboxId}::uuid
      AND rule.deleted_at IS NULL
    ${lock ? sql`FOR UPDATE OF rule` : sql``}
  `;
  return row ? ok(mapMailRule(row)) : fail(err.notFound("Mail rule"));
};

export const getMailRuleCatalog = async (context: MailRequestContext, mailboxId: string): Promise<Result<MailWorkflowCatalogSnapshot>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "admin");
  if (!allowed.ok) return allowed;
  return ok(snapshotMailWorkflowCatalog(await loadMailWorkflowCatalog({ context, mailboxId })));
};

const recordActivity = async (params: {
  db: SqlClient;
  context: MailRequestContext;
  rule: MailRule;
  action: "mail_rule.created" | "mail_rule.updated" | "mail_rule.deleted";
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
      'mail_rule',
      ${params.rule.id}::uuid,
      ${{
        workflowId: params.rule.workflowId,
        enabled: params.rule.enabled,
        conditions: params.rule.conditions,
        actions: params.rule.actions,
        revision: params.rule.revision,
      }}::jsonb
    )
    RETURNING id
  `;
  if (!activity) throw new Error("Mail rule activity insert returned no row");
  return String(activity.id);
};

const publishRuleChange = async (rule: MailRule, activityId: string): Promise<void> =>
  publishMailMailboxEvent({
    mailboxId: rule.mailboxId,
    conversationId: null,
    reason: "mail_rule",
    targetId: rule.id,
    activityId,
  });

const mutationFailure = (error: unknown, fallback: string): Result<never> => {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    if (isServiceError(current)) return fail(current);
    current = (current as { cause?: unknown }).cause;
  }
  if (databaseErrorCode(error) === "23505") return fail(err.conflict("Mail rule name already exists"));
  return fail(err.internal(fallback));
};

export const listMailRules = async (context: MailRequestContext, mailboxId: string): Promise<Result<MailRule[]>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<MailRuleRow[]>`
    SELECT ${mailRuleColumns}
    FROM mail.mail_rules rule
    WHERE rule.mailbox_id = ${mailboxId}::uuid
      AND rule.deleted_at IS NULL
    ORDER BY rule.enabled DESC, rule.normalized_name, rule.id
    LIMIT 500
  `;
  return ok(rows.map(mapMailRule));
};

export const getMailRule = async (context: MailRequestContext, mailboxId: string, ruleId: string): Promise<Result<MailRule>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  return loadMailRule(mailboxId, ruleId, sql);
};

export const previewMailRuleMatches = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: PreviewMailRuleMatchesInput;
}): Promise<Result<MailRuleMatchPreview>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const conditions = normalizePreviewConditions(params.input);
  if (!conditions.ok) return conditions;
  const incoming = await rejectOwnSenderTargets({
    mailboxId: params.mailboxId,
    conditions: conditions.data,
    db: sql,
  });
  if (!incoming.ok) return incoming;
  const [counts] = await sql<{ message_count: string | number; conversation_count: string | number }[]>`
    SELECT
      COUNT(DISTINCT remote_ref.id)::int AS message_count,
      COUNT(DISTINCT conversation_message.conversation_id)::int AS conversation_count
    ${mailRuleTargetFrom}
    WHERE resource.mailbox_id = ${params.mailboxId}::uuid
      AND remote_ref.stale_at IS NULL
      AND ${inboundMailRuleTarget}
      AND ${mailRuleCandidateSql(conditions.data)}
  `;
  const messageCount = Number(counts?.message_count ?? 0);
  return ok({
    messageCount,
    conversationCount: Number(counts?.conversation_count ?? 0),
    applicationLimit: EXISTING_MESSAGE_APPLICATION_LIMIT,
    capped: messageCount > EXISTING_MESSAGE_APPLICATION_LIMIT,
    exact: mailRulePreviewIsExact(conditions.data),
  });
};

export const markSenderMessagesRead = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: MarkSenderMessagesReadInput;
}): Promise<Result<MarkSenderMessagesReadResult>> => {
  const parsed = markSenderMessagesReadInputSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid sender read action"));
  const matchValue = normalizeSenderMatch(parsed.data.matchKind, parsed.data.matchValue);
  if (!matchValue.ok) return matchValue;
  const match = { kind: parsed.data.matchKind, value: matchValue.data };
  const actor = requestActor(params.context);
  const correlationId = `sender-read:${parsed.data.idempotencyKey}`;
  try {
    const outcome: { result: MarkSenderMessagesReadResult; commands: MailCommand[] } = await sql.begin(async (tx) => {
      unwrap(await requireMailboxPermission(params.context, params.mailboxId, "write", tx));
      unwrap(
        await rejectOwnSenderTargets({
          mailboxId: params.mailboxId,
          conditions: {
            mode: "all",
            items: [
              match.kind === "sender"
                ? { field: "sender_address", operator: "is", value: match.value }
                : { field: "sender_domain", operator: "is", value: match.value },
            ],
          },
          db: tx,
        }),
      );
      const [claimed] = await tx<{ id: string }[]>`
        INSERT INTO mail.sender_read_batches (
          mailbox_id, actor_kind, actor_id, idempotency_key, match_kind, match_value,
          command_ids, capped, application_limit
        ) VALUES (
          ${params.mailboxId}::uuid, ${actor.kind}, ${actor.id}::uuid, ${parsed.data.idempotencyKey},
          ${match.kind}, ${match.value}, ARRAY[]::uuid[], false, ${EXISTING_MESSAGE_APPLICATION_LIMIT}
        )
        ON CONFLICT (mailbox_id, actor_kind, actor_id, idempotency_key) DO NOTHING
        RETURNING id
      `;
      if (!claimed) {
        const [existing] = await tx<
          {
            match_kind: SenderMatchKind;
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
        if (existing.match_kind !== match.kind || existing.match_value !== match.value) {
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
        ${mailRuleTargetFrom}
        WHERE resource.mailbox_id = ${params.mailboxId}::uuid
          AND remote_ref.stale_at IS NULL
          AND ${inboundMailRuleTarget}
          AND NOT ('\\Seen' = ANY(placement.flags))
          AND ${senderMatchSql(match.kind, match.value)}
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
                    matchKind: match.kind,
                    matchValue: match.value,
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

const loadCurrentBackfillRule = async (input: MailRuleBackfillInput, db: SqlClient, lock = false): Promise<MailRule> => {
  const rule = unwrap(await loadMailRule(input.mailboxId, input.ruleId, db, lock));
  if (!rule.enabled) throw new Error("Mail rule is disabled");
  if (rule.workflowId !== input.workflowId || rule.workflowVersionId !== input.workflowVersionId) {
    throw new Error("Mail rule workflow version changed");
  }
  return rule;
};

let mailRuleBackfillPump: MailRuleBackfillPump | null = null;

const getMailRuleBackfillPump = (): MailRuleBackfillPump => {
  if (mailRuleBackfillPump) return mailRuleBackfillPump;
  mailRuleBackfillPump = pump<MailRuleBackfillInput, MailRuleBackfillCursor, MailRuleBackfillItem>({
    id: "mail.mail-rule-backfill",
    batchSize: 100,
    retry: { maxAttempts: 3, baseMs: 1_000, maxMs: 10_000, jitter: 0.2 },
    trace: trace.fromSyncPump<MailRuleBackfillInput, MailRuleBackfillCursor>({
      name: "Mail rule backfill",
      source: "mail:mail-rule-backfill",
      appId: "mail",
      attributes: (event) =>
        event.type === "submitted"
          ? {
              "mail.mailbox.id": event.input.mailboxId,
              "mail.mail_rule.id": event.input.ruleId,
              "mail.workflow.id": event.input.workflowId,
              "mail.workflow.version_id": event.input.workflowVersionId,
              "mail.backfill.operation_id": event.input.operationId,
            }
          : undefined,
    }),
    pull: async ({ input, cursor, limit }) => {
      await loadCurrentBackfillRule(input, sql);
      const afterCursor = cursor
        ? sql`
            AND (
              message.internal_date < ${cursor.internalDate}
              OR (message.internal_date = ${cursor.internalDate} AND remote_ref.id < ${cursor.remoteMessageRefId}::uuid)
            )
          `
        : sql``;
      const rows = await sql<{ remote_message_ref_id: string; internal_date: Date | string }[]>`
        SELECT DISTINCT remote_ref.id AS remote_message_ref_id, message.internal_date
        ${mailRuleTargetFrom}
        WHERE resource.mailbox_id = ${input.mailboxId}::uuid
          AND remote_ref.stale_at IS NULL
          AND remote_ref.first_seen_at <= ${input.cutoffAt}
          AND ${inboundMailRuleTarget}
          AND ${mailRuleCandidateSql(input.conditions)}
          AND NOT EXISTS (
            SELECT 1
            FROM workflows.event existing_event
            WHERE existing_event.app_id = ${MAIL_WORKFLOW_APP_ID}
              AND existing_event.scope_id = ${input.mailboxId}
              AND existing_event.type = ${MAIL_WORKFLOW_EVENT.messageReceived}
              AND existing_event.dedupe_key =
                ${mailRuleExistingDedupePrefix(input.ruleId, input.workflowVersionId)} || remote_ref.id::text
          )
          ${afterCursor}
        ORDER BY message.internal_date DESC, remote_ref.id DESC
        LIMIT ${limit}
      `;
      const last = rows.at(-1);
      return {
        items: rows.map((row) => ({ key: row.remote_message_ref_id, remoteMessageRefId: row.remote_message_ref_id })),
        nextCursor:
          rows.length === limit && last
            ? {
                internalDate: toIso(last.internal_date),
                remoteMessageRefId: last.remote_message_ref_id,
              }
            : null,
      };
    },
    dispatch: async ({ input, item }) => {
      await sql.begin(async (tx) => {
        const rule = await loadCurrentBackfillRule(input, tx, true);
        const snapshot = await getWorkflowSnapshot({
          mailboxId: input.mailboxId,
          remoteMessageRefId: item.remoteMessageRefId,
          db: tx,
        });
        if (!snapshot) return;
        await emitWorkflowEvent(
          {
            appId: MAIL_WORKFLOW_APP_ID,
            scopeId: input.mailboxId,
            type: MAIL_WORKFLOW_EVENT.messageReceived,
            targetWorkflowId: rule.workflowId,
            data: {
              message: snapshot.source.message as unknown as WorkflowJsonValue,
              conversation: snapshot.source.conversation as unknown as WorkflowJsonValue,
            },
            context: mailWorkflowEventContext(input.mailboxId, snapshot),
            dedupeKey: mailRuleExistingDedupeKey(rule.id, rule.workflowVersionId, snapshot.targetKey),
            occurredAt: new Date(snapshot.internalDate),
          },
          { db: tx },
        );
      });
    },
  });
  return mailRuleBackfillPump;
};

export const startMailRuleBackfillRuntime = (): void => {
  getMailRuleBackfillPump();
};

export const stopMailRuleBackfillRuntime = (): void => {
  mailRuleBackfillPump?.stop();
  mailRuleBackfillPump = null;
};

const loadMailRuleBackfillCounts = async (input: MailRuleBackfillInput): Promise<{ candidates: number; accepted: number }> => {
  const [row] = await sql<{ candidates: string | number; accepted: string | number }[]>`
    SELECT
      COUNT(DISTINCT remote_ref.id)::bigint AS candidates,
      COUNT(DISTINCT remote_ref.id) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM workflows.event existing_event
          WHERE existing_event.app_id = ${MAIL_WORKFLOW_APP_ID}
            AND existing_event.scope_id = ${input.mailboxId}
            AND existing_event.type = ${MAIL_WORKFLOW_EVENT.messageReceived}
            AND existing_event.dedupe_key =
              ${mailRuleExistingDedupePrefix(input.ruleId, input.workflowVersionId)} || remote_ref.id::text
        )
      )::bigint AS accepted
    ${mailRuleTargetFrom}
    WHERE resource.mailbox_id = ${input.mailboxId}::uuid
      AND remote_ref.stale_at IS NULL
      AND remote_ref.first_seen_at <= ${input.cutoffAt}
      AND ${inboundMailRuleTarget}
      AND ${mailRuleCandidateSql(input.conditions)}
  `;
  return { candidates: Number(row?.candidates ?? 0), accepted: Number(row?.accepted ?? 0) };
};

const mapMailRuleBackfill = async (state: PumpState<MailRuleBackfillInput, MailRuleBackfillCursor>): Promise<MailRuleBackfill> => {
  const counts = await loadMailRuleBackfillCounts(state.input);
  const newlyAcceptedCount = Math.min(state.dispatched, counts.accepted);
  return {
    operationId: state.input.operationId,
    ruleId: state.input.ruleId,
    workflowVersionId: state.input.workflowVersionId,
    state: state.state,
    candidateCount: counts.candidates,
    alreadyAcceptedCount: Math.max(0, counts.accepted - newlyAcceptedCount),
    newlyAcceptedCount,
    remainingCount: Math.max(0, counts.candidates - counts.accepted),
    failureCount: state.failureCount,
    lastError: state.lastError ?? null,
    createdAt: new Date(state.createdAt).toISOString(),
    updatedAt: new Date(state.updatedAt).toISOString(),
  };
};

const loadMailRuleBackfill = async (params: {
  mailboxId: string;
  ruleId: string;
  operationId: string;
}): Promise<Result<MailRuleBackfill>> => {
  const state = await getMailRuleBackfillPump().get({
    key: mailRuleBackfillKey(params.ruleId, params.operationId),
  });
  if (
    !state ||
    state.input.mailboxId !== params.mailboxId ||
    state.input.ruleId !== params.ruleId ||
    state.input.operationId !== params.operationId
  ) {
    return fail(err.notFound("Mail rule backfill"));
  }
  return ok(await mapMailRuleBackfill(state));
};

export const startMailRuleBackfill = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  ruleId: string;
  input: StartMailRuleBackfillInput;
}): Promise<Result<MailRuleBackfill>> => {
  const parsed = startMailRuleBackfillInputSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid mail rule backfill"));
  try {
    const rule = await sql.begin(async (tx) => {
      unwrap(await requireMailboxPermission(params.context, params.mailboxId, "admin", tx));
      const current = unwrap(await loadMailRule(params.mailboxId, params.ruleId, tx, true));
      if (current.revision !== parsed.data.expectedRevision) unwrap(fail(err.conflict("Mail rule was changed")));
      if (!current.enabled) unwrap(fail(err.badInput("Enable the mail rule before applying it to existing messages")));
      unwrap(
        await protectMailboxSenders({
          mailboxId: params.mailboxId,
          conditions: current.conditions,
          actions: current.actions,
          db: tx,
        }),
      );
      return current;
    });
    const state = await getMailRuleBackfillPump().start({
      key: mailRuleBackfillKey(rule.id, parsed.data.operationId),
      input: {
        operationId: parsed.data.operationId,
        mailboxId: params.mailboxId,
        ruleId: rule.id,
        workflowId: rule.workflowId,
        workflowVersionId: rule.workflowVersionId,
        conditions: rule.conditions,
        cutoffAt: new Date().toISOString(),
      },
    });
    if (
      state.input.mailboxId !== params.mailboxId ||
      state.input.ruleId !== rule.id ||
      state.input.operationId !== parsed.data.operationId ||
      state.input.workflowVersionId !== rule.workflowVersionId
    ) {
      return fail(err.conflict("Backfill operation id is already in use"));
    }
    await sql`
      UPDATE mail.mail_rules
      SET latest_backfill_operation_id = ${parsed.data.operationId}::uuid
      WHERE mailbox_id = ${params.mailboxId}::uuid
        AND id = ${rule.id}::uuid
        AND deleted_at IS NULL
    `;
    const result = ok(await mapMailRuleBackfill(state));
    return audit.recordResultAfterSideEffect({
      action: "mail.mail_rule.backfill.start",
      actor: auditActorFromRequest(params.context),
      target: { type: "mail_rule", id: rule.id, label: rule.name },
      requestId: params.context.requestId,
      metadata: {
        mailboxId: params.mailboxId,
        workflowId: rule.workflowId,
        workflowVersionId: rule.workflowVersionId,
        operationId: parsed.data.operationId,
      },
      result,
    });
  } catch (error) {
    return mutationFailure(error, "Failed to start mail rule backfill");
  }
};

export const getMailRuleBackfill = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  ruleId: string;
  operationId: string;
}): Promise<Result<MailRuleBackfill>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "admin");
  if (!allowed.ok) return allowed;
  try {
    return await loadMailRuleBackfill(params);
  } catch {
    return fail(err.internal("Failed to load mail rule backfill"));
  }
};

export const cancelMailRuleBackfill = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  ruleId: string;
  operationId: string;
}): Promise<Result<MailRuleBackfill>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "admin");
  if (!allowed.ok) return allowed;
  try {
    const current = await loadMailRuleBackfill(params);
    if (!current.ok) return current;
    if (!["queued", "running", "waiting"].includes(current.data.state)) return current;
    const canceled = await getMailRuleBackfillPump().cancel({
      key: mailRuleBackfillKey(params.ruleId, params.operationId),
    });
    const result = await loadMailRuleBackfill(params);
    if (!result.ok) return result;
    if (!canceled) return result;
    return audit.recordResultAfterSideEffect({
      action: "mail.mail_rule.backfill.cancel",
      actor: auditActorFromRequest(params.context),
      target: { type: "mail_rule", id: params.ruleId },
      requestId: params.context.requestId,
      metadata: { mailboxId: params.mailboxId, operationId: params.operationId },
      result,
    });
  } catch {
    return fail(err.internal("Failed to cancel mail rule backfill"));
  }
};

export const createMailRule = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: CreateMailRule;
}): Promise<Result<MailRule>> => {
  const parsed = createMailRuleSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid mail rule"));
  const ruleId = crypto.randomUUID();
  const name = normalizeName(parsed.data.name);
  const normalizedConditions = normalizeMailRuleConditions(parsed.data.conditions);
  if (!normalizedConditions.ok) return normalizedConditions;
  const conditions = normalizedConditions.data;
  try {
    const result = await sql.begin(async (tx) => {
      unwrap(await lockMailbox(params.context, params.mailboxId, tx));
      unwrap(
        await rejectOwnSenderTargets({
          mailboxId: params.mailboxId,
          conditions,
          db: tx,
        }),
      );
      const [count] = await tx<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM mail.mail_rules
        WHERE mailbox_id = ${params.mailboxId}::uuid AND deleted_at IS NULL
      `;
      if ((count?.count ?? 0) >= MAX_MAIL_RULES) {
        unwrap(fail(err.conflict(`A mailbox can have at most ${MAX_MAIL_RULES} mail rules`)));
      }
      unwrap(
        await protectMailboxSenders({
          mailboxId: params.mailboxId,
          conditions,
          actions: parsed.data.actions,
          db: tx,
        }),
      );
      unwrap(
        await protectAgainstConflictingRules({
          mailboxId: params.mailboxId,
          enabled: parsed.data.enabled,
          conditions,
          actions: parsed.data.actions,
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
          description: "Managed by Mail mail rules.",
          priority: 50,
          managedBy: "mail_rule",
          source: buildMailRuleWorkflowSource({ conditions, actions: parsed.data.actions }),
          effectBudget: workflowBudget(parsed.data.actions),
          enabled: parsed.data.enabled,
        }),
      );
      const [row] = await tx<MailRuleRow[]>`
        INSERT INTO mail.mail_rules AS rule (
          id, mailbox_id, workflow_id, name, normalized_name, conditions,
          actions, enabled, created_by_actor_kind, created_by_actor_id
        ) VALUES (
          ${ruleId}::uuid,
          ${params.mailboxId}::uuid,
          ${workflow.id}::uuid,
          ${name},
          lower(regexp_replace(${name}, '\\s+', ' ', 'g')),
          ${conditions}::jsonb,
          ${parsed.data.actions}::jsonb,
          ${parsed.data.enabled},
          ${actor.kind},
          ${actor.id}::uuid
        )
        RETURNING ${mailRuleColumns}
      `;
      if (!row) throw new Error("Mail rule insert returned no row");
      const rule = mapMailRule(row);
      const activityId = await recordActivity({ db: tx, context: params.context, rule, action: "mail_rule.created" });
      await audit.record(
        {
          action: "mail.mail_rule.create",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "mail_rule", id: rule.id, label: rule.name },
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
    return mutationFailure(error, "Failed to create mail rule");
  }
};

export const updateMailRule = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  ruleId: string;
  input: UpdateMailRule;
}): Promise<Result<MailRule>> => {
  const parsed = updateMailRuleSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid mail rule"));
  const name = normalizeName(parsed.data.name);
  const normalizedConditions = normalizeMailRuleConditions(parsed.data.conditions);
  if (!normalizedConditions.ok) return normalizedConditions;
  const conditions = normalizedConditions.data;
  try {
    const result = await sql.begin(async (tx) => {
      unwrap(await lockMailbox(params.context, params.mailboxId, tx));
      const current = unwrap(await loadMailRule(params.mailboxId, params.ruleId, tx, true));
      if (current.revision !== parsed.data.expectedRevision) unwrap(fail(err.conflict("Mail rule was changed")));
      unwrap(
        await rejectOwnSenderTargets({
          mailboxId: params.mailboxId,
          conditions,
          db: tx,
        }),
      );
      unwrap(
        await protectMailboxSenders({
          mailboxId: params.mailboxId,
          conditions,
          actions: parsed.data.actions,
          db: tx,
        }),
      );
      unwrap(
        await protectAgainstConflictingRules({
          mailboxId: params.mailboxId,
          ruleId: params.ruleId,
          enabled: parsed.data.enabled,
          conditions,
          actions: parsed.data.actions,
          db: tx,
        }),
      );
      const definitionChanged =
        sha256Json(current.conditions) !== sha256Json(conditions) ||
        JSON.stringify(current.actions) !== JSON.stringify(parsed.data.actions);
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
            description: "Managed by Mail mail rules.",
            priority: 50,
            managedBy: "mail_rule",
            source: buildMailRuleWorkflowSource({ conditions, actions: parsed.data.actions }),
            effectBudget: workflowBudget(parsed.data.actions),
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
        UPDATE mail.mail_rules
        SET
          name = ${name},
          normalized_name = lower(regexp_replace(${name}, '\\s+', ' ', 'g')),
          conditions = ${conditions}::jsonb,
          actions = ${parsed.data.actions}::jsonb,
          enabled = ${parsed.data.enabled},
          latest_backfill_operation_id = CASE WHEN ${definitionChanged} THEN NULL ELSE latest_backfill_operation_id END,
          revision = revision + 1
        WHERE id = ${params.ruleId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
      `;
      const rule = unwrap(await loadMailRule(params.mailboxId, params.ruleId, tx));
      const activityId = await recordActivity({ db: tx, context: params.context, rule, action: "mail_rule.updated" });
      await audit.record(
        {
          action: "mail.mail_rule.update",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "mail_rule", id: rule.id, label: rule.name },
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
    return mutationFailure(error, "Failed to update mail rule");
  }
};

export const setMailRuleEnabled = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  ruleId: string;
  input: SetMailRuleEnabled;
}): Promise<Result<MailRule>> => {
  const parsed = setMailRuleEnabledSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid mail rule state"));
  try {
    const result = await sql.begin(async (tx) => {
      unwrap(await lockMailbox(params.context, params.mailboxId, tx));
      const current = unwrap(await loadMailRule(params.mailboxId, params.ruleId, tx, true));
      if (current.revision !== parsed.data.expectedRevision) unwrap(fail(err.conflict("Mail rule was changed")));
      if (current.enabled === parsed.data.enabled) return { rule: current, activityId: null as string | null };
      if (parsed.data.enabled) {
        unwrap(
          await protectMailboxSenders({
            mailboxId: params.mailboxId,
            conditions: current.conditions,
            actions: current.actions,
            db: tx,
          }),
        );
        unwrap(
          await protectAgainstConflictingRules({
            mailboxId: params.mailboxId,
            ruleId: params.ruleId,
            enabled: true,
            conditions: current.conditions,
            actions: current.actions,
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
        UPDATE mail.mail_rules
        SET enabled = ${parsed.data.enabled}, revision = revision + 1
        WHERE id = ${params.ruleId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
      `;
      const rule = unwrap(await loadMailRule(params.mailboxId, params.ruleId, tx));
      const activityId = await recordActivity({ db: tx, context: params.context, rule, action: "mail_rule.updated" });
      await audit.record(
        {
          action: "mail.mail_rule.update",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "mail_rule", id: rule.id, label: rule.name },
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
    return mutationFailure(error, "Failed to change mail rule");
  }
};

export const deleteMailRule = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  ruleId: string;
  input: DeleteMailRule;
}): Promise<Result<MailRule>> => {
  const parsed = deleteMailRuleSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid mail rule deletion"));
  try {
    const result = await sql.begin(async (tx) => {
      unwrap(await lockMailbox(params.context, params.mailboxId, tx));
      const current = unwrap(await loadMailRule(params.mailboxId, params.ruleId, tx, true));
      if (current.revision !== parsed.data.expectedRevision) unwrap(fail(err.conflict("Mail rule was changed")));
      unwrap(
        await setManagedWorkflowEnabledInTransaction({
          db: tx,
          context: params.context,
          mailboxId: params.mailboxId,
          workflowId: current.workflowId,
          enabled: false,
        }),
      );
      const [row] = await tx<MailRuleRow[]>`
        UPDATE mail.mail_rules AS rule
        SET enabled = false, revision = revision + 1, deleted_at = now()
        WHERE rule.id = ${params.ruleId}::uuid AND rule.mailbox_id = ${params.mailboxId}::uuid
        RETURNING ${mailRuleColumns}
      `;
      if (!row) throw new Error("Deleted mail rule could not be reloaded");
      const rule = mapMailRule(row);
      const activityId = await recordActivity({ db: tx, context: params.context, rule, action: "mail_rule.deleted" });
      await audit.record(
        {
          action: "mail.mail_rule.delete",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "mail_rule", id: rule.id, label: rule.name },
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
    return mutationFailure(error, "Failed to delete mail rule");
  }
};
