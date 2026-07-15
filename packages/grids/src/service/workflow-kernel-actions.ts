import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import type {
  WorkflowActor,
  WorkflowBoundPlan,
  WorkflowExecutionError,
  WorkflowJsonValue,
  WorkflowPlanningOutcome,
  WorkflowStepOutcome,
} from "@valentinkolb/cloud/workflows";
import { workflowPathKey } from "@valentinkolb/cloud/workflows";
import { hashWorkflowJson, workflowMessageExpressions } from "@valentinkolb/cloud/workflows/language";
import type {
  WorkflowActionStep,
  WorkflowDryRunActionContext,
  WorkflowDryRunActionHandler,
  WorkflowDryRunActionPort,
  WorkflowExecuteActionContext,
  WorkflowExecuteActionHandler,
  WorkflowExecuteActionPort,
} from "@valentinkolb/cloud/workflows/runtime";
import type { DateContext } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { app } from "../config";
import type { DocumentRun, DocumentTemplate, EmailTemplate, GridRecord, Table } from "../contracts";
import { createWorkflowNotificationSender, type WorkflowNotificationSender } from "../notifications";
import type { GridsWorkflow, GridsWorkflowPrincipal } from "../workflows/contracts";
import { gridsWorkflowManifest } from "../workflows/manifest";
import { logAudit, type SqlClient } from "./audit";
import {
  buildTemplateAppData,
  buildTemplateBusinessData,
  createDocumentLink,
  createRunForRecord,
  type DocumentPdfRenderer,
  getDocumentRun,
  getTemplate,
  publicDocumentLinkUrl,
} from "./documents";
import * as emailTemplates from "./email-templates";
import { parseJsonbRow } from "./jsonb";
import { hasAtLeast, loadGrantsForUser, resolveEffectivePermission } from "./permission-resolver";
import { createInTransaction as createRecordInTransaction, updateInTransaction as updateRecordInTransaction } from "./record-write";
import { create as createRecord, get as getRecord, update as updateRecord } from "./records";
import { get as getTable } from "./tables";
import {
  finishWorkflowEmailDeliveryIntent,
  getOrCreateWorkflowEmailDeliveryIntent,
  getWorkflowEmailDeliveryIntent,
  type WorkflowEmailDeliveryIntent,
} from "./workflow-email-deliveries";
import { preflightWorkflowHttp, requestWorkflowHttp } from "./workflow-http-client";
import { getActiveWorkflowStepRunId } from "./workflow-kernel-runs";

type ActionEffect = "pure" | "transactional" | "durable-intent" | "ambiguous-external";
type PermissionLevel = "read" | "write" | "admin";
type RuntimeRecord = {
  kind: "record";
  tableId: string;
  recordId: string;
  data?: Record<string, WorkflowJsonValue>;
  planned?: boolean;
};

type ServiceError = { code: string; message: string; status?: number; retryable?: boolean };
type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: ServiceError };

export type GridsWorkflowActionPermissionTarget = { workflowId: string } | { tableId: string; documentTemplateId?: string };

export type GridsWorkflowActionServices = {
  requirePermission(input: {
    baseId: string;
    actor: WorkflowActor;
    target: GridsWorkflowActionPermissionTarget;
    required: PermissionLevel;
  }): Promise<boolean>;
  dateContext(): Promise<DateContext>;
  audit(input: Parameters<typeof logAudit>[0], client?: SqlClient): Promise<void>;
  getTable(id: string): Promise<Table | null>;
  getRecord(tableId: string, recordId: string): Promise<GridRecord | null>;
  createRecord(
    tableId: string,
    values: Record<string, unknown>,
    actorId: string | null,
    client?: SqlClient,
  ): Promise<ServiceResult<GridRecord>>;
  updateRecord(
    tableId: string,
    recordId: string,
    values: Record<string, unknown>,
    actorId: string | null,
    client?: SqlClient,
  ): Promise<ServiceResult<GridRecord>>;
  getDocumentTemplate(id: string): Promise<DocumentTemplate | null>;
  getDocumentRun(id: string): Promise<DocumentRun | null>;
  generateDocument(input: {
    template: DocumentTemplate;
    table: Table;
    recordId: string;
    actorId: string | null;
    client?: SqlClient;
    workflowRunId: string;
    workflowStepKey: string;
    filename: string | null;
    tags: string[];
    canReadRelatedTable(tableId: string): Promise<boolean>;
  }): Promise<ServiceResult<DocumentRun>>;
  createDocumentLink(input: {
    run: DocumentRun;
    expiresIn: "1d" | "7d" | "30d" | "90d";
    comment: string | null;
    actorId: string | null;
    client?: SqlClient;
  }): Promise<ServiceResult<{ id: string; token: string; expiresAt: string }>>;
  publicDocumentLinkUrl(token: string): Promise<string>;
  getEmailTemplate(id: string): Promise<EmailTemplate | null>;
  getActiveStepRunId(input: { runId: string; stepKey: string; executionGeneration: number }): Promise<string>;
  sendEmail(input: {
    template: EmailTemplate;
    recipients: Array<{ kind: "email" | "user"; value: string }>;
    data: Record<string, WorkflowJsonValue>;
    workflow: Pick<GridsWorkflow, "id" | "shortId" | "baseId" | "name">;
    runId: string;
    actorId: string | null;
    occurredAt: string;
    idempotencyKey: string;
    workflowStepRunId: string;
  }): Promise<ServiceResult<WorkflowJsonValue>>;
  httpRequest(input: {
    url: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    idempotencyKey: string;
  }): Promise<ServiceResult<{ status: number; ok: boolean; body: string; host: string }>>;
  httpRequestPreflight(input: {
    url: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  }): Promise<ServiceResult<{ host: string }>>;
};

export type GridsWorkflowEffectIntentInput = {
  runId: string;
  stepKey: string;
  effectKind: ActionEffect;
  idempotencyKey: string;
  request: WorkflowJsonValue;
};

type EffectIntentError = WorkflowExecutionError;
type PreparedEffectIntent =
  | { state: "execute" }
  | { state: "succeeded"; output?: WorkflowJsonValue }
  | { state: "failed"; error: EffectIntentError }
  | { state: "needs_attention"; error: EffectIntentError };

export type GridsWorkflowEffectIntentPort = {
  prepare(input: GridsWorkflowEffectIntentInput): Promise<PreparedEffectIntent>;
  executeTransactional(
    input: Omit<GridsWorkflowEffectIntentInput, "effectKind"> & { executionGeneration: number },
    perform: (client: SqlClient) => Promise<WorkflowJsonValue | undefined>,
  ): Promise<PreparedEffectIntent>;
  succeed(idempotencyKey: string, output?: WorkflowJsonValue): Promise<void>;
  retry(idempotencyKey: string, error: EffectIntentError): Promise<void>;
  fail(idempotencyKey: string, error: EffectIntentError): Promise<void>;
  needsAttention(idempotencyKey: string, error: EffectIntentError): Promise<void>;
};

export type GridsWorkflowActionPorts = {
  execute: WorkflowExecuteActionPort;
  dryRun: WorkflowDryRunActionPort;
};

export type CreateGridsWorkflowActionPortsOptions = {
  workflow: Pick<GridsWorkflow, "id" | "shortId" | "baseId" | "name">;
  principal?: GridsWorkflowPrincipal;
  authorizeExecution?: () => Promise<boolean>;
  authorizeTarget?: (target: GridsWorkflowActionPermissionTarget, required: PermissionLevel) => Promise<boolean>;
  services?: Partial<GridsWorkflowActionServices>;
  effectIntents?: GridsWorkflowEffectIntentPort;
  notificationSender?: WorkflowNotificationSender;
  documentPdfRenderer?: DocumentPdfRenderer;
};

const workflowPrincipalAuditMeta = (principal: GridsWorkflowPrincipal | undefined): Record<string, WorkflowJsonValue> => ({
  actorServiceAccountId: principal?.actorServiceAccountId ?? null,
  credentialId: principal?.credential?.id ?? null,
  credentialKind: principal?.credential?.kind ?? null,
  credentialScopes: principal?.credential?.scopes ?? [],
  credentialPermissionCap: principal?.credential?.permissionCap ?? null,
  credentialResourceBinding: principal?.credential?.resourceBinding ?? null,
});

class GridsWorkflowActionError extends Error {
  constructor(readonly executionError: WorkflowExecutionError) {
    super(executionError.message);
    this.name = "GridsWorkflowActionError";
  }
}

const actionError = (code: string, message: string, retryable = false): GridsWorkflowActionError =>
  new GridsWorkflowActionError({ code, message, retryable });

const serviceActionError = (error: ServiceError): GridsWorkflowActionError =>
  actionError(error.code || "GRIDS_ACTION_FAILED", error.message, error.retryable ?? (error.status !== undefined && error.status >= 500));

const requireServiceResult = <T>(result: ServiceResult<T>): T => {
  if (!result.ok) throw serviceActionError(result.error);
  return result.data;
};

const toJsonValue = (value: unknown): WorkflowJsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]));
  }
  return null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const recipientSummary = (kind: "email" | "user", value: string): string => {
  if (kind === "user") return `user:${value}`;
  const [name, domain] = value.split("@");
  return domain ? `${name?.slice(0, 2) ?? ""}***@${domain}` : "***";
};

const intentRecipient = (intent: WorkflowEmailDeliveryIntent) => {
  const recipient = intent.recipients[0];
  if (!recipient) throw actionError("WORKFLOW_EMAIL_INVALID", "Workflow email delivery recipient is missing");
  return recipient;
};

const stringConfig = (value: WorkflowJsonValue | undefined, label: string): string => {
  if (typeof value !== "string" || !value.trim()) throw actionError("WORKFLOW_ACTION_INVALID", `${label} must be text`);
  return value;
};

const objectConfig = (value: WorkflowJsonValue | undefined, label: string): Record<string, WorkflowJsonValue> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw actionError("WORKFLOW_ACTION_INVALID", `${label} must be an object`);
  }
  return value;
};

const isRuntimeRecord = (value: WorkflowJsonValue | undefined): value is RuntimeRecord =>
  Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.kind === "record" &&
      typeof value.tableId === "string" &&
      typeof value.recordId === "string",
  );

const actionPath = (step: WorkflowActionStep): Array<string | number> => [...step.sourcePath, step.action];

const boundString = (plan: WorkflowBoundPlan, path: Array<string | number>, label: string): string => {
  const value = plan.bindings[workflowPathKey(path)];
  if (typeof value !== "string" || !value) {
    throw actionError("WORKFLOW_BINDING_MISSING", `${label} has no stable binding`);
  }
  return value;
};

const actionEffects = new Map(gridsWorkflowManifest.actions.map((action) => [action.kind, action.effect as ActionEffect]));

export const gridsWorkflowActionEffect = (action: string): ActionEffect | undefined => actionEffects.get(action);

const defaultServices = (options: CreateGridsWorkflowActionPortsOptions): GridsWorkflowActionServices => {
  const notificationSender = options.notificationSender ?? createWorkflowNotificationSender(app.notifications);
  const dateContext = async (): Promise<DateContext> => ({
    timeZone: normalizeTimeZone(String((await settingsGet<string>("app.timezone")) || "").trim(), "UTC"),
    locale: "en",
    firstDayOfWeek: 1,
  });
  return {
    requirePermission: async ({ baseId, actor, target, required }) => {
      const grants = await loadGrantsForUser({
        userId: actor.userId ?? null,
        userGroups: actor.groupIds ?? [],
        serviceAccountId: actor.serviceAccountId ?? null,
        baseId,
        ...(target as GridsWorkflowActionPermissionTarget),
      });
      return hasAtLeast(resolveEffectivePermission(grants, { baseId, ...target }), required);
    },
    dateContext,
    audit: (input, client) => logAudit(input, client),
    getTable,
    getRecord: async (tableId, recordId) => getRecord(tableId, recordId, { includeRelations: true, dateConfig: await dateContext() }),
    createRecord: async (tableId, values, actorId, client) => {
      const config = await dateContext();
      if (!client) return createRecord(tableId, values, actorId, { dateConfig: config });
      const created = await createRecordInTransaction(client, tableId, values, actorId, { dateConfig: config });
      return created.ok ? { ok: true, data: created.data.record } : created;
    },
    updateRecord: async (tableId, recordId, values, actorId, client) => {
      const config = await dateContext();
      if (!client) return updateRecord(tableId, recordId, values, actorId, undefined, { dateConfig: config });
      const updated = await updateRecordInTransaction(client, tableId, recordId, values, actorId, undefined, { dateConfig: config });
      return updated.ok ? { ok: true, data: updated.data.record } : updated;
    },
    getDocumentTemplate: getTemplate,
    getDocumentRun,
    generateDocument: async (input) =>
      createRunForRecord({
        template: input.template,
        table: input.table,
        recordId: input.recordId,
        actorId: input.actorId,
        canReadRelatedTable: ({ tableId }) => input.canReadRelatedTable(tableId),
        dateConfig: await dateContext(),
        filename: input.filename,
        tags: input.tags,
        workflowRunId: input.workflowRunId,
        workflowStepKey: input.workflowStepKey,
        renderPdf: options.documentPdfRenderer,
      }),
    createDocumentLink: async (input) => {
      const created = await createDocumentLink({
        run: input.run,
        input: { expiresIn: input.expiresIn, comment: input.comment },
        actorId: input.actorId,
        client: input.client,
      });
      return created.ok
        ? { ok: true, data: { id: created.data.link.id, token: created.data.token, expiresAt: created.data.link.expiresAt } }
        : created;
    },
    publicDocumentLinkUrl,
    getEmailTemplate: emailTemplates.get,
    getActiveStepRunId: ({ runId, stepKey, executionGeneration }) =>
      getActiveWorkflowStepRunId({ runId, key: stepKey, executionGeneration }),
    sendEmail: async (input) => {
      const appData = await buildTemplateAppData();
      const rendered = await emailTemplates.renderEmailTemplate(input.template, {
        data: input.data,
        app: appData,
        business: await buildTemplateBusinessData(input.workflow.baseId, appData),
        workflow: { id: input.workflow.id, shortId: input.workflow.shortId, name: input.workflow.name },
        run: { id: input.runId },
        date: { iso: input.occurredAt },
      });
      if (!rendered.ok) return rendered;
      const intents: WorkflowEmailDeliveryIntent[] = [];
      for (const [recipientIndex, recipient] of input.recipients.entries()) {
        const index = recipientIndex + 1;
        const existing = await getWorkflowEmailDeliveryIntent(input.workflowStepRunId, index);
        intents.push(
          existing ??
            (await getOrCreateWorkflowEmailDeliveryIntent({
              baseId: input.workflow.baseId,
              workflowId: input.workflow.id,
              workflowRunId: input.runId,
              workflowStepRunId: input.workflowStepRunId,
              templateId: input.template.id,
              recipientIndex: index,
              recipientKind: recipient.kind,
              recipientValue: recipient.value,
              recipientSummary: recipientSummary(recipient.kind, recipient.value),
              idempotencyKey: `${input.idempotencyKey}:recipient:${index}`,
              subject: rendered.data.subject,
              renderedHtml: rendered.data.html,
            })),
        );
      }
      const recipients: WorkflowJsonValue[] = [];
      for (const intent of intents) {
        const recipient = intentRecipient(intent);
        if (intent.status !== "pending") {
          recipients.push({
            id: intent.notificationId ?? "",
            deliveryId: intent.id,
            kind: recipient.kind,
            recipient: recipient.recipient,
            status: intent.providerStatus ?? intent.status,
          });
          if (intent.status === "failed") {
            return { ok: false, error: { code: "WORKFLOW_EMAIL_FAILED", message: intent.error ?? "email delivery failed" } };
          }
          continue;
        }
        if (!intent.recipientValue || !intent.subject || !intent.renderedHtml) {
          return { ok: false, error: { code: "WORKFLOW_EMAIL_INVALID", message: "Pending email delivery is incomplete" } };
        }
        const sent = await notificationSender.send({
          kind: recipient.kind,
          recipient: intent.recipientValue,
          subject: intent.subject,
          html: intent.renderedHtml,
          idempotencyKey: intent.idempotencyKey,
          ...(input.actorId ? { sentBy: input.actorId } : {}),
        });
        const errorMessage = sent.status === "failed" ? (sent.error ?? "email delivery failed") : null;
        const delivery = await sql.begin(async (tx) => {
          const finished = await finishWorkflowEmailDeliveryIntent(
            intent.id,
            {
              notificationId: sent.id,
              providerStatus: sent.providerStatus,
              status: errorMessage ? "failed" : "sent",
              error: errorMessage,
            },
            tx,
          );
          if (finished.transitioned) {
            await logAudit(
              {
                baseId: input.workflow.baseId,
                userId: input.actorId,
                action: errorMessage ? "workflow.email.failed" : sent.status === "queued" ? "workflow.email.queued" : "workflow.email.sent",
                diff: {
                  workflowEmail: {
                    old: null,
                    new: {
                      ...workflowPrincipalAuditMeta(options.principal),
                      workflowId: input.workflow.id,
                      workflowRunId: input.runId,
                      templateId: input.template.id,
                      deliveryId: finished.delivery.id,
                      kind: recipient.kind,
                      recipient: recipient.recipient,
                      notificationId: sent.id,
                      status: sent.providerStatus,
                      ...(errorMessage ? { error: errorMessage } : { subject: intent.subject }),
                    },
                  },
                },
              },
              tx,
            );
          }
          return finished.delivery;
        });
        recipients.push({
          id: sent.id,
          deliveryId: delivery.id,
          kind: recipient.kind,
          recipient: recipient.recipient,
          status: sent.providerStatus,
        });
        if (errorMessage) return { ok: false, error: { code: "WORKFLOW_EMAIL_FAILED", message: errorMessage } };
      }
      return {
        ok: true,
        data: { templateId: input.template.id, subject: rendered.data.subject, recipients },
      };
    },
    httpRequest: requestWorkflowHttp,
    httpRequestPreflight: preflightWorkflowHttp,
  };
};

type EffectIntentRow = {
  run_id: string;
  step_key: string;
  effect_kind: "transactional" | "durable-intent" | "ambiguous-external";
  status: "pending" | "executing" | "succeeded" | "failed" | "needs_attention";
  request: unknown;
  result: unknown;
  error: unknown;
};

const interruptedEffectError = (): WorkflowExecutionError => ({
  code: "WORKFLOW_EFFECT_OUTCOME_UNKNOWN",
  message: "A previous effect attempt may have completed externally; automatic retry is disabled.",
  retryable: false,
});

export class SqlGridsWorkflowEffectIntents implements GridsWorkflowEffectIntentPort {
  private async assertIntentMatches(row: EffectIntentRow, input: GridsWorkflowEffectIntentInput): Promise<void> {
    if (
      row.run_id !== input.runId ||
      row.step_key !== input.stepKey ||
      row.effect_kind !== input.effectKind ||
      (await hashWorkflowJson(parseJsonbRow(row.request, null))) !== (await hashWorkflowJson(input.request))
    ) {
      throw actionError("WORKFLOW_EFFECT_CONFLICT", "Workflow effect intent does not match the interrupted step");
    }
  }

  async prepare(input: GridsWorkflowEffectIntentInput): Promise<PreparedEffectIntent> {
    return sql.begin(async (tx): Promise<PreparedEffectIntent> => {
      await tx`
        INSERT INTO grids.workflow_effect_intents (
          run_id, step_key, effect_kind, idempotency_key, status, request
        ) VALUES (
          ${input.runId}::uuid,
          ${input.stepKey},
          ${input.effectKind},
          ${input.idempotencyKey},
          'pending',
          ${input.request}::jsonb
        )
        ON CONFLICT (idempotency_key) DO NOTHING
      `;
      const [row] = await tx<EffectIntentRow[]>`
        SELECT run_id::text, step_key, effect_kind, status, request, result, error
        FROM grids.workflow_effect_intents
        WHERE idempotency_key = ${input.idempotencyKey}
        FOR UPDATE
      `;
      if (!row) throw actionError("WORKFLOW_EFFECT_INTENT_MISSING", "Workflow effect intent could not be loaded", true);
      await this.assertIntentMatches(row, input);
      if (row.status === "succeeded") {
        const result = parseJsonbRow<{ output?: WorkflowJsonValue }>(row.result, {});
        return { state: "succeeded", ...("output" in result ? { output: result.output } : {}) };
      }
      if (row.status === "failed") {
        return { state: "failed", error: parseJsonbRow(row.error, interruptedEffectError()) };
      }
      if (row.status === "needs_attention") {
        return { state: "needs_attention", error: parseJsonbRow(row.error, interruptedEffectError()) };
      }
      if (row.status === "executing") {
        if (input.effectKind === "durable-intent") {
          await tx`
            UPDATE grids.workflow_effect_intents
            SET status = 'pending', updated_at = now()
            WHERE idempotency_key = ${input.idempotencyKey} AND status = 'executing'
          `;
          row.status = "pending";
        } else {
          const error = interruptedEffectError();
          await tx`
            UPDATE grids.workflow_effect_intents
            SET status = 'needs_attention', error = ${error}::jsonb, updated_at = now()
            WHERE idempotency_key = ${input.idempotencyKey} AND status = 'executing'
          `;
          return { state: "needs_attention", error };
        }
      }
      const transitioned = await tx`
        UPDATE grids.workflow_effect_intents
        SET status = 'executing', attempts = attempts + 1, error = NULL, updated_at = now()
        WHERE idempotency_key = ${input.idempotencyKey} AND status = 'pending'
        RETURNING id
      `;
      if (transitioned.length === 0) throw actionError("WORKFLOW_EFFECT_INVALID", "Workflow effect intent could not be started");
      return { state: "execute" };
    });
  }

  async executeTransactional(
    input: Omit<GridsWorkflowEffectIntentInput, "effectKind"> & { executionGeneration: number },
    perform: (client: SqlClient) => Promise<WorkflowJsonValue | undefined>,
  ): Promise<PreparedEffectIntent> {
    return sql.begin(async (tx): Promise<PreparedEffectIntent> => {
      const [run] = await tx<Array<{ id: string }>>`
        SELECT id::text AS id
        FROM grids.workflow_runs
        WHERE id = ${input.runId}::uuid
          AND status = 'running'
          AND execution_generation = ${input.executionGeneration}
        FOR UPDATE
      `;
      if (!run) throw actionError("WORKFLOW_RUN_LEASE_LOST", "Workflow run lease is no longer active");
      const intentInput: GridsWorkflowEffectIntentInput = { ...input, effectKind: "transactional" };
      await tx`
        INSERT INTO grids.workflow_effect_intents (
          run_id, step_key, effect_kind, idempotency_key, status, request
        ) VALUES (
          ${input.runId}::uuid,
          ${input.stepKey},
          'transactional',
          ${input.idempotencyKey},
          'pending',
          ${input.request}::jsonb
        )
        ON CONFLICT (idempotency_key) DO NOTHING
      `;
      const [row] = await tx<EffectIntentRow[]>`
        SELECT run_id::text, step_key, effect_kind, status, request, result, error
        FROM grids.workflow_effect_intents
        WHERE idempotency_key = ${input.idempotencyKey}
        FOR UPDATE
      `;
      if (!row) throw actionError("WORKFLOW_EFFECT_INTENT_MISSING", "Workflow effect intent could not be loaded", true);
      await this.assertIntentMatches(row, intentInput);
      if (row.status === "succeeded") {
        const result = parseJsonbRow<{ output?: WorkflowJsonValue }>(row.result, {});
        return { state: "succeeded", ...("output" in result ? { output: result.output } : {}) };
      }
      if (row.status !== "pending") {
        throw actionError("WORKFLOW_EFFECT_INVALID", `Transactional workflow effect is ${row.status}`);
      }
      const started = await tx`
        UPDATE grids.workflow_effect_intents
        SET status = 'executing', attempts = attempts + 1, updated_at = now()
        WHERE idempotency_key = ${input.idempotencyKey} AND status = 'pending'
        RETURNING id
      `;
      if (started.length === 0) throw actionError("WORKFLOW_EFFECT_INVALID", "Transactional workflow effect could not be started");
      const output = await perform(tx);
      const finished = await tx`
        UPDATE grids.workflow_effect_intents
        SET status = 'succeeded', result = ${output === undefined ? {} : { output }}::jsonb, error = NULL, updated_at = now()
        WHERE idempotency_key = ${input.idempotencyKey} AND status = 'executing'
        RETURNING id
      `;
      if (finished.length === 0) throw actionError("WORKFLOW_EFFECT_INVALID", "Transactional workflow effect could not be finished");
      return { state: "succeeded", ...(output === undefined ? {} : { output }) };
    });
  }

  async succeed(idempotencyKey: string, output?: WorkflowJsonValue): Promise<void> {
    const rows = await sql`
      UPDATE grids.workflow_effect_intents
      SET status = 'succeeded', result = ${output === undefined ? {} : { output }}::jsonb, error = NULL, updated_at = now()
      WHERE idempotency_key = ${idempotencyKey} AND status = 'executing'
      RETURNING id
    `;
    if (rows.length === 0) throw actionError("WORKFLOW_EFFECT_INVALID", "Workflow effect intent could not be completed");
  }

  async fail(idempotencyKey: string, error: EffectIntentError): Promise<void> {
    const rows = await sql`
      UPDATE grids.workflow_effect_intents
      SET status = 'failed', error = ${error}::jsonb, updated_at = now()
      WHERE idempotency_key = ${idempotencyKey} AND status = 'executing'
      RETURNING id
    `;
    if (rows.length === 0) throw actionError("WORKFLOW_EFFECT_INVALID", "Workflow effect intent could not be failed");
  }

  async retry(idempotencyKey: string, error: EffectIntentError): Promise<void> {
    const rows = await sql`
      UPDATE grids.workflow_effect_intents
      SET status = 'pending', error = ${error}::jsonb, updated_at = now()
      WHERE idempotency_key = ${idempotencyKey} AND status = 'executing'
      RETURNING id
    `;
    if (rows.length === 0) throw actionError("WORKFLOW_EFFECT_INVALID", "Workflow effect intent could not be retried");
  }

  async needsAttention(idempotencyKey: string, error: EffectIntentError): Promise<void> {
    const rows = await sql`
      UPDATE grids.workflow_effect_intents
      SET status = 'needs_attention', error = ${error}::jsonb, updated_at = now()
      WHERE idempotency_key = ${idempotencyKey} AND status = 'executing'
      RETURNING id
    `;
    if (rows.length === 0) throw actionError("WORKFLOW_EFFECT_INVALID", "Workflow effect intent could not be suspended");
  }
}

const failedOutcome = (error: GridsWorkflowActionError): WorkflowStepOutcome => ({
  state: "failed",
  error: error.executionError,
});

const executeKnown = async (run: () => Promise<WorkflowStepOutcome>): Promise<WorkflowStepOutcome> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof GridsWorkflowActionError) return failedOutcome(error);
    throw error;
  }
};

const planKnown = async (run: () => Promise<WorkflowPlanningOutcome>): Promise<WorkflowPlanningOutcome> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof GridsWorkflowActionError) return { state: "indeterminate", reason: error.message };
    throw error;
  }
};

const effectDescription = (context: WorkflowDryRunActionContext, action: string): Record<string, WorkflowJsonValue> => ({
  kind: "grids.workflow.action",
  action,
  effect: gridsWorkflowActionEffect(action) ?? "pure",
  stepKey: context.step.key,
});

const saveAs = (
  context: Pick<WorkflowExecuteActionContext | WorkflowDryRunActionContext, "variables">,
  step: WorkflowActionStep,
  output: WorkflowJsonValue | undefined,
): void => {
  const name = step.config.saveAs;
  if (typeof name === "string" && output !== undefined) context.variables.set(name, output);
};

const actionHandler = (
  execute: WorkflowExecuteActionHandler["execute"],
  plan: WorkflowDryRunActionHandler["plan"],
  restore: "saveAs" | "setVariable" | null = "saveAs",
): { execute: WorkflowExecuteActionHandler; dryRun: WorkflowDryRunActionHandler } => {
  const restoreCompleted = (
    context: WorkflowExecuteActionContext | WorkflowDryRunActionContext,
    step: WorkflowActionStep,
    outcome: { output?: WorkflowJsonValue },
  ): void => {
    if (restore === "saveAs") saveAs(context, step, outcome.output);
    if (restore === "setVariable" && typeof step.config.name === "string" && outcome.output !== undefined) {
      context.variables.set(step.config.name, outcome.output);
    }
  };
  return {
    execute: { execute, ...(restore ? { restoreCompleted } : {}) },
    dryRun: { plan, ...(restore ? { restoreCompleted } : {}) },
  };
};

const actorId = (context: WorkflowExecuteActionContext | WorkflowDryRunActionContext): string | null =>
  context.invocation.actor.userId ?? null;

const workflowAuditMeta = (
  options: CreateGridsWorkflowActionPortsOptions,
  context: WorkflowExecuteActionContext,
): Record<string, WorkflowJsonValue> => ({
  workflowId: options.workflow.id,
  workflowRunId: context.run.runId,
  ...workflowPrincipalAuditMeta(
    options.principal ?? {
      userId: context.invocation.actor.userId ?? null,
      groupIds: context.invocation.actor.groupIds ?? [],
      serviceAccountId: context.invocation.actor.serviceAccountId ?? null,
      actorServiceAccountId: context.invocation.actor.serviceAccountId ?? null,
      credential: null,
    },
  ),
});

const requirePermission = async (
  services: GridsWorkflowActionServices,
  options: CreateGridsWorkflowActionPortsOptions,
  context: WorkflowExecuteActionContext | WorkflowDryRunActionContext,
  target: GridsWorkflowActionPermissionTarget,
  required: PermissionLevel,
): Promise<void> => {
  if (options.authorizeTarget) {
    if (!(await options.authorizeTarget(target, required))) {
      throw actionError("FORBIDDEN", "Workflow actor does not have permission for this action");
    }
    return;
  }
  const allowed = await services.requirePermission({
    baseId: options.workflow.baseId,
    actor: context.invocation.actor,
    target,
    required,
  });
  if (!allowed) throw actionError("FORBIDDEN", "Workflow actor does not have permission for this action");
};

const requireWorkflowPermission = async (
  services: GridsWorkflowActionServices,
  options: CreateGridsWorkflowActionPortsOptions,
  context: WorkflowExecuteActionContext | WorkflowDryRunActionContext,
): Promise<void> => {
  if (options.authorizeExecution) {
    if (!(await options.authorizeExecution())) {
      throw actionError("FORBIDDEN", "Workflow actor does not have permission for this action");
    }
    return;
  }
  await requirePermission(services, options, context, { workflowId: options.workflow.id }, "write");
};

const currentTable = async (
  services: GridsWorkflowActionServices,
  options: CreateGridsWorkflowActionPortsOptions,
  tableId: string,
): Promise<Table> => {
  const table = await services.getTable(tableId);
  if (!table || table.baseId !== options.workflow.baseId) throw actionError("NOT_FOUND", "Workflow table is no longer available");
  return table;
};

const currentRecord = async (
  services: GridsWorkflowActionServices,
  options: CreateGridsWorkflowActionPortsOptions,
  context: WorkflowExecuteActionContext | WorkflowDryRunActionContext,
  reference: RuntimeRecord,
  required: "read" | "write",
): Promise<GridRecord | null> => {
  await currentTable(services, options, reference.tableId);
  await requirePermission(services, options, context, { tableId: reference.tableId }, required);
  if (reference.planned) return null;
  const record = await services.getRecord(reference.tableId, reference.recordId);
  if (!record) throw actionError("NOT_FOUND", "Workflow record is no longer available");
  return record;
};

const recordReference = async (
  context: WorkflowExecuteActionContext | WorkflowDryRunActionContext,
  step: WorkflowActionStep,
  key: string,
): Promise<RuntimeRecord> => {
  const path = [...actionPath(step), key];
  const reference = stringConfig(step.config[key], `${step.action}.${key}`);
  const value = await context.resolveReference(reference, path);
  if (!isRuntimeRecord(value)) throw actionError("WORKFLOW_VALUE_INVALID", `${step.action}.${key} must resolve to a record`);
  return value;
};

const evaluatedFieldPayload = async (
  context: WorkflowExecuteActionContext | WorkflowDryRunActionContext,
  step: WorkflowActionStep,
  key: "set" | "values",
): Promise<Record<string, unknown>> => {
  const values = objectConfig(step.config[key], `${step.action}.${key}`);
  const payload: Record<string, unknown> = {};
  for (const [field, raw] of Object.entries(values)) {
    const path = [...actionPath(step), key, field];
    payload[boundString(context.plan, path, `${step.action}.${key}.${field}`)] = await context.evaluate(raw, path);
  }
  return payload;
};

const restoredIntentOutcome = (prepared: Exclude<PreparedEffectIntent, { state: "execute" }>): WorkflowStepOutcome => {
  if (prepared.state === "succeeded") return { state: "completed", ...(prepared.output === undefined ? {} : { output: prepared.output }) };
  return prepared.state === "failed" ? { state: "failed", error: prepared.error } : { state: "needs_attention", error: prepared.error };
};

const executeIntent = async (
  effectIntents: GridsWorkflowEffectIntentPort,
  context: WorkflowExecuteActionContext,
  step: WorkflowActionStep,
  request: WorkflowJsonValue,
  authorize: () => Promise<void>,
  perform: () => Promise<WorkflowJsonValue | undefined>,
): Promise<WorkflowStepOutcome> => {
  const effect = gridsWorkflowActionEffect(step.action);
  if (effect !== "durable-intent" && effect !== "ambiguous-external") {
    throw actionError("WORKFLOW_EFFECT_INVALID", `${step.action} is not an intent-backed action`);
  }
  await context.heartbeat();
  await authorize();
  const idempotencyKey = `workflow:${context.run.runId}:step:${context.step.key}`;
  const prepared = await effectIntents.prepare({
    runId: context.run.runId,
    stepKey: context.step.key,
    effectKind: effect,
    idempotencyKey,
    request,
  });
  if (prepared.state !== "execute") return restoredIntentOutcome(prepared);
  let output: WorkflowJsonValue | undefined;
  try {
    output = await perform();
  } catch (error) {
    if (error instanceof GridsWorkflowActionError) {
      if (effect === "ambiguous-external" && error.executionError.code === "WORKFLOW_HTTP_OUTCOME_UNKNOWN") {
        await effectIntents.needsAttention(idempotencyKey, error.executionError);
        return { state: "needs_attention", error: error.executionError };
      }
      if (effect === "durable-intent" && error.executionError.retryable) {
        await effectIntents.retry(idempotencyKey, error.executionError);
        return failedOutcome(error);
      }
      await effectIntents.fail(idempotencyKey, error.executionError);
      return failedOutcome(error);
    }
    const unknown = interruptedEffectError();
    await effectIntents.needsAttention(idempotencyKey, unknown);
    return { state: "needs_attention", error: unknown };
  }
  try {
    await effectIntents.succeed(idempotencyKey, output);
  } catch {
    const unknown = interruptedEffectError();
    await effectIntents.needsAttention(idempotencyKey, unknown).catch(() => undefined);
    return { state: "needs_attention", error: unknown };
  }
  return { state: "completed", ...(output === undefined ? {} : { output }) };
};

const executeTransactional = async (
  effectIntents: GridsWorkflowEffectIntentPort,
  context: WorkflowExecuteActionContext,
  step: WorkflowActionStep,
  request: WorkflowJsonValue,
  authorize: () => Promise<void>,
  perform: (client: SqlClient) => Promise<WorkflowJsonValue | undefined>,
): Promise<WorkflowStepOutcome> => {
  await context.heartbeat();
  await authorize();
  const prepared = await effectIntents.executeTransactional(
    {
      runId: context.run.runId,
      stepKey: context.step.key,
      executionGeneration: context.run.executionGeneration,
      idempotencyKey: `workflow:${context.run.runId}:step:${context.step.key}`,
      request,
    },
    perform,
  );
  if (prepared.state === "execute") throw actionError("WORKFLOW_EFFECT_INVALID", "Transactional effect was not committed");
  return restoredIntentOutcome(prepared);
};

const renderMessage = async (
  context: WorkflowExecuteActionContext | WorkflowDryRunActionContext,
  step: WorkflowActionStep,
): Promise<string> => {
  const message = stringConfig(step.config.message, `${step.action}.message`);
  let rendered = "";
  let offset = 0;
  for (const [index, expression] of workflowMessageExpressions(message).entries()) {
    rendered += message.slice(offset, expression.index);
    if (!expression.expression) throw actionError("WORKFLOW_ACTION_INVALID", `${step.action}.message contains an invalid expression`);
    const value =
      expression.expression.kind === "now"
        ? context.invocation.occurredAt
        : await context.resolveReference(expression.expression.reference, [...actionPath(step), "message", "expression", index]);
    rendered += value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
    offset = expression.index + expression.raw.length;
  }
  return `${rendered}${message.slice(offset)}`;
};

export const createGridsWorkflowActionPorts = (options: CreateGridsWorkflowActionPortsOptions): GridsWorkflowActionPorts => {
  const services = { ...defaultServices(options), ...options.services } as GridsWorkflowActionServices;
  const effectIntents = options.effectIntents ?? new SqlGridsWorkflowEffectIntents();
  const executeHandlers = new Map<string, WorkflowExecuteActionHandler>();
  const dryRunHandlers = new Map<string, WorkflowDryRunActionHandler>();
  const register = (
    name: string,
    execute: WorkflowExecuteActionHandler["execute"],
    plan: WorkflowDryRunActionHandler["plan"],
    restore: "saveAs" | "setVariable" | null = "saveAs",
  ): void => {
    const handler = actionHandler(execute, plan, restore);
    executeHandlers.set(name, handler.execute);
    dryRunHandlers.set(name, handler.dryRun);
  };

  register(
    "updateRecord",
    (context, step) =>
      executeKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        const record = await recordReference(context, step, "record");
        await currentRecord(services, options, context, record, "write");
        const values = await evaluatedFieldPayload(context, step, "set");
        const requestFingerprint = await hashWorkflowJson(toJsonValue(values));
        return executeTransactional(
          effectIntents,
          context,
          step,
          { action: step.action, tableId: record.tableId, recordId: record.recordId, fieldIds: Object.keys(values), requestFingerprint },
          async () => {
            await requireWorkflowPermission(services, options, context);
            await requirePermission(services, options, context, { tableId: record.tableId }, "write");
          },
          async (client) => {
            const updated = requireServiceResult(
              await services.updateRecord(record.tableId, record.recordId, values, actorId(context), client),
            );
            await services.audit(
              {
                baseId: options.workflow.baseId,
                tableId: record.tableId,
                recordId: record.recordId,
                userId: actorId(context),
                action: "workflow.record.updated",
                diff: {
                  workflowRecordUpdate: {
                    old: null,
                    new: { ...workflowAuditMeta(options, context), fields: Object.keys(values) },
                  },
                },
              },
              client,
            );
            return toJsonValue({ kind: "record", tableId: updated.tableId, recordId: updated.id });
          },
        );
      }),
    (context, step) =>
      planKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        const record = await recordReference(context, step, "record");
        await currentRecord(services, options, context, record, "write");
        await evaluatedFieldPayload(context, step, "set");
        return { state: "planned", output: record, effects: [effectDescription(context, step.action)] };
      }),
    null,
  );

  register(
    "createRecord",
    (context, step) =>
      executeKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        const tableId = boundString(context.plan, [...actionPath(step), "table"], "createRecord.table");
        await currentTable(services, options, tableId);
        await requirePermission(services, options, context, { tableId }, "write");
        const values = await evaluatedFieldPayload(context, step, "values");
        const requestFingerprint = await hashWorkflowJson(toJsonValue(values));
        const outcome = await executeTransactional(
          effectIntents,
          context,
          step,
          { action: step.action, tableId, fieldIds: Object.keys(values), requestFingerprint },
          async () => {
            await requireWorkflowPermission(services, options, context);
            await requirePermission(services, options, context, { tableId }, "write");
          },
          async (client) => {
            const created = requireServiceResult(await services.createRecord(tableId, values, actorId(context), client));
            await services.audit(
              {
                baseId: options.workflow.baseId,
                tableId,
                recordId: created.id,
                userId: actorId(context),
                action: "workflow.record.created",
                diff: {
                  workflowRecordCreate: {
                    old: null,
                    new: { ...workflowAuditMeta(options, context), fields: Object.keys(values) },
                  },
                },
              },
              client,
            );
            return toJsonValue({ kind: "record", tableId: created.tableId, recordId: created.id });
          },
        );
        if (outcome.state === "completed") saveAs(context, step, outcome.output);
        return outcome;
      }),
    (context, step) =>
      planKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        const tableId = boundString(context.plan, [...actionPath(step), "table"], "createRecord.table");
        await currentTable(services, options, tableId);
        await requirePermission(services, options, context, { tableId }, "write");
        const data = await evaluatedFieldPayload(context, step, "values");
        const output = toJsonValue({ kind: "record", tableId, recordId: `dry-run:${context.step.key}`, data, planned: true });
        saveAs(context, step, output);
        return { state: "planned", output, effects: [effectDescription(context, step.action)] };
      }),
  );

  register(
    "generateDocument",
    (context, step) =>
      executeKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        const templateId = boundString(context.plan, [...actionPath(step), "template"], "generateDocument.template");
        const template = await services.getDocumentTemplate(templateId);
        if (!template || !template.enabled) throw actionError("NOT_FOUND", "Document template is no longer available");
        const table = await currentTable(services, options, template.tableId);
        const record = await recordReference(context, step, "record");
        if (record.tableId !== table.id)
          throw actionError("WORKFLOW_VALUE_INVALID", "Document record does not belong to the template table");
        await currentRecord(services, options, context, record, "read");
        await requirePermission(services, options, context, { tableId: table.id, documentTemplateId: template.id }, "write");
        const filenameValue =
          step.config.filename === undefined ? null : await context.evaluate(step.config.filename, [...actionPath(step), "filename"]);
        const filename = typeof filenameValue === "string" ? filenameValue : null;
        const tagsValue = step.config.tags;
        const tags: string[] = [];
        if (Array.isArray(tagsValue)) {
          for (const [index, raw] of tagsValue.entries()) {
            const value = await context.evaluate(raw, [...actionPath(step), "tags", index]);
            if (typeof value === "string" && value.trim()) tags.push(value.trim());
          }
        }
        const requestFingerprint = await hashWorkflowJson({ filename, tags });
        const outcome = await executeIntent(
          effectIntents,
          context,
          step,
          { action: step.action, templateId, tableId: table.id, recordId: record.recordId, requestFingerprint },
          async () => {
            await requireWorkflowPermission(services, options, context);
            await requirePermission(services, options, context, { tableId: table.id }, "read");
            await requirePermission(services, options, context, { tableId: table.id, documentTemplateId: template.id }, "write");
          },
          async () => {
            const run = requireServiceResult(
              await services.generateDocument({
                template,
                table,
                recordId: record.recordId,
                actorId: actorId(context),
                workflowRunId: context.run.runId,
                workflowStepKey: context.step.key,
                filename,
                tags,
                canReadRelatedTable: async (tableId) => {
                  try {
                    await currentTable(services, options, tableId);
                    await requirePermission(services, options, context, { tableId }, "read");
                    return true;
                  } catch {
                    return false;
                  }
                },
              }),
            );
            await services.audit({
              baseId: options.workflow.baseId,
              tableId: run.tableId,
              recordId: run.recordId,
              userId: actorId(context),
              action: "workflow.document.generated",
              diff: {
                workflowDocumentGenerate: {
                  old: null,
                  new: {
                    ...workflowAuditMeta(options, context),
                    templateId: template.id,
                    documentRunId: run.id,
                    documentNumber: run.documentNumber,
                    filename: run.filename,
                  },
                },
              },
            });
            const output = toJsonValue(run);
            return output;
          },
        );
        if (outcome.state === "completed") saveAs(context, step, outcome.output);
        return outcome;
      }),
    (context, step) =>
      planKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        const templateId = boundString(context.plan, [...actionPath(step), "template"], "generateDocument.template");
        const template = await services.getDocumentTemplate(templateId);
        if (!template || !template.enabled) throw actionError("NOT_FOUND", "Document template is no longer available");
        await currentTable(services, options, template.tableId);
        const record = await recordReference(context, step, "record");
        if (record.tableId !== template.tableId)
          throw actionError("WORKFLOW_VALUE_INVALID", "Document record does not belong to the template table");
        await currentRecord(services, options, context, record, "read");
        await requirePermission(services, options, context, { tableId: template.tableId, documentTemplateId: template.id }, "write");
        if (step.config.filename !== undefined) await context.evaluate(step.config.filename, [...actionPath(step), "filename"]);
        if (Array.isArray(step.config.tags)) {
          await Promise.all(step.config.tags.map((tag, index) => context.evaluate(tag, [...actionPath(step), "tags", index])));
        }
        return { state: "planned", effects: [effectDescription(context, step.action)] };
      }),
  );

  register(
    "createDocumentLink",
    (context, step) =>
      executeKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        const reference = stringConfig(step.config.document, "createDocumentLink.document");
        const value = await context.resolveReference(reference, [...actionPath(step), "document"]);
        const runId = value && typeof value === "object" && !Array.isArray(value) && typeof value.id === "string" ? value.id : null;
        if (!runId) throw actionError("WORKFLOW_VALUE_INVALID", "createDocumentLink.document must resolve to a document");
        const run = await services.getDocumentRun(runId);
        if (!run || run.baseId !== options.workflow.baseId) throw actionError("NOT_FOUND", "Generated document is no longer available");
        await currentTable(services, options, run.tableId);
        await requirePermission(
          services,
          options,
          context,
          { tableId: run.tableId, ...(run.templateId ? { documentTemplateId: run.templateId } : {}) },
          "write",
        );
        const commentValue =
          step.config.comment === undefined ? null : await context.evaluate(step.config.comment, [...actionPath(step), "comment"]);
        const expiresIn =
          step.config.expiresIn === "1d" ||
          step.config.expiresIn === "7d" ||
          step.config.expiresIn === "30d" ||
          step.config.expiresIn === "90d"
            ? step.config.expiresIn
            : "30d";
        const comment = typeof commentValue === "string" ? commentValue : null;
        const requestFingerprint = await hashWorkflowJson({ expiresIn, comment });
        const outcome = await executeTransactional(
          effectIntents,
          context,
          step,
          { action: step.action, documentRunId: run.id, expiresIn, hasComment: comment !== null, requestFingerprint },
          async () => {
            await requireWorkflowPermission(services, options, context);
            await requirePermission(
              services,
              options,
              context,
              { tableId: run.tableId, ...(run.templateId ? { documentTemplateId: run.templateId } : {}) },
              "write",
            );
          },
          async (client) => {
            const created = requireServiceResult(
              await services.createDocumentLink({ run, expiresIn, comment, actorId: actorId(context), client }),
            );
            await services.audit(
              {
                baseId: options.workflow.baseId,
                tableId: run.tableId,
                recordId: run.recordId,
                userId: actorId(context),
                action: "workflow.document_link.created",
                diff: {
                  workflowDocumentLinkCreate: {
                    old: null,
                    new: {
                      ...workflowAuditMeta(options, context),
                      documentRunId: run.id,
                      documentLinkId: created.id,
                      expiresAt: created.expiresAt,
                    },
                  },
                },
              },
              client,
            );
            return toJsonValue({
              kind: "documentLink",
              id: created.id,
              documentRunId: run.id,
              url: await services.publicDocumentLinkUrl(created.token),
              expiresAt: created.expiresAt,
            });
          },
        );
        if (outcome.state === "completed") saveAs(context, step, outcome.output);
        return outcome;
      }),
    (context, step) =>
      planKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        const reference = stringConfig(step.config.document, "createDocumentLink.document");
        const value = await context.resolveReference(reference, [...actionPath(step), "document"]);
        const runId = value && typeof value === "object" && !Array.isArray(value) && typeof value.id === "string" ? value.id : null;
        if (!runId) throw actionError("WORKFLOW_VALUE_INVALID", "createDocumentLink.document must resolve to a document");
        const run = await services.getDocumentRun(runId);
        if (!run || run.baseId !== options.workflow.baseId) throw actionError("NOT_FOUND", "Generated document is no longer available");
        await currentTable(services, options, run.tableId);
        await requirePermission(services, options, context, { tableId: run.tableId }, "write");
        if (step.config.comment !== undefined) await context.evaluate(step.config.comment, [...actionPath(step), "comment"]);
        return { state: "planned", effects: [effectDescription(context, step.action)] };
      }),
  );

  const emailInput = async (context: WorkflowExecuteActionContext | WorkflowDryRunActionContext, step: WorkflowActionStep) => {
    const templateId = boundString(context.plan, [...actionPath(step), "template"], "sendEmail.template");
    const template = await services.getEmailTemplate(templateId);
    if (!template || template.baseId !== options.workflow.baseId || !template.enabled) {
      throw actionError("NOT_FOUND", "Email template is no longer available");
    }
    if (!Array.isArray(step.config.to) || step.config.to.length === 0) {
      throw actionError("WORKFLOW_ACTION_INVALID", "sendEmail.to requires at least one recipient");
    }
    const recipients: Array<{ kind: "email" | "user"; value: string }> = [];
    for (const [index, item] of step.config.to.entries()) {
      const recipient = objectConfig(item, `sendEmail.to.${index}`);
      const kind = "email" in recipient ? "email" : "user";
      const raw = recipient[kind];
      const value = await context.evaluate(raw!, [...actionPath(step), "to", index, kind]);
      if (typeof value !== "string" || !value.trim()) throw actionError("WORKFLOW_VALUE_INVALID", `sendEmail.${kind} must resolve to text`);
      const normalized = value.trim();
      if (kind === "email" && !EMAIL_RE.test(normalized)) {
        throw actionError("WORKFLOW_VALUE_INVALID", "sendEmail.email must resolve to an email address");
      }
      if (kind === "user" && !UUID_RE.test(normalized)) {
        throw actionError("WORKFLOW_VALUE_INVALID", "sendEmail.user must resolve to a Cloud user id");
      }
      recipients.push({ kind, value: normalized });
    }
    const data: Record<string, WorkflowJsonValue> = {};
    if (step.config.data !== undefined) {
      for (const [key, raw] of Object.entries(objectConfig(step.config.data, "sendEmail.data"))) {
        data[key] = await context.evaluate(raw, [...actionPath(step), "data", key]);
      }
    }
    return { template, recipients, data };
  };

  register(
    "sendEmail",
    (context, step) =>
      executeKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        const input = await emailInput(context, step);
        const requestFingerprint = await hashWorkflowJson(toJsonValue(input));
        const outcome = await executeIntent(
          effectIntents,
          context,
          step,
          {
            action: step.action,
            templateId: input.template.id,
            recipientKinds: input.recipients.map(({ kind }) => kind),
            requestFingerprint,
          },
          () => requireWorkflowPermission(services, options, context),
          async () => {
            const workflowStepRunId = await services.getActiveStepRunId({
              runId: context.run.runId,
              stepKey: context.step.key,
              executionGeneration: context.run.executionGeneration,
            });
            const output = requireServiceResult(
              await services.sendEmail({
                ...input,
                workflow: options.workflow,
                runId: context.run.runId,
                actorId: actorId(context),
                occurredAt: context.invocation.occurredAt,
                idempotencyKey: `workflow:${context.run.runId}:step:${context.step.key}`,
                workflowStepRunId,
              }),
            );
            return output;
          },
        );
        if (outcome.state === "completed") saveAs(context, step, outcome.output);
        return outcome;
      }),
    (context, step) =>
      planKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        await emailInput(context, step);
        return { state: "planned", effects: [effectDescription(context, step.action)] };
      }),
  );

  const httpInput = async (context: WorkflowExecuteActionContext | WorkflowDryRunActionContext, step: WorkflowActionStep) => {
    const url = stringConfig(step.config.url, "httpRequest.url");
    try {
      new URL(url);
    } catch {
      throw actionError("WORKFLOW_ACTION_INVALID", "httpRequest.url must be an absolute URL");
    }
    const rawMethod = step.config.method ?? "POST";
    if (rawMethod !== "GET" && rawMethod !== "POST" && rawMethod !== "PUT" && rawMethod !== "PATCH" && rawMethod !== "DELETE") {
      throw actionError("WORKFLOW_ACTION_INVALID", "httpRequest.method is invalid");
    }
    const method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = rawMethod;
    const headersValue =
      step.config.headers === undefined ? undefined : await context.evaluate(step.config.headers, [...actionPath(step), "headers"]);
    const headers =
      headersValue && typeof headersValue === "object" && !Array.isArray(headersValue)
        ? Object.fromEntries(Object.entries(headersValue).map(([key, value]) => [key, String(value)]))
        : undefined;
    const payload = step.config.json === undefined ? undefined : await context.evaluate(step.config.json, [...actionPath(step), "json"]);
    const timeoutMs = typeof step.config.timeoutMs === "number" ? step.config.timeoutMs : undefined;
    return { url, method, headers, payload, timeoutMs };
  };

  register(
    "httpRequest",
    (context, step) =>
      executeKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        const input = await httpInput(context, step);
        const requestFingerprint = await hashWorkflowJson(toJsonValue(input));
        const requestHost = new URL(input.url).host;
        const outcome = await executeIntent(
          effectIntents,
          context,
          step,
          { action: step.action, method: input.method, host: requestHost, requestFingerprint },
          () => requireWorkflowPermission(services, options, context),
          async () => {
            const response = requireServiceResult(
              await services.httpRequest({
                url: input.url,
                method: input.method,
                ...(input.headers ? { headers: input.headers } : {}),
                ...(input.payload === undefined ? {} : { body: JSON.stringify(input.payload) }),
                ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
                idempotencyKey: `workflow:${context.run.runId}:step:${context.step.key}`,
              }),
            );
            await services.audit({
              baseId: options.workflow.baseId,
              userId: actorId(context),
              action: response.ok ? "workflow.http.sent" : "workflow.http.failed",
              diff: {
                httpRequest: {
                  old: null,
                  new: {
                    ...workflowAuditMeta(options, context),
                    method: input.method,
                    host: response.host,
                    status: response.status,
                  },
                },
              },
            });
            if (!response.ok) throw actionError("WORKFLOW_HTTP_FAILED", `httpRequest returned HTTP ${response.status}`);
            const output = toJsonValue({ status: response.status, ok: response.ok, body: response.body });
            return output;
          },
        );
        if (outcome.state === "completed") saveAs(context, step, outcome.output);
        return outcome;
      }),
    (context, step) =>
      planKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        const input = await httpInput(context, step);
        requireServiceResult(
          await services.httpRequestPreflight({
            url: input.url,
            method: input.method,
            ...(input.headers ? { headers: input.headers } : {}),
            ...(input.payload === undefined ? {} : { body: JSON.stringify(input.payload) }),
            ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
          }),
        );
        return { state: "planned", effects: [effectDescription(context, step.action)] };
      }),
  );

  register(
    "setVariable",
    (context, step) =>
      executeKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        const name = stringConfig(step.config.name, "setVariable.name");
        const output = await context.evaluate(step.config.value!, [...actionPath(step), "value"]);
        context.variables.set(name, output);
        return { state: "completed", output };
      }),
    (context, step) =>
      planKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        const name = stringConfig(step.config.name, "setVariable.name");
        const output = await context.evaluate(step.config.value!, [...actionPath(step), "value"]);
        context.variables.set(name, output);
        return { state: "planned", output, effects: [effectDescription(context, step.action)] };
      }),
    "setVariable",
  );

  register(
    "fail",
    (context, step) =>
      executeKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        return {
          state: "failed",
          error: { code: "WORKFLOW_FAILED", message: await renderMessage(context, step), retryable: false },
        };
      }),
    (context, step) =>
      planKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        return {
          state: "terminal",
          status: "failed",
          message: await renderMessage(context, step),
          effects: [effectDescription(context, step.action)],
        };
      }),
    null,
  );

  register(
    "succeed",
    (context, step) =>
      executeKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        return { state: "terminal", status: "succeeded", message: await renderMessage(context, step) };
      }),
    (context, step) =>
      planKnown(async () => {
        await requireWorkflowPermission(services, options, context);
        return {
          state: "terminal",
          status: "succeeded",
          message: await renderMessage(context, step),
          effects: [effectDescription(context, step.action)],
        };
      }),
    null,
  );

  return {
    execute: { get: (action) => executeHandlers.get(action) },
    dryRun: { get: (action) => dryRunHandlers.get(action) },
  };
};
