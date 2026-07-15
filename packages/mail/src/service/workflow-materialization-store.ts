import { audit } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import type { MailWorkflowVersion, WorkflowRunChannel, WorkflowRunKind, WorkflowRunMode } from "../contracts";
import { auditActorFromRequest, type MailRequestContext } from "./auth";
import type { SqlClient } from "./workflow-data";
import { type DbWorkflowRun, type WorkflowRunTargetInsert, workflowRunColumns } from "./workflow-run-model";
import type { MailWorkflowAuthorizationSnapshot } from "./workflow-runtime-context";

export const workflowActorColumns = (snapshot: MailWorkflowAuthorizationSnapshot, workflowVersionId: string) => {
  if (snapshot.authority === "mailbox") return { kind: "workflow" as const, id: workflowVersionId };
  return snapshot.actor.kind === "user"
    ? { kind: "user" as const, id: snapshot.actor.userId }
    : { kind: "service_account" as const, id: snapshot.actor.serviceAccountId };
};

export type WorkflowActorColumns = ReturnType<typeof workflowActorColumns>;

export const workflowAuthorizationIdentity = (snapshot: MailWorkflowAuthorizationSnapshot) =>
  snapshot.authority === "actor"
    ? {
        authority: snapshot.authority,
        actor: snapshot.actor,
        accessSubject: snapshot.accessSubject,
      }
    : {
        authority: snapshot.authority,
        mailboxId: snapshot.mailboxId,
        activatedBy: snapshot.activatedBy,
      };

export const recordWorkflowRunRequest = async (params: {
  db: SqlClient;
  context: MailRequestContext;
  actor: WorkflowActorColumns;
  mailboxId: string;
  workflowId: string;
  runId: string;
  version: MailWorkflowVersion;
  targetCount: number;
  actionCounts: Record<string, number>;
  kind: WorkflowRunKind;
  mode: WorkflowRunMode;
  channel: WorkflowRunChannel;
  idempotencyKey: string;
}): Promise<void> => {
  await params.db`
    INSERT INTO mail.activity_events (
      mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
    ) VALUES (
      ${params.mailboxId}::uuid, ${params.actor.kind}, ${params.actor.id}::uuid,
      'workflow.run', 'requested', 'workflow_run', ${params.runId}::uuid,
      ${{
        workflowId: params.workflowId,
        workflowVersionId: params.version.id,
        versionIdentity: params.version.identity,
        sourceHash: params.version.sourceHash,
        manifestHash: params.version.manifestHash,
        catalogHash: params.version.catalogHash,
        targetCount: params.targetCount,
        actionCounts: params.actionCounts,
        kind: params.kind,
        channel: params.channel,
      }}::jsonb
    )
  `;
  await audit.record(
    {
      action: "mail.workflow.run.request",
      outcome: "allowed",
      actor: auditActorFromRequest(params.context),
      target: { type: "workflow_run", id: params.runId },
      requestId: params.context.requestId,
      metadata: {
        mailboxId: params.mailboxId,
        workflowId: params.workflowId,
        workflowVersionId: params.version.id,
        versionIdentity: params.version.identity,
        sourceHash: params.version.sourceHash,
        manifestHash: params.version.manifestHash,
        catalogHash: params.version.catalogHash,
        targetCount: params.targetCount,
        actionCounts: params.actionCounts,
        kind: params.kind,
        mode: params.mode,
        channel: params.channel,
        idempotencyKey: params.idempotencyKey,
      },
    },
    params.db,
  );
};

export const loadRunByIdempotency = async (params: {
  mailboxId: string;
  workflowId: string;
  mode: WorkflowRunMode;
  idempotencyKey: string;
  db?: SqlClient;
  lock?: boolean;
}): Promise<(DbWorkflowRun & { request_hash: string }) | null> => {
  const db = params.db ?? sql;
  const [run] = await db<(DbWorkflowRun & { request_hash: string })[]>`
    SELECT ${workflowRunColumns}, run.request_hash
    FROM mail.workflow_runs run
    WHERE run.mailbox_id = ${params.mailboxId}::uuid
      AND run.workflow_id = ${params.workflowId}::uuid
      AND run.mode = ${params.mode}
      AND run.idempotency_key = ${params.idempotencyKey}
    ${params.lock ? sql`FOR UPDATE` : sql``}
  `;
  return run ?? null;
};

export const insertWorkflowTargets = async (
  db: SqlClient,
  parentRunId: string,
  targets: WorkflowRunTargetInsert[],
  ordinalStart: number,
): Promise<void> => {
  for (let offset = 0; offset < targets.length; offset += 500) {
    const rows = targets.slice(offset, offset + 500).map((target, index) => ({
      id: crypto.randomUUID(),
      ordinal: ordinalStart + offset + index,
      target_key: target.targetKey,
      frozen_inputs: target.inputs,
      frozen_source: target.source,
      frozen_preconditions: target.preconditions,
    }));
    await db`
      INSERT INTO mail.workflow_run_targets (
        id, parent_run_id, ordinal, target_key, state, execution_generation, execution_clock_at,
        frozen_inputs, frozen_source, frozen_preconditions
      )
      SELECT
        row.id, ${parentRunId}::uuid, row.ordinal, row.target_key, 'queued', 0, NULL,
        row.frozen_inputs, row.frozen_source, row.frozen_preconditions
      FROM jsonb_to_recordset(${rows}::jsonb) AS row(
        id uuid,
        ordinal bigint,
        target_key text,
        frozen_inputs jsonb,
        frozen_source jsonb,
        frozen_preconditions jsonb
      )
    `;
  }
};
