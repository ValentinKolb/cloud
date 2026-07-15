import type { WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { sql } from "bun";
import type {
  MailWorkflowRun,
  MailWorkflowRunTarget,
  WorkflowRunChannel,
  WorkflowRunKind,
  WorkflowRunMode,
  WorkflowRunState,
  WorkflowRunTargetSelection,
  WorkflowTargetState,
} from "../contracts";

export type DbWorkflowRun = {
  id: string;
  mailbox_id: string;
  workflow_id: string;
  workflow_version_id: string;
  version_identity: string;
  source_hash: string;
  kind: WorkflowRunKind;
  mode: WorkflowRunMode;
  channel: WorkflowRunChannel;
  state: WorkflowRunState;
  inputs: Record<string, WorkflowJsonValue> | string;
  target_query: WorkflowRunTargetSelection | string;
  preflight_hash: string | null;
  target_count: number;
  queued_targets: number;
  running_targets: number;
  waiting_targets: number;
  succeeded_targets: number;
  failed_targets: number;
  canceled_targets: number;
  needs_attention_targets: number;
  result: WorkflowJsonValue | string | null;
  last_error: { code: string; message: string; retryable: boolean } | string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  updated_at: Date | string;
};

export type DbWorkflowRunTarget = {
  id: string;
  parent_run_id: string;
  ordinal: number | bigint;
  target_key: string;
  state: WorkflowTargetState;
  execution_generation: number | bigint;
  frozen_inputs: Record<string, WorkflowJsonValue> | string;
  frozen_source: WorkflowJsonValue | string;
  frozen_preconditions: WorkflowJsonValue | string;
  result: WorkflowJsonValue | string | null;
  last_error: { code: string; message: string; retryable: boolean } | string | null;
  cancel_requested_at: Date | string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  updated_at: Date | string;
};

export type WorkflowRunTargetInsert = {
  targetKey: string;
  source: WorkflowJsonValue;
  preconditions: WorkflowJsonValue;
  inputs: Record<string, WorkflowJsonValue>;
};

export const workflowRunColumns = sql`
  run.id,
  run.mailbox_id,
  run.workflow_id,
  run.workflow_version_id,
  run.version_identity,
  run.source_hash,
  run.kind,
  run.mode,
  run.channel,
  run.state,
  run.inputs,
  run.target_query,
  run.preflight_hash,
  run.target_count,
  run.queued_targets,
  run.running_targets,
  run.waiting_targets,
  run.succeeded_targets,
  run.failed_targets,
  run.canceled_targets,
  run.needs_attention_targets,
  run.result,
  run.last_error,
  run.created_at,
  run.started_at,
  run.finished_at,
  run.updated_at
`;

export const parseWorkflowDbJson = <T>(value: T | string): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);
export const workflowTimestamp = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const nullableWorkflowTimestamp = (value: Date | string | null): string | null => (value ? workflowTimestamp(value) : null);

export const mapWorkflowRun = (row: DbWorkflowRun): MailWorkflowRun => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  workflowId: row.workflow_id,
  workflowVersionId: row.workflow_version_id,
  versionIdentity: row.version_identity,
  sourceHash: row.source_hash,
  kind: row.kind,
  mode: row.mode,
  channel: row.channel,
  state: row.state,
  inputs: parseWorkflowDbJson(row.inputs),
  query: parseWorkflowDbJson(row.target_query),
  preflightHash: row.preflight_hash,
  targetProgress: {
    total: row.target_count,
    queued: row.queued_targets,
    running: row.running_targets,
    waiting: row.waiting_targets,
    succeeded: row.succeeded_targets,
    failed: row.failed_targets,
    canceled: row.canceled_targets,
    needs_attention: row.needs_attention_targets,
  },
  result: row.result === null ? null : parseWorkflowDbJson(row.result),
  lastError: row.last_error === null ? null : parseWorkflowDbJson(row.last_error),
  createdAt: workflowTimestamp(row.created_at),
  startedAt: nullableWorkflowTimestamp(row.started_at),
  finishedAt: nullableWorkflowTimestamp(row.finished_at),
  updatedAt: workflowTimestamp(row.updated_at),
});

export const mapWorkflowRunTarget = (row: DbWorkflowRunTarget): MailWorkflowRunTarget => ({
  id: row.id,
  parentRunId: row.parent_run_id,
  ordinal: Number(row.ordinal),
  targetKey: row.target_key,
  state: row.state,
  executionGeneration: Number(row.execution_generation),
  inputs: parseWorkflowDbJson(row.frozen_inputs),
  source: parseWorkflowDbJson(row.frozen_source),
  preconditions: parseWorkflowDbJson(row.frozen_preconditions),
  result: row.result === null ? null : parseWorkflowDbJson(row.result),
  lastError: row.last_error === null ? null : parseWorkflowDbJson(row.last_error),
  cancelRequestedAt: nullableWorkflowTimestamp(row.cancel_requested_at),
  createdAt: workflowTimestamp(row.created_at),
  startedAt: nullableWorkflowTimestamp(row.started_at),
  finishedAt: nullableWorkflowTimestamp(row.finished_at),
  updatedAt: workflowTimestamp(row.updated_at),
});
