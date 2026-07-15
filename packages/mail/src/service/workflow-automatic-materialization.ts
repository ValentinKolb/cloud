import { audit } from "@valentinkolb/cloud/services";
import type { WorkflowBoundPlan, WorkflowIrStep, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { evaluateWorkflowTriggerInputs } from "@valentinkolb/cloud/workflows/runtime";
import { sql } from "bun";
import type { WorkflowEffectBudget, WorkflowRunTargetSelection } from "../contracts";
import { sha256Json } from "./canonical";
import type { SqlClient } from "./workflow-data";
import { loadRunByIdempotency, workflowActorColumns } from "./workflow-materialization-store";
import { workflowEffectBudgetExceeded } from "./workflow-preflight-service";
import { dispatchMailWorkflowRun } from "./workflow-run-dispatch";
import { type DbWorkflowRun, parseWorkflowDbJson, workflowRunColumns } from "./workflow-run-model";
import type { MailWorkflowAuthorizationSnapshot } from "./workflow-runtime-context";

type AutomaticActivationRow = {
  activation_id: string;
  mailbox_id: string;
  workflow_id: string;
  workflow_version_id: string;
  trigger_key: string;
  trigger_kind: string;
  trigger_config: Record<string, WorkflowJsonValue> | string;
  authorization_snapshot: MailWorkflowAuthorizationSnapshot | string;
  version_identity: string;
  source_hash: string;
  bound_plan: WorkflowBoundPlan | string;
  effect_budget: WorkflowEffectBudget | string;
  manifest_hash: string;
  catalog_hash: string;
};

type AutomaticWorkflowTarget = {
  key: string;
  source: WorkflowJsonValue;
  preconditions: WorkflowJsonValue;
};

export type AutomaticWorkflowMaterialization = { state: "created" | "existing"; runId: string } | { state: "skipped"; reason: string };

const automaticActivationColumns = sql`
  activation.id AS activation_id,
  activation.mailbox_id,
  activation.workflow_id,
  activation.workflow_version_id,
  activation.trigger_key,
  activation.trigger_kind,
  activation.trigger_config,
  activation.authorization_snapshot,
  version.version_identity,
  version.source_hash,
  version.bound_plan,
  version.effect_budget,
  version.manifest_hash,
  version.catalog_hash
`;

const loadAutomaticActivation = async (
  activationId: string,
  triggerKind: string,
  db: SqlClient = sql,
  lock = false,
): Promise<AutomaticActivationRow | null> => {
  const [activation] = await db<AutomaticActivationRow[]>`
    SELECT ${automaticActivationColumns}
    FROM mail.workflow_activations activation
    JOIN mail.workflows workflow
      ON workflow.id = activation.workflow_id
     AND workflow.mailbox_id = activation.mailbox_id
     AND workflow.active_version_id = activation.workflow_version_id
    JOIN mail.workflow_versions version
      ON version.id = activation.workflow_version_id
     AND version.workflow_id = activation.workflow_id
     AND version.mailbox_id = activation.mailbox_id
    WHERE activation.id = ${activationId}::uuid
      AND activation.trigger_kind = ${triggerKind}
      AND activation.enabled
    ${lock ? sql`FOR SHARE OF activation, workflow, version` : sql``}
  `;
  return activation ?? null;
};

const addCounts = (left: Record<string, number>, right: Record<string, number>): Record<string, number> => {
  const result = { ...left };
  for (const [action, count] of Object.entries(right)) result[action] = (result[action] ?? 0) + count;
  return result;
};

const maxCounts = (counts: Record<string, number>[]): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const item of counts) {
    for (const [action, count] of Object.entries(item)) result[action] = Math.max(result[action] ?? 0, count);
  }
  return result;
};

const possibleActionCounts = (steps: WorkflowIrStep[]): Record<string, number> => {
  let result: Record<string, number> = {};
  for (const step of steps) {
    if (step.kind === "action") result[step.action] = (result[step.action] ?? 0) + 1;
    else if (step.kind === "if") {
      result = addCounts(result, maxCounts([possibleActionCounts(step.then), possibleActionCounts(step.else)]));
    } else if (step.kind === "switch") {
      result = addCounts(
        result,
        maxCounts([...step.cases.map((item) => possibleActionCounts(item.steps)), possibleActionCounts(step.default)]),
      );
    } else {
      throw new Error("Mail automatic workflows do not support forEach");
    }
  }
  return result;
};

const recordAutomaticSkip = async (activation: AutomaticActivationRow, deliveryKey: string, reason: string): Promise<void> => {
  await sql`
    INSERT INTO mail.activity_events (
      mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
    ) VALUES (
      ${activation.mailbox_id}::uuid,
      'workflow',
      ${activation.workflow_version_id}::uuid,
      'workflow.trigger',
      'failed',
      'workflow',
      ${activation.workflow_id}::uuid,
      ${{
        activationId: activation.activation_id,
        triggerKind: activation.trigger_kind,
        deliveryKey,
        reason,
      }}::jsonb
    )
  `;
};

export type AutomaticWorkflowMaterializationInput = {
  activationId: string;
  triggerKind: string;
  deliveryKey: string;
  occurredAt: string;
  channel: "event" | "schedule";
  triggerValues: Record<string, WorkflowJsonValue>;
  target: AutomaticWorkflowTarget;
};

export const materializeAutomaticWorkflowRun = async (
  params: AutomaticWorkflowMaterializationInput,
): Promise<AutomaticWorkflowMaterialization> => {
  const candidate = await loadAutomaticActivation(params.activationId, params.triggerKind);
  if (!candidate) return { state: "skipped", reason: "Activation is no longer active" };
  const authorization = parseWorkflowDbJson(candidate.authorization_snapshot);
  if (authorization.authority !== "mailbox" || authorization.mailboxId !== candidate.mailbox_id) {
    const reason = "Activated workflow authority is invalid";
    await recordAutomaticSkip(candidate, params.deliveryKey, reason);
    return { state: "skipped", reason };
  }

  const config = parseWorkflowDbJson(candidate.trigger_config);
  const bindings = config.with;
  if (bindings === null || typeof bindings !== "object" || Array.isArray(bindings)) {
    const reason = "Activated workflow trigger bindings are invalid";
    await recordAutomaticSkip(candidate, params.deliveryKey, reason);
    return { state: "skipped", reason };
  }
  const plan = parseWorkflowDbJson(candidate.bound_plan);
  const effectBudget = parseWorkflowDbJson(candidate.effect_budget);
  const actionCounts = possibleActionCounts(plan.steps);
  if (workflowEffectBudgetExceeded(actionCounts, 1, effectBudget)) {
    const reason = "Automatic workflow exceeds its configured effect budget";
    await recordAutomaticSkip(candidate, params.deliveryKey, reason);
    return { state: "skipped", reason };
  }
  let inputs: Record<string, WorkflowJsonValue>;
  try {
    inputs = evaluateWorkflowTriggerInputs(params.triggerValues, bindings as Record<string, WorkflowJsonValue>, params.occurredAt);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await recordAutomaticSkip(candidate, params.deliveryKey, reason);
    return { state: "skipped", reason };
  }

  const idempotencyKey = sha256Json({
    activationId: params.activationId,
    triggerKind: params.triggerKind,
    deliveryKey: params.deliveryKey,
  });
  const selection: WorkflowRunTargetSelection = {
    type: "trigger",
    kind: params.triggerKind,
    deliveryKey: params.deliveryKey,
  };
  const requestHash = sha256Json({
    activationId: params.activationId,
    workflowVersionId: candidate.workflow_version_id,
    authorization,
    inputs,
    selection,
    target: params.target,
  });
  const preflightHash = sha256Json({
    workflowVersionId: candidate.workflow_version_id,
    versionIdentity: candidate.version_identity,
    sourceHash: candidate.source_hash,
    inputs,
    selection,
    target: params.target,
    effectBudget,
    actionCounts,
  });
  const actor = workflowActorColumns(authorization, candidate.workflow_version_id);

  const materialized = await sql.begin(async (tx) => {
    await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
    const activation = await loadAutomaticActivation(params.activationId, params.triggerKind, tx, true);
    if (!activation) return { state: "skipped", reason: "Activation is no longer active" } as const;
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${activation.mailbox_id}:${activation.workflow_id}:execute:${idempotencyKey}`}, 0))`;
    const existing = await loadRunByIdempotency({
      mailboxId: activation.mailbox_id,
      workflowId: activation.workflow_id,
      mode: "execute",
      idempotencyKey,
      db: tx,
      lock: true,
    });
    if (existing) {
      if (existing.request_hash !== requestHash) throw new Error("Automatic workflow idempotency key conflicts with a different request");
      return { state: "existing", runId: existing.id } as const;
    }

    const runId = crypto.randomUUID();
    const [run] = await tx<DbWorkflowRun[]>`
      INSERT INTO mail.workflow_runs AS run (
        id, mailbox_id, workflow_id, workflow_version_id, version_identity, source_hash,
        kind, mode, channel, state, actor_kind, actor_id, authorization_snapshot,
        inputs, target_query, preflight_hash, idempotency_key, request_hash, occurred_at,
        target_count, queued_targets
      ) VALUES (
        ${runId}::uuid, ${activation.mailbox_id}::uuid, ${activation.workflow_id}::uuid,
        ${activation.workflow_version_id}::uuid, ${activation.version_identity}, ${activation.source_hash},
        'trigger', 'execute', ${params.channel}, 'queued', ${actor.kind}, ${actor.id}::uuid,
        ${authorization}::jsonb, ${inputs}::jsonb, ${selection}::jsonb, ${preflightHash},
        ${idempotencyKey}, ${requestHash}, ${params.occurredAt}::timestamptz, 1, 1
      )
      RETURNING ${workflowRunColumns}
    `;
    if (!run) throw new Error("Automatic workflow run insert returned no row");
    await tx`
      INSERT INTO mail.workflow_run_targets (
        id, parent_run_id, ordinal, target_key, state, execution_generation,
        frozen_inputs, frozen_source, frozen_preconditions
      ) VALUES (
        ${crypto.randomUUID()}::uuid, ${runId}::uuid, 0, ${params.target.key}, 'queued', 0,
        ${inputs}::jsonb, ${params.target.source}::jsonb, ${params.target.preconditions}::jsonb
      )
    `;
    await tx`
      INSERT INTO mail.activity_events (
        mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
      ) VALUES (
        ${activation.mailbox_id}::uuid, ${actor.kind}, ${actor.id}::uuid,
        'workflow.run', 'requested', 'workflow_run', ${runId}::uuid,
        ${{
          workflowId: activation.workflow_id,
          workflowVersionId: activation.workflow_version_id,
          activationId: activation.activation_id,
          triggerKind: params.triggerKind,
          deliveryKey: params.deliveryKey,
          actionCounts,
        }}::jsonb
      )
    `;
    await audit.record(
      {
        action: "mail.workflow.run.request",
        outcome: "allowed",
        actor: null,
        target: { type: "workflow_run", id: runId },
        requestId: `mail-workflow-trigger:${runId}`,
        metadata: {
          mailboxId: activation.mailbox_id,
          workflowId: activation.workflow_id,
          workflowVersionId: activation.workflow_version_id,
          activationId: activation.activation_id,
          triggerKind: params.triggerKind,
          deliveryKey: params.deliveryKey,
          mode: "execute",
          channel: params.channel,
        },
      },
      tx,
    );
    return { state: "created", runId } as const;
  });

  if (materialized.state === "skipped") {
    await recordAutomaticSkip(candidate, params.deliveryKey, materialized.reason);
    return materialized;
  }
  if (materialized.state === "created") await dispatchMailWorkflowRun(materialized.runId);
  return materialized;
};
