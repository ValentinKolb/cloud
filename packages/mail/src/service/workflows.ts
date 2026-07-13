import { listUsersWithAccess } from "@valentinkolb/cloud/server";
import { audit, toPgTextArray } from "@valentinkolb/cloud/services";
import { toPgUuidArray } from "@valentinkolb/cloud/services/postgres";
import { err, fail, isServiceError, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type {
  CreateOneShotWorkflowRunInput,
  CreateSavedWorkflowRunInput,
  MailWorkflow,
  MailWorkflowDetail,
  MailWorkflowRun,
  MailWorkflowVersion,
  WorkflowAction,
  WorkflowCondition,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowPreview,
  WorkflowPreviewInput,
  WorkflowStep,
  WorkflowTargetQuery,
  WorkflowValidation,
} from "../contracts";
import { requireMailboxPermission } from "./access";
import { actorRefFromRequest, auditActorFromRequest, type MailRequestContext } from "./auth";
import { sha256Json } from "./canonical";
import { resolveMailExecution } from "./execution";
import { validateSearchComplexity } from "./search";
import { listWorkflowSnapshots, type WorkflowTargetSnapshot, workflowSourceStateHash } from "./workflow-data";
import { evaluateWorkflow, type PlannedWorkflowAction, validateWorkflowDefinition } from "./workflow-evaluator";
import { enqueueWorkflowRun } from "./workflow-runtime";

type SqlClient = typeof sql;

type DbWorkflow = {
  id: string;
  mailbox_id: string;
  lifecycle: "saved" | "one_shot";
  name: string;
  description: string | null;
  current_version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type DbWorkflowVersion = {
  id: string;
  workflow_id: string;
  mailbox_id: string;
  version: number;
  definition: WorkflowDefinition | string;
  definition_hash: string;
  created_at: Date | string;
};

export type DbWorkflowRun = {
  id: string;
  mailbox_id: string;
  workflow_id: string;
  workflow_version_id: string;
  workflow_version: number;
  trigger_type: "manual" | "backfill";
  state: MailWorkflowRun["state"];
  actor_kind: "user" | "service_account";
  actor_id: string;
  delegated_user_id: string | null;
  access_subject_kind: "user" | "service_account";
  access_subject_id: string;
  credential_scopes: string[] | null;
  idempotency_key: string;
  request_hash: string;
  target_query: WorkflowTargetQuery | string;
  preview_hash: string;
  target_count: number;
  action_target_count: number;
  completed_targets: number;
  failed_targets: number;
  action_counts: Record<string, number> | string;
  last_error_message: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  updated_at: Date | string;
};

type PreparedTarget = {
  snapshot: WorkflowTargetSnapshot;
  state: "ready" | "waiting_data";
  actions: PlannedWorkflowAction[];
};

type PreparedPreview = {
  preview: WorkflowPreview;
  targetSnapshotHash: string;
  targets: PreparedTarget[];
};

const workflowColumns = sql`
  workflow.id,
  workflow.mailbox_id,
  workflow.lifecycle,
  workflow.name,
  workflow.description,
  workflow.current_version,
  workflow.created_at,
  workflow.updated_at
`;

const versionColumns = sql`
  version.id,
  version.workflow_id,
  version.mailbox_id,
  version.version,
  version.definition,
  version.definition_hash,
  version.created_at
`;

export const workflowRunColumns = sql`
  run.id,
  run.mailbox_id,
  run.workflow_id,
  run.workflow_version_id,
  run.workflow_version,
  run.trigger_type,
  run.state,
  run.actor_kind,
  run.actor_id,
  run.delegated_user_id,
  run.access_subject_kind,
  run.access_subject_id,
  run.credential_scopes,
  run.idempotency_key,
  run.request_hash,
  run.target_query,
  run.preview_hash,
  run.target_count,
  run.action_target_count,
  run.completed_targets,
  run.failed_targets,
  run.action_counts,
  run.last_error_message,
  run.created_at,
  run.started_at,
  run.finished_at,
  run.updated_at
`;

const parseJson = <T>(value: T | string): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);
const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const toNullableIso = (value: Date | string | null): string | null => (value ? toIso(value) : null);

const mapWorkflow = (row: DbWorkflow): MailWorkflow => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  lifecycle: row.lifecycle,
  name: row.name,
  description: row.description,
  currentVersion: row.current_version,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const mapWorkflowVersion = (row: DbWorkflowVersion): MailWorkflowVersion => ({
  id: row.id,
  workflowId: row.workflow_id,
  mailboxId: row.mailbox_id,
  version: row.version,
  definition: parseJson(row.definition),
  definitionHash: row.definition_hash,
  createdAt: toIso(row.created_at),
});

export const mapWorkflowRun = (row: DbWorkflowRun): MailWorkflowRun => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  workflowId: row.workflow_id,
  workflowVersionId: row.workflow_version_id,
  workflowVersion: row.workflow_version,
  triggerType: row.trigger_type,
  state: row.state,
  query: parseJson(row.target_query),
  previewHash: row.preview_hash,
  targetCount: row.target_count,
  actionTargetCount: row.action_target_count,
  completedTargets: row.completed_targets,
  failedTargets: row.failed_targets,
  actionCounts: parseJson(row.action_counts),
  lastError: row.last_error_message,
  createdAt: toIso(row.created_at),
  startedAt: toNullableIso(row.started_at),
  finishedAt: toNullableIso(row.finished_at),
  updatedAt: toIso(row.updated_at),
});

const collectResources = (definition: WorkflowDefinition) => {
  const folders: Array<{ id: string; path: string }> = [];
  const assignees: Array<{ id: string; path: string }> = [];
  const visitCondition = (condition: WorkflowCondition, path: string): void => {
    if ("all" in condition) condition.all.forEach((child, index) => visitCondition(child, `${path}.all.${index}`));
    else if ("any" in condition) condition.any.forEach((child, index) => visitCondition(child, `${path}.any.${index}`));
    else if ("not" in condition) visitCondition(condition.not, `${path}.not`);
    else if (condition.field === "folder") folders.push({ id: condition.value, path });
  };
  const visitSteps = (steps: WorkflowStep[], path: string): void => {
    for (const [index, step] of steps.entries()) {
      const stepPath = `${path}.${index}`;
      if ("when" in step) {
        visitCondition(step.when, `${stepPath}.when`);
        visitSteps(step.then, `${stepPath}.then`);
        if (step.else) visitSteps(step.else, `${stepPath}.else`);
      } else if ("action" in step) {
        if (step.action === "remote.move") folders.push({ id: step.destinationFolderId, path: stepPath });
        if (step.action === "assign" && step.userId) assignees.push({ id: step.userId, path: stepPath });
      }
    }
  };
  visitSteps(definition.steps, "steps");
  return { folders, assignees };
};

const validateMailboxResources = async (
  mailboxId: string,
  definition: WorkflowDefinition,
  db: SqlClient = sql,
): Promise<WorkflowDiagnostic[]> => {
  const resources = collectResources(definition);
  const diagnostics: WorkflowDiagnostic[] = [];
  const folderIds = [...new Set(resources.folders.map((folder) => folder.id))];
  if (folderIds.length > 0) {
    const rows = await db<{ id: string }[]>`
      SELECT folder.id
      FROM mail.folders folder
      JOIN mail.remote_resources resource ON resource.id = folder.remote_resource_id
      WHERE resource.mailbox_id = ${mailboxId}::uuid
        AND folder.id = ANY(${toPgUuidArray(folderIds)}::uuid[])
        AND folder.discovery_state = 'active'
        AND folder.selectable
    `;
    const found = new Set(rows.map((row) => row.id));
    for (const folder of resources.folders) {
      if (!found.has(folder.id)) {
        diagnostics.push({
          severity: "error",
          code: "FOLDER_UNAVAILABLE",
          path: folder.path,
          message: "Folder must be an active selectable folder in this mailbox.",
        });
      }
    }
  }
  const assigneeIds = [...new Set(resources.assignees.map((assignee) => assignee.id))];
  if (assigneeIds.length > 0) {
    const accessRows = await db<{ access_id: string }[]>`
      SELECT access_id FROM mail.mailbox_access WHERE mailbox_id = ${mailboxId}::uuid
    `;
    const users = await listUsersWithAccess({
      accessIds: accessRows.map((row) => row.access_id),
      userIds: assigneeIds,
      minimumPermission: "write",
      limit: assigneeIds.length,
      db,
    });
    const found = new Set(users.map((user) => user.id));
    for (const assignee of resources.assignees) {
      if (!found.has(assignee.id)) {
        diagnostics.push({
          severity: "error",
          code: "ASSIGNEE_UNAVAILABLE",
          path: assignee.path,
          message: "Assignee must have current write access to this mailbox.",
        });
      }
    }
  }
  return diagnostics;
};

const validateForMailbox = async (mailboxId: string, input: unknown, db: SqlClient = sql): Promise<WorkflowValidation> => {
  const validation = validateWorkflowDefinition(input);
  if (!validation.definition) return validation;
  const diagnostics = [...validation.diagnostics, ...(await validateMailboxResources(mailboxId, validation.definition, db))];
  return { ...validation, valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"), diagnostics };
};

export const validateWorkflow = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  definition: unknown;
}): Promise<Result<WorkflowValidation>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  return ok(await validateForMailbox(params.mailboxId, params.definition));
};

const actionCategory = (action: WorkflowAction): "move" | "keyword" | "collaboration" => {
  if (action.action === "remote.move") return "move";
  if (action.action.startsWith("remote.keyword.")) return "keyword";
  return "collaboration";
};

const preparePreview = async (params: { mailboxId: string; input: WorkflowPreviewInput }): Promise<PreparedPreview> => {
  const queryHash = sha256Json(params.input.query);
  const validation = await validateForMailbox(params.mailboxId, params.input.definition);
  if (params.input.query.type === "search") {
    const complexity = validateSearchComplexity(params.input.query.expression);
    if (!complexity.ok) {
      validation.valid = false;
      validation.diagnostics.push({
        severity: "error",
        code: "QUERY_COMPLEXITY",
        path: "query.expression",
        message: complexity.error.message,
      });
    }
  }
  if (!validation.valid || !validation.definition || !validation.definitionHash) {
    return {
      preview: {
        validation,
        queryHash,
        previewHash: null,
        targetCount: 0,
        actionTargetCount: 0,
        waitingDataCount: 0,
        truncated: false,
        budgetExceeded: false,
        actionCounts: {},
        samples: [],
      },
      targetSnapshotHash: sha256Json([]),
      targets: [],
    };
  }

  const maxTargets = validation.definition.effectBudget.maxTargets;
  const snapshots = await sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '30s'`;
    return listWorkflowSnapshots({ mailboxId: params.mailboxId, query: params.input.query, limit: maxTargets + 1, db: tx });
  });
  const collaborationByConversation = new Map<string, NonNullable<WorkflowTargetSnapshot["collaboration"]>>();
  const targets: PreparedTarget[] = [];
  for (const originalSnapshot of snapshots) {
    const collaboration = originalSnapshot.conversationId
      ? (collaborationByConversation.get(originalSnapshot.conversationId) ?? originalSnapshot.collaboration)
      : null;
    const snapshot = {
      ...originalSnapshot,
      collaboration,
      sourceStateHash: workflowSourceStateHash({ ...originalSnapshot, collaboration }, originalSnapshot.remoteModseq),
    };
    const evaluation = evaluateWorkflow(validation.definition, snapshot);
    if (snapshot.conversationId && collaboration && evaluation.state === "ready") {
      const next = { ...collaboration };
      for (const planned of evaluation.actions) {
        if (planned.action.action === "assign") {
          next.assigneeUserId = planned.action.userId;
          next.revision += 1;
        } else if (planned.action.action === "status.set") {
          next.workStatus = planned.action.status;
          if (planned.action.status === "done") next.responseNeeded = false;
          next.revision += 1;
        }
      }
      collaborationByConversation.set(snapshot.conversationId, next);
    }
    targets.push({ snapshot, state: evaluation.state, actions: evaluation.actions });
  }
  const actionCounts: Record<string, number> = {};
  let actionTargetCount = 0;
  let waitingDataCount = 0;
  let moves = 0;
  let keywordChanges = 0;
  let collaborationChanges = 0;
  for (const target of targets) {
    if (target.state === "waiting_data") waitingDataCount += 1;
    if (target.actions.length > 0) actionTargetCount += 1;
    for (const planned of target.actions) {
      actionCounts[planned.action.action] = (actionCounts[planned.action.action] ?? 0) + 1;
      const category = actionCategory(planned.action);
      if (category === "move") moves += 1;
      else if (category === "keyword") keywordChanges += 1;
      else collaborationChanges += 1;
    }
  }
  const truncated = snapshots.length > maxTargets;
  const budget = validation.definition.effectBudget;
  const budgetExceeded =
    truncated ||
    moves > budget.maxMoves ||
    keywordChanges > budget.maxKeywordChanges ||
    collaborationChanges > budget.maxCollaborationChanges;
  const targetSnapshotHash = sha256Json(
    targets.map((target) => ({
      remoteMessageRefId: target.snapshot.remoteMessageRefId,
      sourceStateHash: target.snapshot.sourceStateHash,
      state: target.state,
      actions: target.actions.map(({ path, action, expectedConversationRevision }) => ({
        path,
        action,
        expectedConversationRevision,
      })),
    })),
  );
  const previewHash =
    waitingDataCount > 0 || budgetExceeded
      ? null
      : sha256Json({
          definitionHash: validation.definitionHash,
          queryHash,
          targetSnapshotHash,
          effectBudget: budget,
          actionCounts,
          targetCount: targets.length,
          actionTargetCount,
        });
  return {
    preview: {
      validation,
      queryHash,
      previewHash,
      targetCount: targets.length,
      actionTargetCount,
      waitingDataCount,
      truncated,
      budgetExceeded,
      actionCounts,
      samples: targets.slice(0, 20).map((target) => ({
        messageId: target.snapshot.messageId,
        conversationId: target.snapshot.conversationId,
        subject: target.snapshot.subject,
        state: target.state,
        actions: target.actions.map(({ path, action }) => ({ path, action })),
      })),
    },
    targetSnapshotHash,
    targets,
  };
};

export const previewWorkflow = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: WorkflowPreviewInput;
}): Promise<Result<WorkflowPreview>> => {
  const allowed = await resolveMailExecution({ mailboxId: params.mailboxId, operation: "actorRead", context: params.context });
  if (!allowed.ok) return allowed;
  return ok((await preparePreview(params)).preview);
};

export const listWorkflows = async (context: MailRequestContext, mailboxId: string): Promise<Result<MailWorkflow[]>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<DbWorkflow[]>`
    SELECT ${workflowColumns}
    FROM mail.workflows workflow
    WHERE workflow.mailbox_id = ${mailboxId}::uuid AND workflow.lifecycle = 'saved'
    ORDER BY lower(workflow.name), workflow.id
    LIMIT 200
  `;
  return ok(rows.map(mapWorkflow));
};

const loadWorkflowDetail = async (mailboxId: string, workflowId: string, db: SqlClient = sql): Promise<MailWorkflowDetail | null> => {
  const [workflow] = await db<DbWorkflow[]>`
    SELECT ${workflowColumns}
    FROM mail.workflows workflow
    WHERE workflow.mailbox_id = ${mailboxId}::uuid
      AND workflow.id = ${workflowId}::uuid
      AND workflow.lifecycle = 'saved'
  `;
  if (!workflow) return null;
  const [version] = await db<DbWorkflowVersion[]>`
    SELECT ${versionColumns}
    FROM mail.workflow_versions version
    WHERE version.workflow_id = ${workflowId}::uuid AND version.version = ${workflow.current_version}
  `;
  return version ? { ...mapWorkflow(workflow), version: mapWorkflowVersion(version) } : null;
};

export const getWorkflow = async (
  context: MailRequestContext,
  mailboxId: string,
  workflowId: string,
): Promise<Result<MailWorkflowDetail>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  const workflow = await loadWorkflowDetail(mailboxId, workflowId);
  return workflow ? ok(workflow) : fail(err.notFound("Workflow"));
};

export const listWorkflowVersions = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId: string;
}): Promise<Result<MailWorkflowVersion[]>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<DbWorkflowVersion[]>`
    SELECT ${versionColumns}
    FROM mail.workflow_versions version
    JOIN mail.workflows workflow ON workflow.id = version.workflow_id
    WHERE version.mailbox_id = ${params.mailboxId}::uuid
      AND version.workflow_id = ${params.workflowId}::uuid
      AND workflow.lifecycle = 'saved'
    ORDER BY version.version DESC
    LIMIT 200
  `;
  return rows.length > 0 ? ok(rows.map(mapWorkflowVersion)) : fail(err.notFound("Workflow"));
};

const creator = (context: MailRequestContext): { kind: "user" | "service_account"; id: string } => {
  const actor = actorRefFromRequest(context);
  if (actor.kind === "user") return { kind: "user", id: actor.userId };
  if (actor.kind === "service_account") return { kind: "service_account", id: actor.serviceAccountId };
  throw new Error("Request actor cannot create Mail workflows");
};

export const createWorkflow = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  definition: WorkflowDefinition;
}): Promise<Result<MailWorkflowDetail>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "admin");
  if (!allowed.ok) return allowed;
  const validation = await validateForMailbox(params.mailboxId, params.definition);
  if (!validation.valid || !validation.definition || !validation.definitionHash)
    return fail(err.badInput("Workflow definition is invalid"));
  const workflowId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const actor = creator(params.context);
  try {
    const result = await sql.begin(async (tx) => {
      const currentPermission = await requireMailboxPermission(params.context, params.mailboxId, "admin", tx);
      if (!currentPermission.ok) return currentPermission;
      const [workflow] = await tx<DbWorkflow[]>`
        INSERT INTO mail.workflows AS workflow (
          id, mailbox_id, lifecycle, name, description, current_version, created_by_kind, created_by_id
        ) VALUES (
          ${workflowId}::uuid, ${params.mailboxId}::uuid, 'saved', ${validation.definition!.name},
          ${validation.definition!.description ?? null}, 1, ${actor.kind}, ${actor.id}::uuid
        )
        RETURNING ${workflowColumns}
      `;
      const [version] = await tx<DbWorkflowVersion[]>`
        INSERT INTO mail.workflow_versions AS version (
          id, workflow_id, mailbox_id, version, definition, definition_hash, created_by_kind, created_by_id
        ) VALUES (
          ${versionId}::uuid, ${workflowId}::uuid, ${params.mailboxId}::uuid, 1,
          ${validation.definition!}::jsonb, ${validation.definitionHash}, ${actor.kind}, ${actor.id}::uuid
        )
        RETURNING ${versionColumns}
      `;
      if (!workflow || !version) throw new Error("Workflow insert returned no row");
      await audit.record(
        {
          action: "mail.workflow.create",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "workflow", id: workflowId },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, versionId, definitionHash: validation.definitionHash },
        },
        tx,
      );
      return ok({ ...mapWorkflow(workflow), version: mapWorkflowVersion(version) });
    });
    return result;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return fail(err.conflict("Workflow name"));
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to create workflow"));
  }
};

export const createWorkflowVersion = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId: string;
  definition: WorkflowDefinition;
}): Promise<Result<MailWorkflowDetail>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "admin");
  if (!allowed.ok) return allowed;
  const validation = await validateForMailbox(params.mailboxId, params.definition);
  if (!validation.valid || !validation.definition || !validation.definitionHash)
    return fail(err.badInput("Workflow definition is invalid"));
  const actor = creator(params.context);
  try {
    return await sql.begin(async (tx) => {
      const currentPermission = await requireMailboxPermission(params.context, params.mailboxId, "admin", tx);
      if (!currentPermission.ok) return currentPermission;
      const [current] = await tx<DbWorkflow[]>`
        SELECT ${workflowColumns}
        FROM mail.workflows workflow
        WHERE workflow.id = ${params.workflowId}::uuid
          AND workflow.mailbox_id = ${params.mailboxId}::uuid
          AND workflow.lifecycle = 'saved'
        FOR UPDATE
      `;
      if (!current) return fail(err.notFound("Workflow"));
      const nextVersion = current.current_version + 1;
      const [version] = await tx<DbWorkflowVersion[]>`
        INSERT INTO mail.workflow_versions AS version (
          workflow_id, mailbox_id, version, definition, definition_hash, created_by_kind, created_by_id
        ) VALUES (
          ${params.workflowId}::uuid, ${params.mailboxId}::uuid, ${nextVersion},
          ${validation.definition!}::jsonb, ${validation.definitionHash}, ${actor.kind}, ${actor.id}::uuid
        )
        RETURNING ${versionColumns}
      `;
      const [workflow] = await tx<DbWorkflow[]>`
        UPDATE mail.workflows workflow
        SET name = ${validation.definition!.name}, description = ${validation.definition!.description ?? null}, current_version = ${nextVersion}
        WHERE workflow.id = ${params.workflowId}::uuid
        RETURNING ${workflowColumns}
      `;
      if (!workflow || !version) throw new Error("Workflow version insert returned no row");
      await audit.record(
        {
          action: "mail.workflow.version.create",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "workflow", id: params.workflowId },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, version: nextVersion, versionId: version.id },
        },
        tx,
      );
      return ok({ ...mapWorkflow(workflow), version: mapWorkflowVersion(version) });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return fail(err.conflict("Workflow name"));
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to create workflow version"));
  }
};

const loadRunByIdempotency = async (
  mailboxId: string,
  idempotencyKey: string,
  db: SqlClient = sql,
  lock = false,
): Promise<DbWorkflowRun | null> => {
  const [row] = await db<DbWorkflowRun[]>`
    SELECT ${workflowRunColumns}
    FROM mail.workflow_runs run
    WHERE run.mailbox_id = ${mailboxId}::uuid AND run.idempotency_key = ${idempotencyKey}
    ${lock ? sql`FOR UPDATE` : sql``}
  `;
  return row ?? null;
};

const insertPreparedTargets = async (db: SqlClient, runId: string, targets: PreparedTarget[]): Promise<void> => {
  for (let offset = 0; offset < targets.length; offset += 1_000) {
    const rows = targets.slice(offset, offset + 1_000).map((target, index) => ({
      ordinal: offset + index,
      remote_message_ref_id: target.snapshot.remoteMessageRefId,
      message_id: target.snapshot.messageId,
      conversation_id: target.snapshot.conversationId,
      source_folder_id: target.snapshot.folderId,
      source_state_hash: target.snapshot.sourceStateHash,
      planned_action_count: target.actions.length,
    }));
    await db`
      INSERT INTO mail.workflow_run_targets (
        run_id, ordinal, remote_message_ref_id, message_id, conversation_id,
        source_folder_id, source_state_hash, planned_action_count
      )
      SELECT
        ${runId}::uuid, row.ordinal, row.remote_message_ref_id, row.message_id, row.conversation_id,
        row.source_folder_id, row.source_state_hash, row.planned_action_count
      FROM jsonb_to_recordset(${rows}::jsonb) AS row(
        ordinal bigint,
        remote_message_ref_id uuid,
        message_id uuid,
        conversation_id uuid,
        source_folder_id uuid,
        source_state_hash text,
        planned_action_count integer
      )
    `;
  }
  const steps = targets.flatMap((target, ordinal) =>
    target.actions.map((planned) => ({
      target_ordinal: ordinal,
      sequence: planned.sequence,
      step_path: planned.path,
      action: planned.action,
      expected_conversation_revision: planned.expectedConversationRevision,
      idempotency_key: `workflow:${runId}:${ordinal}:${planned.sequence}`,
    })),
  );
  for (let offset = 0; offset < steps.length; offset += 1_000) {
    const rows = steps.slice(offset, offset + 1_000);
    await db`
      INSERT INTO mail.workflow_step_runs (
        run_id, target_ordinal, sequence, step_path, action,
        expected_conversation_revision, idempotency_key
      )
      SELECT
        ${runId}::uuid, row.target_ordinal, row.sequence, row.step_path, row.action,
        row.expected_conversation_revision, row.idempotency_key
      FROM jsonb_to_recordset(${rows}::jsonb) AS row(
        target_ordinal bigint,
        sequence integer,
        step_path text,
        action jsonb,
        expected_conversation_revision bigint,
        idempotency_key text
      )
    `;
  }
};

const runPrincipal = (context: MailRequestContext) => {
  const actor = actorRefFromRequest(context);
  if (actor.kind !== "user" && actor.kind !== "service_account") {
    throw new Error("Request actor cannot run Mail workflows");
  }
  const actorKind = actor.kind;
  const actorId = actor.kind === "user" ? actor.userId : actor.serviceAccountId;
  const delegatedUserId = actor.kind === "service_account" ? actor.delegatedUserId : null;
  const accessSubjectId = context.accessSubject.type === "user" ? context.accessSubject.userId : context.accessSubject.serviceAccountId;
  return {
    actorKind,
    actorId,
    delegatedUserId,
    accessSubjectKind: context.accessSubject.type,
    accessSubjectId,
    credentialScopes: context.actor.kind === "service_account" ? context.actor.scopes : [],
  };
};

const persistRun = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  definition: WorkflowDefinition;
  definitionHash: string;
  query: WorkflowTargetQuery;
  preview: PreparedPreview;
  previewHash: string;
  idempotencyKey: string;
  requestHash: string;
  savedVersion?: DbWorkflowVersion;
  enqueue?: boolean;
}): Promise<Result<MailWorkflowRun>> => {
  const runId = crypto.randomUUID();
  const oneShotWorkflowId = crypto.randomUUID();
  const oneShotVersionId = crypto.randomUUID();
  const principal = runPrincipal(params.context);
  const createdBy = creator(params.context);
  try {
    const result = await sql.begin(async (tx) => {
      const currentPermission = await resolveMailExecution({
        mailboxId: params.mailboxId,
        operation: "actorMutation",
        context: params.context,
        db: tx,
      });
      if (!currentPermission.ok) return currentPermission;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${params.mailboxId}:${params.idempotencyKey}`}, 0))`;
      const existing = await loadRunByIdempotency(params.mailboxId, params.idempotencyKey, tx, true);
      if (existing) {
        return existing.request_hash === params.requestHash
          ? ok(mapWorkflowRun(existing))
          : fail(err.conflict("Idempotency key with a different workflow run"));
      }

      let workflowId = params.savedVersion?.workflow_id ?? oneShotWorkflowId;
      let workflowVersionId = params.savedVersion?.id ?? oneShotVersionId;
      let workflowVersion = params.savedVersion?.version ?? 1;
      if (!params.savedVersion) {
        await tx`
          INSERT INTO mail.workflows AS workflow (
            id, mailbox_id, lifecycle, name, description, current_version, created_by_kind, created_by_id
          ) VALUES (
            ${workflowId}::uuid, ${params.mailboxId}::uuid, 'one_shot', ${params.definition.name},
            ${params.definition.description ?? null}, 1, ${createdBy.kind}, ${createdBy.id}::uuid
          )
        `;
        await tx`
          INSERT INTO mail.workflow_versions AS version (
            id, workflow_id, mailbox_id, version, definition, definition_hash, created_by_kind, created_by_id
          ) VALUES (
            ${workflowVersionId}::uuid, ${workflowId}::uuid, ${params.mailboxId}::uuid, 1,
            ${params.definition}::jsonb, ${params.definitionHash}, ${createdBy.kind}, ${createdBy.id}::uuid
          )
        `;
      }
      const [run] = await tx<DbWorkflowRun[]>`
        INSERT INTO mail.workflow_runs AS run (
          id, mailbox_id, workflow_id, workflow_version_id, workflow_version, trigger_type,
          actor_kind, actor_id, delegated_user_id, access_subject_kind, access_subject_id,
          credential_scopes, idempotency_key, request_hash, target_query, query_hash,
          target_snapshot_hash, preview_hash, effect_budget, action_counts, target_count, action_target_count
        ) VALUES (
          ${runId}::uuid, ${params.mailboxId}::uuid, ${workflowId}::uuid, ${workflowVersionId}::uuid,
          ${workflowVersion}, ${params.definition.trigger.type}, ${principal.actorKind}, ${principal.actorId}::uuid,
          ${principal.delegatedUserId}::uuid, ${principal.accessSubjectKind}, ${principal.accessSubjectId}::uuid,
          ${toPgTextArray(principal.credentialScopes)}::text[], ${params.idempotencyKey}, ${params.requestHash},
          ${params.query}::jsonb, ${params.preview.preview.queryHash}, ${params.preview.targetSnapshotHash},
          ${params.previewHash}, ${params.definition.effectBudget}::jsonb, ${params.preview.preview.actionCounts}::jsonb,
          ${params.preview.preview.targetCount}, ${params.preview.preview.actionTargetCount}
        )
        RETURNING ${workflowRunColumns}
      `;
      if (!run) throw new Error("Workflow run insert returned no row");
      await insertPreparedTargets(tx, runId, params.preview.targets);
      await tx`
        INSERT INTO mail.activity_events (
          mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
        ) VALUES (
          ${params.mailboxId}::uuid, ${principal.actorKind}, ${principal.actorId}::uuid,
          'workflow.run', 'requested', 'workflow_run', ${runId}::uuid,
          ${{ workflowId, workflowVersionId, targetCount: params.preview.preview.targetCount }}::jsonb
        )
      `;
      await audit.record(
        {
          action: "mail.workflow.run.request",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "workflow_run", id: runId },
          requestId: params.context.requestId,
          metadata: {
            mailboxId: params.mailboxId,
            workflowId,
            workflowVersionId,
            targetCount: params.preview.preview.targetCount,
            actionCounts: params.preview.preview.actionCounts,
          },
        },
        tx,
      );
      return ok(mapWorkflowRun(run));
    });
    if (result.ok && params.enqueue !== false) await enqueueWorkflowRun(result.data.id).catch(() => undefined);
    return result;
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to create workflow run"));
  }
};

const existingRunResult = async (
  context: MailRequestContext,
  mailboxId: string,
  idempotencyKey: string,
  requestHash: string,
): Promise<Result<MailWorkflowRun> | null> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "write");
  if (!allowed.ok) return allowed;
  const existing = await loadRunByIdempotency(mailboxId, idempotencyKey);
  if (!existing) return null;
  return existing.request_hash === requestHash
    ? ok(mapWorkflowRun(existing))
    : fail(err.conflict("Idempotency key with a different workflow run"));
};

export const createOneShotRun = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: CreateOneShotWorkflowRunInput;
  enqueue?: boolean;
}): Promise<Result<MailWorkflowRun>> => {
  const allowed = await resolveMailExecution({ mailboxId: params.mailboxId, operation: "actorMutation", context: params.context });
  if (!allowed.ok) return allowed;
  const validation = validateWorkflowDefinition(params.input.definition);
  if (!validation.valid || !validation.definition || !validation.definitionHash)
    return fail(err.badInput("Workflow definition is invalid"));
  const requestHash = sha256Json({
    kind: "one_shot",
    definitionHash: validation.definitionHash,
    query: params.input.query,
    previewHash: params.input.previewHash,
  });
  const existing = await existingRunResult(params.context, params.mailboxId, params.input.idempotencyKey, requestHash);
  if (existing) return existing;
  const prepared = await preparePreview({
    mailboxId: params.mailboxId,
    input: { definition: validation.definition, query: params.input.query },
  });
  if (!prepared.preview.previewHash || prepared.preview.previewHash !== params.input.previewHash) {
    return fail(err.conflict("Workflow preview is stale or cannot be executed"));
  }
  return persistRun({
    context: params.context,
    mailboxId: params.mailboxId,
    definition: validation.definition,
    definitionHash: validation.definitionHash,
    query: params.input.query,
    preview: prepared,
    previewHash: params.input.previewHash,
    idempotencyKey: params.input.idempotencyKey,
    requestHash,
    enqueue: params.enqueue,
  });
};

const loadSavedVersion = async (params: { mailboxId: string; workflowId: string; version?: number }): Promise<DbWorkflowVersion | null> => {
  const [row] = await sql<DbWorkflowVersion[]>`
    SELECT ${versionColumns}
    FROM mail.workflows workflow
    JOIN mail.workflow_versions version
      ON version.workflow_id = workflow.id
     AND version.version = COALESCE(${params.version ?? null}::integer, workflow.current_version)
    WHERE workflow.id = ${params.workflowId}::uuid
      AND workflow.mailbox_id = ${params.mailboxId}::uuid
      AND workflow.lifecycle = 'saved'
  `;
  return row ?? null;
};

export const createSavedRun = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId: string;
  input: CreateSavedWorkflowRunInput;
  enqueue?: boolean;
}): Promise<Result<MailWorkflowRun>> => {
  const allowed = await resolveMailExecution({ mailboxId: params.mailboxId, operation: "actorMutation", context: params.context });
  if (!allowed.ok) return allowed;
  const version = await loadSavedVersion(params);
  if (!version) return fail(err.notFound("Workflow version"));
  const definition = parseJson(version.definition);
  const requestHash = sha256Json({
    kind: "saved",
    workflowId: params.workflowId,
    workflowVersionId: version.id,
    definitionHash: version.definition_hash,
    query: params.input.query,
    previewHash: params.input.previewHash,
  });
  const existing = await existingRunResult(params.context, params.mailboxId, params.input.idempotencyKey, requestHash);
  if (existing) return existing;
  const prepared = await preparePreview({ mailboxId: params.mailboxId, input: { definition, query: params.input.query } });
  if (!prepared.preview.previewHash || prepared.preview.previewHash !== params.input.previewHash) {
    return fail(err.conflict("Workflow preview is stale or cannot be executed"));
  }
  return persistRun({
    context: params.context,
    mailboxId: params.mailboxId,
    definition,
    definitionHash: version.definition_hash,
    query: params.input.query,
    preview: prepared,
    previewHash: params.input.previewHash,
    idempotencyKey: params.input.idempotencyKey,
    requestHash,
    savedVersion: version,
    enqueue: params.enqueue,
  });
};

export const listWorkflowRuns = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId?: string;
  limit?: number;
}): Promise<Result<MailWorkflowRun[]>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write");
  if (!allowed.ok) return allowed;
  const rows = await sql<DbWorkflowRun[]>`
    SELECT ${workflowRunColumns}
    FROM mail.workflow_runs run
    WHERE run.mailbox_id = ${params.mailboxId}::uuid
      AND (${params.workflowId ?? null}::uuid IS NULL OR run.workflow_id = ${params.workflowId ?? null}::uuid)
    ORDER BY run.created_at DESC, run.id DESC
    LIMIT ${Math.min(Math.max(params.limit ?? 50, 1), 200)}
  `;
  return ok(rows.map(mapWorkflowRun));
};

export const getWorkflowRun = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  runId: string;
}): Promise<Result<MailWorkflowRun>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write");
  if (!allowed.ok) return allowed;
  const [row] = await sql<DbWorkflowRun[]>`
    SELECT ${workflowRunColumns}
    FROM mail.workflow_runs run
    WHERE run.mailbox_id = ${params.mailboxId}::uuid AND run.id = ${params.runId}::uuid
  `;
  return row ? ok(mapWorkflowRun(row)) : fail(err.notFound("Workflow run"));
};
