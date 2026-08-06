import { err, fail, isServiceError, ok, type Result, unwrap } from "@k2b/stdlib";
import { audit } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import { stringify } from "yaml";
import {
  type CreateMailAiAutomation,
  createMailAiAutomationSchema,
  type DeleteMailAiAutomation,
  deleteMailAiAutomationSchema,
  type MailAiAutomationDefinition,
  type MailAiAutomationScope,
  type MailRuleAction,
  type SetMailAiAutomationEnabled,
  setMailAiAutomationEnabledSchema,
  type UpdateMailAiAutomation,
  updateMailAiAutomationSchema,
  type WorkflowEffectBudget,
} from "../contracts";
import { getMailWorkflowCatalogRef, type MailWorkflowCatalog } from "../workflows/catalog";
import { requireMailboxPermission } from "./access";
import { actorRefFromRequest, auditActorFromRequest, type MailRequestContext } from "./auth";
import { databaseErrorCode } from "./database-errors";
import { publishMailMailboxEvent } from "./events";
import { buildMailRuleActionStep, buildMailRuleConditionExpression, normalizeMailRuleConditions } from "./mail-rules";
import { loadMailWorkflowCatalog } from "./workflow-catalog-service";
import type { SqlClient } from "./workflow-data";
import { replaceManagedWorkflowInTransaction, setManagedWorkflowEnabledInTransaction } from "./workflow-definition-service";

export type MailAiAutomation = {
  id: string;
  mailboxId: string;
  workflowId: string;
  workflowVersionId: string;
  name: string;
  enabled: boolean;
  scope: MailAiAutomationScope;
  definition: MailAiAutomationDefinition;
  workflowSource: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

type MailAiAutomationRow = {
  id: string;
  mailbox_id: string;
  workflow_id: string;
  workflow_version_id: string;
  name: string;
  enabled: boolean;
  scope: MailAiAutomationScope | string;
  definition: MailAiAutomationDefinition | string;
  workflow_source: string;
  revision: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

type AutomationActor = { kind: "user" | "service_account"; id: string };

const MAX_AI_AUTOMATIONS = 100;
const automationColumns = sql`
  automation.id,
  automation.mailbox_id,
  automation.workflow_id,
  workflow.active_version_id AS workflow_version_id,
  automation.name,
  automation.enabled,
  automation.scope,
  automation.definition,
  version.source AS workflow_source,
  automation.revision,
  automation.created_at,
  automation.updated_at
`;

const parseJson = <T>(value: T | string): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);
const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const normalizeName = (value: string): string => value.trim().replace(/\s+/gu, " ");
const internalWorkflowName = (id: string): string => `Mail AI automation ${id}`;

const mapAutomation = (row: MailAiAutomationRow): MailAiAutomation => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  workflowId: row.workflow_id,
  workflowVersionId: row.workflow_version_id,
  name: row.name,
  enabled: row.enabled,
  scope: parseJson(row.scope),
  definition: parseJson(row.definition),
  workflowSource: row.workflow_source,
  revision: Number(row.revision),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const requestActor = (context: MailRequestContext): AutomationActor => {
  const actor = actorRefFromRequest(context);
  if (actor.kind === "user") return { kind: actor.kind, id: actor.userId };
  if (actor.kind === "service_account") return { kind: actor.kind, id: actor.serviceAccountId };
  throw new TypeError("Request actor cannot configure Mail AI automations");
};

const messageInput = {
  sender: "${{ inputs.message.fromAddress }}",
  subject: "${{ inputs.message.subject }}",
  body: "${{ inputs.message.bodyText }}",
};

const scopedSteps = (scope: MailAiAutomationScope, steps: Record<string, unknown>[]): Record<string, unknown>[] =>
  scope.mode === "all" ? steps : [{ if: buildMailRuleConditionExpression(scope.conditions), then: steps }];

const workflowInputs = (definition: MailAiAutomationDefinition) => ({
  message: { type: "mailMessage", required: true },
  ...(definition.kind === "draft" ? {} : { conversation: { type: "mailConversation", required: true } }),
});

const workflowTrigger = (definition: MailAiAutomationDefinition) => ({
  messageReceived: {
    with: {
      message: "${{ trigger.message }}",
      ...(definition.kind === "draft" ? {} : { conversation: "${{ trigger.conversation }}" }),
    },
  },
});

const routePrompt = (definition: Extract<MailAiAutomationDefinition, { kind: "route" }>): string =>
  `${definition.prompt}\n\nChoose exactly one category:\n${definition.categories
    .map((category) => `- ${category.name}: ${category.description}`)
    .join("\n")}`;

const tagPrompt = (definition: Extract<MailAiAutomationDefinition, { kind: "tag" }>, tagNames: ReadonlyMap<string, string>): string =>
  `${definition.prompt}\n\nSelect only matching tags:\n${definition.tags
    .map((tag) => `- ${tagNames.get(tag.tagId) ?? tag.tagId}: ${tag.description}`)
    .join("\n")}`;

export const buildMailAiAutomationWorkflowSource = (params: {
  scope: MailAiAutomationScope;
  definition: MailAiAutomationDefinition;
  tagNames?: ReadonlyMap<string, string>;
}): string => {
  const { definition } = params;
  let steps: Record<string, unknown>[];
  if (definition.kind === "route") {
    steps = [
      {
        aiClassify: {
          input: messageInput,
          prompt: routePrompt(definition),
          choices: definition.categories.map((category) => category.name),
          saveAs: "route",
        },
      },
      ...definition.categories.map((category) => ({
        if: { equals: ["${{ route }}", category.name] },
        then: category.actions.map(buildMailRuleActionStep),
      })),
    ];
  } else if (definition.kind === "tag") {
    const tagNames = params.tagNames ?? new Map<string, string>();
    const choices = definition.tags.map((tag) => tagNames.get(tag.tagId) ?? tag.tagId);
    steps = [
      {
        aiClassifyMany: {
          input: messageInput,
          prompt: tagPrompt(definition, tagNames),
          choices,
          maxChoices: definition.maxTags,
          saveAs: "tags",
        },
      },
      ...definition.tags.map((tag, index) => ({
        if: { includes: ["${{ tags }}", choices[index]] },
        then: [buildMailRuleActionStep({ kind: "add_local_tag", tagId: tag.tagId })],
      })),
    ];
  } else {
    steps = [
      {
        aiGenerateText: {
          prompt: `Write a concise email reply draft using only the supplied message. Do not invent facts, promises, or deadlines.\n\n${definition.instructions}`,
          input: messageInput,
          maxOutputChars: definition.maxOutputChars,
          saveAs: "reply",
        },
      },
      {
        createDraft: {
          sender: definition.senderIdentityId,
          to: [{ address: "${{ inputs.message.fromAddress }}" }],
          subject: "Re: {{ inputs.message.subject }}",
          body: "{{ reply }}",
          format: "markdown",
          saveAs: "draft",
        },
      },
    ];
  }
  return stringify(
    {
      inputs: workflowInputs(definition),
      triggers: workflowTrigger(definition),
      steps: scopedSteps(params.scope, steps),
    },
    { lineWidth: 0 },
  );
};

const collaborationAction = (action: MailRuleAction): boolean =>
  action.kind === "add_local_tag" || action.kind === "assign_user" || action.kind === "set_status";

export const mailAiAutomationBudget = (definition: MailAiAutomationDefinition): WorkflowEffectBudget => {
  const routeActions = definition.kind === "route" ? definition.categories.map((category) => category.actions) : [];
  return {
    maxTargets: 1,
    maxMoves: routeActions.some((actions) => actions.some((action) => action.kind === "move_to_folder")) ? 1 : 0,
    maxCopies: 0,
    maxSends: 0,
    maxDrafts: definition.kind === "draft" ? 1 : 0,
    maxFlagChanges: 0,
    maxNotifications: 0,
    maxKeywordChanges: 0,
    maxCollaborationChanges:
      definition.kind === "tag"
        ? definition.maxTags
        : Math.max(0, ...routeActions.map((actions) => actions.filter(collaborationAction).length)),
    maxAiCalls: 1,
  };
};

const normalizeScope = (scope: MailAiAutomationScope): Result<MailAiAutomationScope> => {
  if (scope.mode === "all") return ok(scope);
  const conditions = normalizeMailRuleConditions(scope.conditions);
  return conditions.ok ? ok({ mode: "matching", conditions: conditions.data }) : conditions;
};

const tagNamesFor = (definition: MailAiAutomationDefinition, catalog: MailWorkflowCatalog): Result<ReadonlyMap<string, string>> => {
  if (definition.kind !== "tag") return ok(new Map());
  const names = new Map<string, string>();
  for (const tag of definition.tags) {
    const entry = getMailWorkflowCatalogRef(catalog.localTags, tag.tagId);
    if (!entry) return fail(err.badInput("A selected local tag is unavailable"));
    names.set(tag.tagId, entry.name);
  }
  return ok(names);
};

const lockMailbox = async (context: MailRequestContext, mailboxId: string, db: SqlClient): Promise<Result<void>> => {
  const [mailbox] = await db<{ id: string }[]>`
    SELECT id FROM mail.mailboxes
    WHERE id = ${mailboxId}::uuid AND deleted_at IS NULL
    FOR UPDATE
  `;
  if (!mailbox) return fail(err.notFound("Mailbox"));
  const allowed = await requireMailboxPermission(context, mailboxId, "admin", db);
  return allowed.ok ? ok() : allowed;
};

const loadAutomation = async (
  mailboxId: string,
  automationId: string,
  db: SqlClient,
  lock = false,
  includeDeleted = false,
): Promise<Result<MailAiAutomation>> => {
  const [row] = await db<MailAiAutomationRow[]>`
    SELECT ${automationColumns}
    FROM mail.ai_automations automation
    JOIN workflows.workflow workflow ON workflow.id = automation.workflow_id
    JOIN workflows.version version ON version.id = workflow.active_version_id
    WHERE automation.id = ${automationId}::uuid
      AND automation.mailbox_id = ${mailboxId}::uuid
      AND ${includeDeleted ? sql`TRUE` : sql`automation.deleted_at IS NULL`}
    ${lock ? sql`FOR UPDATE OF automation` : sql``}
  `;
  return row ? ok(mapAutomation(row)) : fail(err.notFound("AI automation"));
};

const recordActivity = async (params: {
  db: SqlClient;
  context: MailRequestContext;
  automation: MailAiAutomation;
  action: "ai_automation.created" | "ai_automation.updated" | "ai_automation.deleted";
}): Promise<string> => {
  const actor = requestActor(params.context);
  const [activity] = await params.db<{ id: string | number }[]>`
    INSERT INTO mail.activity_events (
      mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
    ) VALUES (
      ${params.automation.mailboxId}::uuid,
      ${actor.kind},
      ${actor.id}::uuid,
      ${params.action},
      'confirmed',
      'ai_automation',
      ${params.automation.id}::uuid,
      ${{
        workflowId: params.automation.workflowId,
        kind: params.automation.definition.kind,
        enabled: params.automation.enabled,
        revision: params.automation.revision,
      }}::jsonb
    )
    RETURNING id
  `;
  if (!activity) throw new Error("AI automation activity insert returned no row");
  return String(activity.id);
};

const publishChange = async (automation: MailAiAutomation, activityId: string): Promise<void> =>
  publishMailMailboxEvent({
    mailboxId: automation.mailboxId,
    conversationId: null,
    reason: "ai_automation",
    targetId: automation.id,
    activityId,
  });

const mutationFailure = (error: unknown, fallback: string): Result<never> => {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    if (isServiceError(current)) return fail(current);
    current = (current as { cause?: unknown }).cause;
  }
  if (databaseErrorCode(error) === "23505") return fail(err.conflict("AI automation name already exists"));
  return fail(err.internal(fallback));
};

export const listMailAiAutomations = async (context: MailRequestContext, mailboxId: string): Promise<Result<MailAiAutomation[]>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<MailAiAutomationRow[]>`
    SELECT ${automationColumns}
    FROM mail.ai_automations automation
    JOIN workflows.workflow workflow ON workflow.id = automation.workflow_id
    JOIN workflows.version version ON version.id = workflow.active_version_id
    WHERE automation.mailbox_id = ${mailboxId}::uuid
      AND automation.deleted_at IS NULL
    ORDER BY automation.enabled DESC, automation.normalized_name, automation.id
    LIMIT ${MAX_AI_AUTOMATIONS}
  `;
  return ok(rows.map(mapAutomation));
};

export const getMailAiAutomation = async (
  context: MailRequestContext,
  mailboxId: string,
  automationId: string,
): Promise<Result<MailAiAutomation>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  return allowed.ok ? loadAutomation(mailboxId, automationId, sql) : allowed;
};

export const createMailAiAutomation = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: CreateMailAiAutomation;
}): Promise<Result<MailAiAutomation>> => {
  const parsed = createMailAiAutomationSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid AI automation"));
  const scope = normalizeScope(parsed.data.scope);
  if (!scope.ok) return scope;
  const automationId = crypto.randomUUID();
  const name = normalizeName(parsed.data.name);
  try {
    const result = await sql.begin(async (tx) => {
      unwrap(await lockMailbox(params.context, params.mailboxId, tx));
      const [count] = await tx<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM mail.ai_automations
        WHERE mailbox_id = ${params.mailboxId}::uuid AND deleted_at IS NULL
      `;
      if ((count?.count ?? 0) >= MAX_AI_AUTOMATIONS) {
        unwrap(fail(err.conflict(`A mailbox can have at most ${MAX_AI_AUTOMATIONS} AI automations`)));
      }
      const tagNames =
        parsed.data.definition.kind === "tag"
          ? unwrap(
              tagNamesFor(
                parsed.data.definition,
                await loadMailWorkflowCatalog({ context: params.context, mailboxId: params.mailboxId, db: tx }),
              ),
            )
          : new Map<string, string>();
      const workflow = unwrap(
        await replaceManagedWorkflowInTransaction({
          db: tx,
          context: params.context,
          mailboxId: params.mailboxId,
          workflowId: null,
          name: internalWorkflowName(automationId),
          description: "Managed by Mail guided AI automations.",
          priority: 50,
          managedBy: "ai_automation",
          source: buildMailAiAutomationWorkflowSource({ scope: scope.data, definition: parsed.data.definition, tagNames }),
          effectBudget: mailAiAutomationBudget(parsed.data.definition),
          enabled: parsed.data.enabled,
        }),
      );
      const actor = requestActor(params.context);
      const [inserted] = await tx<{ id: string }[]>`
        INSERT INTO mail.ai_automations (
          id, mailbox_id, workflow_id, name, normalized_name, enabled, scope, definition,
          created_by_actor_kind, created_by_actor_id
        ) VALUES (
          ${automationId}::uuid, ${params.mailboxId}::uuid, ${workflow.id}::uuid,
          ${name}, lower(regexp_replace(${name}, '\\s+', ' ', 'g')), ${parsed.data.enabled},
          ${scope.data}::jsonb, ${parsed.data.definition}::jsonb, ${actor.kind}, ${actor.id}::uuid
        )
        RETURNING id
      `;
      if (!inserted) throw new Error("AI automation insert returned no row");
      const automation = unwrap(await loadAutomation(params.mailboxId, automationId, tx));
      const activityId = await recordActivity({ db: tx, context: params.context, automation, action: "ai_automation.created" });
      await audit.record(
        {
          action: "mail.ai_automation.create",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "ai_automation", id: automation.id, label: automation.name },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, workflowId: automation.workflowId, kind: automation.definition.kind },
        },
        tx,
      );
      return { automation, activityId };
    });
    await publishChange(result.automation, result.activityId);
    return ok(result.automation);
  } catch (error) {
    return mutationFailure(error, "Failed to create AI automation");
  }
};

export const updateMailAiAutomation = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  automationId: string;
  input: UpdateMailAiAutomation;
}): Promise<Result<MailAiAutomation>> => {
  const parsed = updateMailAiAutomationSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid AI automation"));
  const scope = normalizeScope(parsed.data.scope);
  if (!scope.ok) return scope;
  const name = normalizeName(parsed.data.name);
  try {
    const result = await sql.begin(async (tx) => {
      unwrap(await lockMailbox(params.context, params.mailboxId, tx));
      const current = unwrap(await loadAutomation(params.mailboxId, params.automationId, tx, true));
      if (current.revision !== parsed.data.expectedRevision) unwrap(fail(err.conflict("AI automation was changed")));
      const definitionChanged =
        JSON.stringify(current.scope) !== JSON.stringify(scope.data) ||
        JSON.stringify(current.definition) !== JSON.stringify(parsed.data.definition);
      const enabledChanged = current.enabled !== parsed.data.enabled;
      if (current.name === name && !definitionChanged && !enabledChanged) {
        return { automation: current, activityId: null as string | null };
      }
      if (definitionChanged) {
        const tagNames =
          parsed.data.definition.kind === "tag"
            ? unwrap(
                tagNamesFor(
                  parsed.data.definition,
                  await loadMailWorkflowCatalog({ context: params.context, mailboxId: params.mailboxId, db: tx }),
                ),
              )
            : new Map<string, string>();
        unwrap(
          await replaceManagedWorkflowInTransaction({
            db: tx,
            context: params.context,
            mailboxId: params.mailboxId,
            workflowId: current.workflowId,
            name: internalWorkflowName(params.automationId),
            description: "Managed by Mail guided AI automations.",
            priority: 50,
            managedBy: "ai_automation",
            source: buildMailAiAutomationWorkflowSource({ scope: scope.data, definition: parsed.data.definition, tagNames }),
            effectBudget: mailAiAutomationBudget(parsed.data.definition),
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
        UPDATE mail.ai_automations
        SET name = ${name},
            normalized_name = lower(regexp_replace(${name}, '\\s+', ' ', 'g')),
            enabled = ${parsed.data.enabled},
            scope = ${scope.data}::jsonb,
            definition = ${parsed.data.definition}::jsonb,
            revision = revision + 1
        WHERE id = ${params.automationId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
      `;
      const automation = unwrap(await loadAutomation(params.mailboxId, params.automationId, tx));
      const activityId = await recordActivity({ db: tx, context: params.context, automation, action: "ai_automation.updated" });
      await audit.record(
        {
          action: "mail.ai_automation.update",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "ai_automation", id: automation.id, label: automation.name },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, workflowId: automation.workflowId, revision: automation.revision },
        },
        tx,
      );
      return { automation, activityId };
    });
    if (result.activityId) await publishChange(result.automation, result.activityId);
    return ok(result.automation);
  } catch (error) {
    return mutationFailure(error, "Failed to update AI automation");
  }
};

export const setMailAiAutomationEnabled = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  automationId: string;
  input: SetMailAiAutomationEnabled;
}): Promise<Result<MailAiAutomation>> => {
  const parsed = setMailAiAutomationEnabledSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid AI automation state"));
  try {
    const result = await sql.begin(async (tx) => {
      unwrap(await lockMailbox(params.context, params.mailboxId, tx));
      const current = unwrap(await loadAutomation(params.mailboxId, params.automationId, tx, true));
      if (current.revision !== parsed.data.expectedRevision) unwrap(fail(err.conflict("AI automation was changed")));
      if (current.enabled === parsed.data.enabled) return { automation: current, activityId: null as string | null };
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
        UPDATE mail.ai_automations
        SET enabled = ${parsed.data.enabled}, revision = revision + 1
        WHERE id = ${params.automationId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
      `;
      const automation = unwrap(await loadAutomation(params.mailboxId, params.automationId, tx));
      const activityId = await recordActivity({ db: tx, context: params.context, automation, action: "ai_automation.updated" });
      await audit.record(
        {
          action: "mail.ai_automation.update",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "ai_automation", id: automation.id, label: automation.name },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, workflowId: automation.workflowId, enabled: automation.enabled },
        },
        tx,
      );
      return { automation, activityId };
    });
    if (result.activityId) await publishChange(result.automation, result.activityId);
    return ok(result.automation);
  } catch (error) {
    return mutationFailure(error, "Failed to change AI automation");
  }
};

export const deleteMailAiAutomation = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  automationId: string;
  input: DeleteMailAiAutomation;
}): Promise<Result<MailAiAutomation>> => {
  const parsed = deleteMailAiAutomationSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid AI automation deletion"));
  try {
    const result = await sql.begin(async (tx) => {
      unwrap(await lockMailbox(params.context, params.mailboxId, tx));
      const current = unwrap(await loadAutomation(params.mailboxId, params.automationId, tx, true));
      if (current.revision !== parsed.data.expectedRevision) unwrap(fail(err.conflict("AI automation was changed")));
      unwrap(
        await setManagedWorkflowEnabledInTransaction({
          db: tx,
          context: params.context,
          mailboxId: params.mailboxId,
          workflowId: current.workflowId,
          enabled: false,
        }),
      );
      const [deleted] = await tx<{ id: string }[]>`
        UPDATE mail.ai_automations
        SET enabled = false, revision = revision + 1, deleted_at = now()
        WHERE id = ${params.automationId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
        RETURNING id
      `;
      if (!deleted) throw new Error("Deleted AI automation could not be reloaded");
      const automation = unwrap(await loadAutomation(params.mailboxId, params.automationId, tx, false, true));
      const activityId = await recordActivity({ db: tx, context: params.context, automation, action: "ai_automation.deleted" });
      await audit.record(
        {
          action: "mail.ai_automation.delete",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "ai_automation", id: automation.id, label: automation.name },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, workflowId: automation.workflowId, revision: automation.revision },
        },
        tx,
      );
      return { automation, activityId };
    });
    await publishChange(result.automation, result.activityId);
    return ok(result.automation);
  } catch (error) {
    return mutationFailure(error, "Failed to delete AI automation");
  }
};
