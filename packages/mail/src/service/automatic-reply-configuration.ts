import { audit } from "@valentinkolb/cloud/services";
import { err, fail, isServiceError, ok, type Result, unwrap } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { stringify } from "yaml";
import {
  type AutomaticReplyInactiveBehavior,
  type CreateAutomaticReplyConfiguration,
  createAutomaticReplyConfigurationSchema,
  type ResponseScheduleDefinitionInput,
  type UpdateAutomaticReplyConfiguration,
  updateAutomaticReplyConfigurationSchema,
  type WorkflowEffectBudget,
} from "../contracts";
import { requireMailboxPermission } from "./access";
import { actorRefFromRequest, auditActorFromRequest, type MailRequestContext } from "./auth";
import { cancelPendingAutomaticRepliesInTransaction } from "./automatic-reply";
import { requireAutomaticReplyManagementPermission } from "./automatic-reply-access";
import { publishMailMailboxEvent } from "./events";
import {
  decodeStoredResponseScheduleDefinition,
  normalizeResponseScheduleDefinition,
  type ResponseScheduleDefinition,
} from "./response-schedule";
import type { SqlClient } from "./workflow-data";
import { replaceManagedWorkflowInTransaction, setManagedWorkflowEnabledInTransaction } from "./workflow-definition-service";

export type AutomaticReplyConfiguration = {
  id: string;
  mailboxId: string;
  workflowId: string;
  name: string;
  enabled: boolean;
  senderIdentityId: string;
  subject: string;
  body: string;
  format: "plain" | "markdown";
  ensureReference: boolean;
  minimumIntervalHours: number;
  inactiveBehavior: AutomaticReplyInactiveBehavior;
  schedule: ResponseScheduleDefinition;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

type AutomaticReplyConfigurationRow = {
  id: string;
  mailbox_id: string;
  workflow_id: string;
  sender_identity_id: string;
  name: string;
  subject: string;
  body: string;
  format: "plain" | "markdown";
  ensure_reference: boolean;
  minimum_interval_hours: number;
  inactive_behavior: AutomaticReplyInactiveBehavior;
  enabled: boolean;
  revision: string | number;
  schedule_definition: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

type ConfigurationActor = { kind: "user" | "service_account"; id: string };

const configurationColumns = sql`
  configuration.id,
  configuration.mailbox_id,
  configuration.workflow_id,
  configuration.sender_identity_id,
  configuration.name,
  configuration.subject,
  configuration.body,
  configuration.format,
  configuration.ensure_reference,
  configuration.minimum_interval_hours,
  configuration.inactive_behavior,
  configuration.enabled,
  configuration.revision,
  configuration.schedule_definition,
  configuration.created_at,
  configuration.updated_at
`;

const managedWorkflowBudget = (ensureReference: boolean): WorkflowEffectBudget => ({
  maxTargets: 1,
  maxMoves: 0,
  maxSends: 1,
  maxKeywordChanges: 0,
  maxCollaborationChanges: ensureReference ? 1 : 0,
});

const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const normalizeName = (value: string): string => value.trim().replace(/\s+/gu, " ");
const internalResourceName = (id: string): string => `Automatic reply ${id}`;

const requestActor = (context: MailRequestContext): ConfigurationActor => {
  const actor = actorRefFromRequest(context);
  if (actor.kind === "user") return { kind: actor.kind, id: actor.userId };
  if (actor.kind === "service_account") return { kind: actor.kind, id: actor.serviceAccountId };
  throw new TypeError("Request actor cannot configure automatic replies");
};

const mapConfiguration = (row: AutomaticReplyConfigurationRow): Result<AutomaticReplyConfiguration> => {
  const schedule = decodeStoredResponseScheduleDefinition(row.schedule_definition);
  if (!schedule.ok) return schedule;
  return ok({
    id: row.id,
    mailboxId: row.mailbox_id,
    workflowId: row.workflow_id,
    name: row.name,
    enabled: row.enabled,
    senderIdentityId: row.sender_identity_id,
    subject: row.subject,
    body: row.body,
    format: row.format,
    ensureReference: row.ensure_reference,
    minimumIntervalHours: row.minimum_interval_hours,
    inactiveBehavior: row.inactive_behavior,
    schedule: schedule.data,
    revision: Number(row.revision),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
};

const buildWorkflowSource = (params: {
  senderIdentityId: string;
  schedule: ResponseScheduleDefinition;
  subject: string;
  body: string;
  format: "plain" | "markdown";
  ensureReference: boolean;
  minimumIntervalHours: number;
  inactiveBehavior: AutomaticReplyInactiveBehavior;
}): string =>
  stringify(
    {
      inputs: {
        message: { type: "mailMessage", required: true },
        conversation: { type: "mailConversation", required: true },
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
        ...(params.ensureReference
          ? [
              {
                ensureConversationReference: {
                  conversation: "${{ inputs.conversation }}",
                  result: "reference",
                },
              },
            ]
          : []),
        {
          automaticReply: {
            message: "${{ inputs.message }}",
            conversation: "${{ inputs.conversation }}",
            sender: params.senderIdentityId,
            schedule: params.schedule,
            subject: params.subject,
            body: params.body,
            format: params.format,
            minimumIntervalHours: params.minimumIntervalHours,
            inactiveBehavior: params.inactiveBehavior,
          },
        },
      ],
    },
    { lineWidth: 0 },
  );

const validateManagedSchedule = (definition: ResponseScheduleDefinitionInput): Result<ResponseScheduleDefinition> => {
  const schedule = normalizeResponseScheduleDefinition(definition);
  if (!schedule.ok) return schedule;
  if (
    schedule.data.weeklyWindows.length === 0 &&
    !schedule.data.exceptions.some((exception) => !exception.closed && exception.windows.length > 0)
  ) {
    return fail(err.badInput("At least one active response window is required"));
  }
  return schedule;
};

const requireAutomationSender = async (db: SqlClient, mailboxId: string, senderIdentityId: string): Promise<Result<void>> => {
  const [identity] = await db<{ id: string }[]>`
    SELECT id
    FROM mail.sender_identities
    WHERE id = ${senderIdentityId}::uuid
      AND mailbox_id = ${mailboxId}::uuid
      AND status = 'verified'
      AND automation_policy = 'mailbox'
    FOR SHARE
  `;
  return identity
    ? ok()
    : fail(err.badInput("Select a verified identity with Automatic replies enabled in Settings > Delivery > Sending identities"));
};

const requireReferenceConfiguration = async (db: SqlClient, mailboxId: string): Promise<Result<void>> => {
  const [configuration] = await db<{ mailbox_id: string }[]>`
    SELECT mailbox_id
    FROM mail.reference_number_configurations
    WHERE mailbox_id = ${mailboxId}::uuid AND enabled
    FOR SHARE
  `;
  return configuration ? ok() : fail(err.badInput("Set up and enable reference numbers before assigning them in an automatic reply"));
};

const requireActivationAvailable = async (db: SqlClient, mailboxId: string, configurationId: string | null): Promise<Result<void>> => {
  const [active] = await db<{ id: string }[]>`
    SELECT id
    FROM mail.automatic_reply_configurations
    WHERE mailbox_id = ${mailboxId}::uuid
      AND enabled
      AND (${configurationId}::uuid IS NULL OR id <> ${configurationId}::uuid)
    LIMIT 1
  `;
  return active ? fail(err.conflict("Disable the active automatic reply before enabling another one")) : ok();
};

const lockMailboxForAutomaticReply = async (context: MailRequestContext, mailboxId: string, db: SqlClient): Promise<Result<void>> => {
  const [mailbox] = await db<{ id: string }[]>`
    SELECT id
    FROM mail.mailboxes
    WHERE id = ${mailboxId}::uuid AND deleted_at IS NULL
    FOR UPDATE
  `;
  if (!mailbox) return fail(err.notFound("Mailbox"));
  const allowed = await requireAutomaticReplyManagementPermission(context, mailboxId, db);
  return allowed.ok ? ok() : allowed;
};

const insertActivity = async (params: {
  db: SqlClient;
  context: MailRequestContext;
  configuration: AutomaticReplyConfiguration;
  action: "automatic_reply_configuration.created" | "automatic_reply_configuration.updated";
}): Promise<string> => {
  const actor = requestActor(params.context);
  const [activity] = await params.db<{ id: string | number }[]>`
    INSERT INTO mail.activity_events (
      mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
    ) VALUES (
      ${params.configuration.mailboxId}::uuid,
      ${actor.kind},
      ${actor.id}::uuid,
      ${params.action},
      'confirmed',
      'automatic_reply_configuration',
      ${params.configuration.id}::uuid,
      ${{
        name: params.configuration.name,
        enabled: params.configuration.enabled,
        revision: params.configuration.revision,
        workflowId: params.configuration.workflowId,
      }}::jsonb
    )
    RETURNING id
  `;
  if (!activity) throw new Error("Automatic reply activity insert returned no row");
  return String(activity.id);
};

const databaseCode = (error: unknown): string | null => {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const value = current as { code?: unknown; errno?: unknown; sqlState?: unknown; cause?: unknown };
    for (const candidate of [value.errno, value.sqlState, value.code]) {
      if (typeof candidate === "string" || typeof candidate === "number") {
        const code = String(candidate);
        if (/^\d{5}$/.test(code)) return code;
      }
    }
    current = value.cause;
  }
  return null;
};

const mutationFailure = (error: unknown, fallback: string): Result<never> => {
  if (isServiceError(error)) return fail(error);
  if (databaseCode(error) === "23505") return fail(err.conflict("Automatic reply name already exists"));
  return fail(err.internal(fallback));
};

const loadConfiguration = async (
  mailboxId: string,
  configurationId: string,
  db: SqlClient,
  lock = false,
): Promise<Result<AutomaticReplyConfiguration>> => {
  const [row] = await db<AutomaticReplyConfigurationRow[]>`
    SELECT ${configurationColumns}
    FROM mail.automatic_reply_configurations configuration
    WHERE configuration.id = ${configurationId}::uuid
      AND configuration.mailbox_id = ${mailboxId}::uuid
    ${lock ? sql`FOR UPDATE OF configuration` : sql``}
  `;
  return row ? mapConfiguration(row) : fail(err.notFound("Automatic reply"));
};

export const listAutomaticReplyConfigurations = async (
  context: MailRequestContext,
  mailboxId: string,
): Promise<Result<AutomaticReplyConfiguration[]>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<AutomaticReplyConfigurationRow[]>`
    SELECT ${configurationColumns}
    FROM mail.automatic_reply_configurations configuration
    WHERE configuration.mailbox_id = ${mailboxId}::uuid
    ORDER BY configuration.enabled DESC, configuration.normalized_name, configuration.id
  `;
  const configurations: AutomaticReplyConfiguration[] = [];
  for (const row of rows) {
    const configuration = mapConfiguration(row);
    if (!configuration.ok) return configuration;
    configurations.push(configuration.data);
  }
  return ok(configurations);
};

export const createAutomaticReplyConfiguration = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: CreateAutomaticReplyConfiguration;
}): Promise<Result<AutomaticReplyConfiguration>> => {
  const parsed = createAutomaticReplyConfigurationSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid automatic reply"));
  const schedule = validateManagedSchedule(parsed.data.schedule);
  if (!schedule.ok) return schedule;
  const configurationId = crypto.randomUUID();
  const name = normalizeName(parsed.data.name);
  try {
    const result = await sql.begin(async (tx): Promise<{ configuration: AutomaticReplyConfiguration; activityId: string }> => {
      unwrap(await lockMailboxForAutomaticReply(params.context, params.mailboxId, tx));
      unwrap(await requireAutomationSender(tx, params.mailboxId, parsed.data.senderIdentityId));
      if (parsed.data.ensureReference) unwrap(await requireReferenceConfiguration(tx, params.mailboxId));
      if (parsed.data.enabled) unwrap(await requireActivationAvailable(tx, params.mailboxId, null));
      const actor = requestActor(params.context);
      const internalName = internalResourceName(configurationId);
      const workflow = unwrap(
        await replaceManagedWorkflowInTransaction({
          db: tx,
          context: params.context,
          mailboxId: params.mailboxId,
          workflowId: null,
          name: internalName,
          description: "Managed by Mail automatic replies.",
          priority: 100,
          source: buildWorkflowSource({
            senderIdentityId: parsed.data.senderIdentityId,
            schedule: schedule.data,
            subject: parsed.data.subject,
            body: parsed.data.body,
            format: parsed.data.format,
            ensureReference: parsed.data.ensureReference,
            minimumIntervalHours: parsed.data.minimumIntervalHours,
            inactiveBehavior: parsed.data.inactiveBehavior,
          }),
          effectBudget: managedWorkflowBudget(parsed.data.ensureReference),
          enabled: parsed.data.enabled,
        }),
      );
      const workflowId = workflow.id;
      const [row] = await tx<AutomaticReplyConfigurationRow[]>`
          INSERT INTO mail.automatic_reply_configurations (
            id, mailbox_id, workflow_id, sender_identity_id,
            name, normalized_name, subject, body, format, ensure_reference, minimum_interval_hours,
            inactive_behavior, schedule_definition, enabled, created_by_actor_kind, created_by_actor_id
          ) VALUES (
            ${configurationId}::uuid,
            ${params.mailboxId}::uuid,
            ${workflowId}::uuid,
            ${parsed.data.senderIdentityId}::uuid,
            ${name},
            lower(regexp_replace(${name}, '\\s+', ' ', 'g')),
            ${parsed.data.subject},
            ${parsed.data.body},
            ${parsed.data.format},
            ${parsed.data.ensureReference},
            ${parsed.data.minimumIntervalHours},
            ${parsed.data.inactiveBehavior},
            ${schedule.data}::jsonb,
            ${parsed.data.enabled},
            ${actor.kind},
            ${actor.id}::uuid
          )
          RETURNING
            id, mailbox_id, workflow_id, sender_identity_id,
            name, subject, body, format, ensure_reference, minimum_interval_hours, inactive_behavior,
            enabled, revision, schedule_definition, created_at, updated_at
      `;
      if (!row) throw new Error("Automatic reply insert returned no row");
      const configuration = unwrap(mapConfiguration(row));
      const activityId = await insertActivity({
        db: tx,
        context: params.context,
        configuration,
        action: "automatic_reply_configuration.created",
      });
      await audit.record(
        {
          action: "mail.automatic_reply_configuration.create",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "automatic_reply_configuration", id: configurationId, label: name },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, workflowId, enabled: parsed.data.enabled },
        },
        tx,
      );
      return { configuration, activityId };
    });
    await publishMailMailboxEvent({
      mailboxId: params.mailboxId,
      conversationId: null,
      reason: "automatic_reply",
      targetId: result.configuration.id,
      activityId: result.activityId,
    });
    return ok(result.configuration);
  } catch (error) {
    return mutationFailure(error, "Failed to create automatic reply");
  }
};

export const updateAutomaticReplyConfiguration = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  configurationId: string;
  input: UpdateAutomaticReplyConfiguration;
}): Promise<Result<AutomaticReplyConfiguration>> => {
  const parsed = updateAutomaticReplyConfigurationSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid automatic reply"));
  const schedule = validateManagedSchedule(parsed.data.schedule);
  if (!schedule.ok) return schedule;
  const name = normalizeName(parsed.data.name);
  try {
    const result = await sql.begin(async (tx): Promise<{ configuration: AutomaticReplyConfiguration; activityId: string | null }> => {
      unwrap(await lockMailboxForAutomaticReply(params.context, params.mailboxId, tx));
      const current = unwrap(await loadConfiguration(params.mailboxId, params.configurationId, tx, true));
      if (current.revision !== parsed.data.expectedRevision) {
        unwrap(fail(err.conflict("Automatic reply was changed")));
      }
      const senderChanged = current.senderIdentityId !== parsed.data.senderIdentityId;
      if (parsed.data.enabled || senderChanged) {
        unwrap(await requireAutomationSender(tx, params.mailboxId, parsed.data.senderIdentityId));
      }
      if (parsed.data.ensureReference && (parsed.data.enabled || !current.ensureReference)) {
        unwrap(await requireReferenceConfiguration(tx, params.mailboxId));
      }
      if (parsed.data.enabled) unwrap(await requireActivationAvailable(tx, params.mailboxId, params.configurationId));
      const scheduleChanged = JSON.stringify(current.schedule) !== JSON.stringify(schedule.data);
      const executionChanged =
        senderChanged ||
        current.subject !== parsed.data.subject ||
        current.body !== parsed.data.body ||
        current.format !== parsed.data.format ||
        current.ensureReference !== parsed.data.ensureReference ||
        current.minimumIntervalHours !== parsed.data.minimumIntervalHours ||
        current.inactiveBehavior !== parsed.data.inactiveBehavior ||
        scheduleChanged;
      const enabledChanged = current.enabled !== parsed.data.enabled;
      const changed = current.name !== name || enabledChanged || executionChanged;
      if (!changed) return { configuration: current, activityId: null };

      if (executionChanged || (enabledChanged && !parsed.data.enabled)) {
        await cancelPendingAutomaticRepliesInTransaction({
          db: tx,
          mailboxId: params.mailboxId,
          workflowId: current.workflowId,
          code: "AUTOMATIC_REPLY_CONFIGURATION_CHANGED",
          message: "Automatic reply configuration changed before delivery",
        });
      }
      if (executionChanged) {
        unwrap(
          await replaceManagedWorkflowInTransaction({
            db: tx,
            context: params.context,
            mailboxId: params.mailboxId,
            workflowId: current.workflowId,
            name: internalResourceName(params.configurationId),
            description: "Managed by Mail automatic replies.",
            priority: 100,
            source: buildWorkflowSource({
              senderIdentityId: parsed.data.senderIdentityId,
              schedule: schedule.data,
              subject: parsed.data.subject,
              body: parsed.data.body,
              format: parsed.data.format,
              ensureReference: parsed.data.ensureReference,
              minimumIntervalHours: parsed.data.minimumIntervalHours,
              inactiveBehavior: parsed.data.inactiveBehavior,
            }),
            effectBudget: managedWorkflowBudget(parsed.data.ensureReference),
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
          UPDATE mail.automatic_reply_configurations
          SET
            sender_identity_id = ${parsed.data.senderIdentityId}::uuid,
            name = ${name},
            normalized_name = lower(regexp_replace(${name}, '\\s+', ' ', 'g')),
            subject = ${parsed.data.subject},
            body = ${parsed.data.body},
            format = ${parsed.data.format},
            ensure_reference = ${parsed.data.ensureReference},
            minimum_interval_hours = ${parsed.data.minimumIntervalHours},
            inactive_behavior = ${parsed.data.inactiveBehavior},
            schedule_definition = ${schedule.data}::jsonb,
            enabled = ${parsed.data.enabled},
            revision = revision + 1
          WHERE id = ${params.configurationId}::uuid
            AND mailbox_id = ${params.mailboxId}::uuid
        `;
      const configuration = unwrap(await loadConfiguration(params.mailboxId, params.configurationId, tx));
      const activityId = await insertActivity({
        db: tx,
        context: params.context,
        configuration,
        action: "automatic_reply_configuration.updated",
      });
      await audit.record(
        {
          action: "mail.automatic_reply_configuration.update",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "automatic_reply_configuration", id: params.configurationId, label: name },
          requestId: params.context.requestId,
          metadata: {
            mailboxId: params.mailboxId,
            workflowId: current.workflowId,
            enabled: parsed.data.enabled,
            revision: configuration.revision,
          },
        },
        tx,
      );
      return { configuration, activityId };
    });
    if (result.activityId) {
      await publishMailMailboxEvent({
        mailboxId: params.mailboxId,
        conversationId: null,
        reason: "automatic_reply",
        targetId: result.configuration.id,
        activityId: result.activityId,
      });
    }
    return ok(result.configuration);
  } catch (error) {
    return mutationFailure(error, "Failed to update automatic reply");
  }
};
