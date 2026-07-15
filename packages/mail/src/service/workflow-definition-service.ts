import { audit } from "@valentinkolb/cloud/services";
import type { WorkflowBoundPlan, WorkflowDiagnostic, WorkflowIr, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { compileWorkflow, hashWorkflowJson } from "@valentinkolb/cloud/workflows/language";
import { err, fail, isServiceError, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type {
  ActivateWorkflowInput,
  CreateWorkflowInput,
  CreateWorkflowVersionInput,
  DeactivateWorkflowInput,
  MailWorkflow,
  MailWorkflowActivation,
  MailWorkflowDetail,
  MailWorkflowVersion,
  WorkflowEffectBudget,
  WorkflowValidation,
} from "../contracts";
import { bindMailWorkflow, mailWorkflowManifest } from "../workflows";
import { requireMailboxPermission } from "./access";
import { actorRefFromRequest, auditActorFromRequest, type MailRequestContext } from "./auth";
import { loadMailWorkflowCatalog } from "./workflow-catalog-service";
import type { SqlClient } from "./workflow-data";
import { snapshotMailboxWorkflowAuthorization } from "./workflow-runtime-context";

const COMPILER_NAME = "cloud-workflow-kernel";
const COMPILER_VERSION = "1";

type DbWorkflow = {
  id: string;
  mailbox_id: string;
  name: string;
  description: string | null;
  priority: number;
  current_version_id: string;
  active_version_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type DbWorkflowVersion = {
  id: string;
  version_identity: string;
  workflow_id: string;
  mailbox_id: string;
  source: string;
  source_hash: string;
  ir: WorkflowIr | string;
  bound_plan: WorkflowBoundPlan | string;
  diagnostics: WorkflowDiagnostic[] | string;
  effect_budget: WorkflowEffectBudget | string;
  language_id: string;
  language_version: number;
  manifest_hash: string;
  catalog_hash: string;
  compiler_name: string;
  compiler_version: string;
  created_at: Date | string;
};

type DbActivation = {
  id: string;
  workflow_id: string;
  workflow_version_id: string;
  trigger_key: string;
  trigger_kind: string;
  trigger_config: Record<string, WorkflowJsonValue> | string;
  enabled: boolean;
  diagnostics: WorkflowDiagnostic[] | string;
  created_at: Date | string;
  updated_at: Date | string;
};

const workflowColumns = sql`
  workflow.id,
  workflow.mailbox_id,
  workflow.name,
  workflow.description,
  workflow.priority,
  workflow.current_version_id,
  workflow.active_version_id,
  workflow.created_at,
  workflow.updated_at
`;

const versionColumns = sql`
  version.id,
  version.version_identity,
  version.workflow_id,
  version.mailbox_id,
  version.source,
  version.source_hash,
  version.ir,
  version.bound_plan,
  version.diagnostics,
  version.effect_budget,
  version.language_id,
  version.language_version,
  version.manifest_hash,
  version.catalog_hash,
  version.compiler_name,
  version.compiler_version,
  version.created_at
`;

const activationColumns = sql`
  activation.id,
  activation.workflow_id,
  activation.workflow_version_id,
  activation.trigger_key,
  activation.trigger_kind,
  activation.trigger_config,
  activation.enabled,
  activation.diagnostics,
  activation.created_at,
  activation.updated_at
`;

const parseJson = <T>(value: T | string): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);
const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();

const mapWorkflow = (row: DbWorkflow): MailWorkflow => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  name: row.name,
  description: row.description,
  priority: row.priority,
  currentVersionId: row.current_version_id,
  activeVersionId: row.active_version_id,
  enabled: row.active_version_id !== null,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

export const mapWorkflowVersion = (row: DbWorkflowVersion): MailWorkflowVersion => ({
  id: row.id,
  identity: row.version_identity,
  workflowId: row.workflow_id,
  mailboxId: row.mailbox_id,
  source: row.source,
  sourceHash: row.source_hash,
  ir: parseJson(row.ir),
  boundPlan: parseJson(row.bound_plan),
  diagnostics: parseJson(row.diagnostics),
  effectBudget: parseJson(row.effect_budget),
  languageId: row.language_id,
  languageVersion: row.language_version,
  manifestHash: row.manifest_hash,
  catalogHash: row.catalog_hash,
  compiler: { name: row.compiler_name, version: row.compiler_version },
  createdAt: toIso(row.created_at),
});

const mapActivation = (row: DbActivation): MailWorkflowActivation => ({
  id: row.id,
  workflowId: row.workflow_id,
  workflowVersionId: row.workflow_version_id,
  key: row.trigger_key,
  kind: row.trigger_kind,
  config: parseJson(row.trigger_config),
  enabled: row.enabled,
  diagnostics: parseJson(row.diagnostics),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

export const workflowTriggerRegistrations = (plan: WorkflowBoundPlan) =>
  plan.triggers.map((trigger) => ({
    key: trigger.kind,
    kind: trigger.kind,
    config: { ...trigger.config, with: trigger.with } as Record<string, WorkflowJsonValue>,
  }));

const creator = (context: MailRequestContext): { kind: "user" | "service_account"; id: string } => {
  const actor = actorRefFromRequest(context);
  if (actor.kind === "user") return { kind: "user", id: actor.userId };
  if (actor.kind === "service_account") return { kind: "service_account", id: actor.serviceAccountId };
  throw new TypeError("Request actor cannot create Mail workflows");
};

export const validateMailWorkflowSource = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  source: string;
  db?: SqlClient;
}): Promise<WorkflowValidation> => {
  const compiled = await compileWorkflow(params.source, mailWorkflowManifest);
  if (!compiled.ok) {
    return {
      valid: false,
      source: params.source,
      sourceHash: null,
      ir: null,
      boundPlan: null,
      diagnostics: compiled.diagnostics,
    };
  }
  const catalog = await loadMailWorkflowCatalog(params);
  const bound = await bindMailWorkflow(compiled.ir, catalog);
  if (!bound.ok) {
    return {
      valid: false,
      source: params.source,
      sourceHash: compiled.ir.sourceHash,
      ir: compiled.ir,
      boundPlan: null,
      diagnostics: bound.diagnostics,
    };
  }
  return {
    valid: true,
    source: params.source,
    sourceHash: compiled.ir.sourceHash,
    ir: compiled.ir,
    boundPlan: bound.plan,
    diagnostics: [],
  };
};

export const validateWorkflow = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  source: string;
}): Promise<Result<WorkflowValidation>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  return ok(await validateMailWorkflowSource(params));
};

const versionIdentity = (
  versionId: string,
  validation: WorkflowValidation & { ir: WorkflowIr; boundPlan: WorkflowBoundPlan; sourceHash: string },
  effectBudget: WorkflowEffectBudget,
): Promise<string> =>
  hashWorkflowJson({
    versionId,
    sourceHash: validation.sourceHash,
    ir: validation.ir,
    boundPlan: validation.boundPlan,
    effectBudget,
    compiler: { name: COMPILER_NAME, version: COMPILER_VERSION },
  });

const insertVersion = async (params: {
  db: SqlClient;
  versionId: string;
  workflowId: string;
  mailboxId: string;
  validation: WorkflowValidation & { ir: WorkflowIr; boundPlan: WorkflowBoundPlan; sourceHash: string };
  effectBudget: WorkflowEffectBudget;
  actor: { kind: "user" | "service_account"; id: string };
}): Promise<DbWorkflowVersion> => {
  const identity = await versionIdentity(params.versionId, params.validation, params.effectBudget);
  const [version] = await params.db<DbWorkflowVersion[]>`
    INSERT INTO mail.workflow_versions AS version (
      id, version_identity, workflow_id, mailbox_id, source, source_hash, ir, bound_plan,
      diagnostics, effect_budget, language_id, language_version, manifest_hash, catalog_hash,
      compiler_name, compiler_version, created_by_kind, created_by_id
    ) VALUES (
      ${params.versionId}::uuid,
      ${identity},
      ${params.workflowId}::uuid,
      ${params.mailboxId}::uuid,
      ${params.validation.source},
      ${params.validation.sourceHash},
      ${params.validation.ir}::jsonb,
      ${params.validation.boundPlan}::jsonb,
      ${params.validation.diagnostics}::jsonb,
      ${params.effectBudget}::jsonb,
      ${params.validation.boundPlan.languageId},
      ${params.validation.boundPlan.languageVersion},
      ${params.validation.boundPlan.manifestHash},
      ${params.validation.boundPlan.catalogHash},
      ${COMPILER_NAME},
      ${COMPILER_VERSION},
      ${params.actor.kind},
      ${params.actor.id}::uuid
    )
    RETURNING ${versionColumns}
  `;
  if (!version) throw new Error("Workflow version insert returned no row");
  return version;
};

const loadActivations = async (workflowId: string, db: SqlClient = sql): Promise<MailWorkflowActivation[]> => {
  const rows = await db<DbActivation[]>`
    SELECT ${activationColumns}
    FROM mail.workflow_activations activation
    WHERE activation.workflow_id = ${workflowId}::uuid
    ORDER BY activation.trigger_key, activation.id
  `;
  return rows.map(mapActivation);
};

const loadWorkflowDetail = async (mailboxId: string, workflowId: string, db: SqlClient = sql): Promise<MailWorkflowDetail | null> => {
  const [workflow] = await db<DbWorkflow[]>`
    SELECT ${workflowColumns}
    FROM mail.workflows workflow
    WHERE workflow.id = ${workflowId}::uuid AND workflow.mailbox_id = ${mailboxId}::uuid
  `;
  if (!workflow) return null;
  const [version] = await db<DbWorkflowVersion[]>`
    SELECT ${versionColumns}
    FROM mail.workflow_versions version
    WHERE version.id = ${workflow.current_version_id}::uuid
      AND version.workflow_id = ${workflowId}::uuid
      AND version.mailbox_id = ${mailboxId}::uuid
  `;
  if (!version) return null;
  return { ...mapWorkflow(workflow), currentVersion: mapWorkflowVersion(version), activations: await loadActivations(workflowId, db) };
};

export const listWorkflows = async (context: MailRequestContext, mailboxId: string): Promise<Result<MailWorkflow[]>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<DbWorkflow[]>`
    SELECT ${workflowColumns}
    FROM mail.workflows workflow
    WHERE workflow.mailbox_id = ${mailboxId}::uuid
    ORDER BY workflow.priority, lower(workflow.name), workflow.id
    LIMIT 200
  `;
  return ok(rows.map(mapWorkflow));
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
    JOIN mail.workflows workflow
      ON workflow.id = version.workflow_id AND workflow.mailbox_id = version.mailbox_id
    WHERE version.mailbox_id = ${params.mailboxId}::uuid
      AND version.workflow_id = ${params.workflowId}::uuid
    ORDER BY version.created_at DESC, version.id DESC
    LIMIT 200
  `;
  return rows.length > 0 ? ok(rows.map(mapWorkflowVersion)) : fail(err.notFound("Workflow"));
};

export const getWorkflowVersion = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId: string;
  versionId: string;
}): Promise<Result<MailWorkflowVersion>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const version = await loadWorkflowVersion(params);
  return version ? ok(mapWorkflowVersion(version)) : fail(err.notFound("Workflow version"));
};

export const loadWorkflowVersion = async (params: {
  mailboxId: string;
  workflowId: string;
  versionId: string;
  db?: SqlClient;
  lock?: boolean;
}): Promise<DbWorkflowVersion | null> => {
  const db = params.db ?? sql;
  const [row] = await db<DbWorkflowVersion[]>`
    SELECT ${versionColumns}
    FROM mail.workflow_versions version
    WHERE version.id = ${params.versionId}::uuid
      AND version.workflow_id = ${params.workflowId}::uuid
      AND version.mailbox_id = ${params.mailboxId}::uuid
    ${params.lock ? sql`FOR SHARE` : sql``}
  `;
  return row ?? null;
};

export const createWorkflow = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: CreateWorkflowInput;
}): Promise<Result<MailWorkflowDetail>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "admin");
  if (!allowed.ok) return allowed;
  const workflowId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const actor = creator(params.context);
  try {
    return await sql.begin(async (tx) => {
      const currentPermission = await requireMailboxPermission(params.context, params.mailboxId, "admin", tx);
      if (!currentPermission.ok) return currentPermission;
      const validation = await validateMailWorkflowSource({ ...params, source: params.input.source, db: tx });
      if (!validation.valid || !validation.ir || !validation.boundPlan || !validation.sourceHash) {
        return fail(err.badInput("Workflow source is invalid"));
      }
      await tx`
        INSERT INTO mail.workflows (
          id, mailbox_id, name, description, priority, current_version_id, active_version_id,
          created_by_kind, created_by_id
        ) VALUES (
          ${workflowId}::uuid, ${params.mailboxId}::uuid, ${params.input.name}, ${params.input.description ?? null},
          ${params.input.priority}, ${versionId}::uuid, NULL, ${actor.kind}, ${actor.id}::uuid
        )
      `;
      await insertVersion({
        db: tx,
        versionId,
        workflowId,
        mailboxId: params.mailboxId,
        validation: { ...validation, ir: validation.ir, boundPlan: validation.boundPlan, sourceHash: validation.sourceHash },
        effectBudget: params.input.effectBudget,
        actor,
      });
      await audit.record(
        {
          action: "mail.workflow.create",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "workflow", id: workflowId },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, versionId, sourceHash: validation.sourceHash },
        },
        tx,
      );
      const detail = await loadWorkflowDetail(params.mailboxId, workflowId, tx);
      if (!detail) throw new Error("Created workflow could not be reloaded");
      return ok(detail);
    });
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
  input: CreateWorkflowVersionInput;
}): Promise<Result<MailWorkflowDetail>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "admin");
  if (!allowed.ok) return allowed;
  const versionId = crypto.randomUUID();
  const actor = creator(params.context);
  try {
    return await sql.begin(async (tx) => {
      const currentPermission = await requireMailboxPermission(params.context, params.mailboxId, "admin", tx);
      if (!currentPermission.ok) return currentPermission;
      const [workflow] = await tx<DbWorkflow[]>`
        SELECT ${workflowColumns}
        FROM mail.workflows workflow
        WHERE workflow.id = ${params.workflowId}::uuid AND workflow.mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!workflow) return fail(err.notFound("Workflow"));
      const validation = await validateMailWorkflowSource({ ...params, source: params.input.source, db: tx });
      if (!validation.valid || !validation.ir || !validation.boundPlan || !validation.sourceHash) {
        return fail(err.badInput("Workflow source is invalid"));
      }
      await insertVersion({
        db: tx,
        versionId,
        workflowId: params.workflowId,
        mailboxId: params.mailboxId,
        validation: { ...validation, ir: validation.ir, boundPlan: validation.boundPlan, sourceHash: validation.sourceHash },
        effectBudget: params.input.effectBudget,
        actor,
      });
      await tx`
        UPDATE mail.workflows
        SET current_version_id = ${versionId}::uuid
        WHERE id = ${params.workflowId}::uuid
      `;
      await audit.record(
        {
          action: "mail.workflow.version.create",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "workflow", id: params.workflowId },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, versionId, sourceHash: validation.sourceHash },
        },
        tx,
      );
      const detail = await loadWorkflowDetail(params.mailboxId, params.workflowId, tx);
      if (!detail) throw new Error("Versioned workflow could not be reloaded");
      return ok(detail);
    });
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to create workflow version"));
  }
};

export const activateWorkflow = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId: string;
  input: ActivateWorkflowInput;
}): Promise<Result<MailWorkflowDetail>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "admin");
  if (!allowed.ok) return allowed;
  const authorizationSnapshot = snapshotMailboxWorkflowAuthorization(params.context, params.mailboxId);
  try {
    return await sql.begin(async (tx) => {
      const currentPermission = await requireMailboxPermission(params.context, params.mailboxId, "admin", tx);
      if (!currentPermission.ok) return currentPermission;
      const [workflow] = await tx<DbWorkflow[]>`
        SELECT ${workflowColumns}
        FROM mail.workflows workflow
        WHERE workflow.id = ${params.workflowId}::uuid AND workflow.mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!workflow) return fail(err.notFound("Workflow"));
      if (workflow.current_version_id !== params.input.expectedVersionId) {
        return fail(err.conflict("Workflow version changed before activation"));
      }
      const version = await loadWorkflowVersion({
        mailboxId: params.mailboxId,
        workflowId: params.workflowId,
        versionId: params.input.expectedVersionId,
        db: tx,
      });
      if (!version) return fail(err.notFound("Workflow version"));
      const plan = parseJson(version.bound_plan);
      const registrations = workflowTriggerRegistrations(plan);
      await tx`DELETE FROM mail.workflow_activations WHERE workflow_id = ${params.workflowId}::uuid`;
      for (const trigger of registrations) {
        await tx`
          INSERT INTO mail.workflow_activations (
            mailbox_id, workflow_id, workflow_version_id, trigger_key, trigger_kind, trigger_config,
            authorization_snapshot, diagnostics
          ) VALUES (
            ${params.mailboxId}::uuid, ${params.workflowId}::uuid, ${version.id}::uuid,
            ${trigger.key}, ${trigger.kind}, ${trigger.config}::jsonb,
            ${authorizationSnapshot}::jsonb, '[]'::jsonb
          )
        `;
      }
      await tx`
        UPDATE mail.workflows
        SET active_version_id = ${version.id}::uuid
        WHERE id = ${params.workflowId}::uuid
      `;
      await audit.record(
        {
          action: "mail.workflow.activate",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "workflow", id: params.workflowId },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, versionId: version.id, triggers: registrations.map((trigger) => trigger.kind) },
        },
        tx,
      );
      const detail = await loadWorkflowDetail(params.mailboxId, params.workflowId, tx);
      if (!detail) throw new Error("Activated workflow could not be reloaded");
      return ok(detail);
    });
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to activate workflow"));
  }
};

export const deactivateWorkflow = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId: string;
  input: DeactivateWorkflowInput;
}): Promise<Result<MailWorkflowDetail>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "admin");
  if (!allowed.ok) return allowed;
  try {
    return await sql.begin(async (tx) => {
      const currentPermission = await requireMailboxPermission(params.context, params.mailboxId, "admin", tx);
      if (!currentPermission.ok) return currentPermission;
      const [workflow] = await tx<DbWorkflow[]>`
        SELECT ${workflowColumns}
        FROM mail.workflows workflow
        WHERE workflow.id = ${params.workflowId}::uuid AND workflow.mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!workflow) return fail(err.notFound("Workflow"));
      if (workflow.active_version_id !== params.input.expectedVersionId) {
        return fail(err.conflict("Active workflow version changed before deactivation"));
      }
      await tx`UPDATE mail.workflows SET active_version_id = NULL WHERE id = ${params.workflowId}::uuid`;
      await tx`
        UPDATE mail.workflow_activations
        SET enabled = false
        WHERE workflow_id = ${params.workflowId}::uuid AND workflow_version_id = ${params.input.expectedVersionId}::uuid
      `;
      await audit.record(
        {
          action: "mail.workflow.deactivate",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "workflow", id: params.workflowId },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, versionId: params.input.expectedVersionId },
        },
        tx,
      );
      const detail = await loadWorkflowDetail(params.mailboxId, params.workflowId, tx);
      if (!detail) throw new Error("Deactivated workflow could not be reloaded");
      return ok(detail);
    });
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to deactivate workflow"));
  }
};
