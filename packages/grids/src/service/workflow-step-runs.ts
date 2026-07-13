import { err } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { WorkflowStepRun } from "../contracts";
import type { SqlClient } from "./audit";
import { parseJsonbRow } from "./jsonb";

type DbRow = Record<string, unknown>;

type CreateStepRunInput = {
  runId: string;
  executionGeneration: number;
  stepIndex: number;
  stepPath: string;
  kind: string;
  input?: Record<string, unknown> | null;
};

type FinishStepRunInput = {
  status: Extract<WorkflowStepRun["status"], "succeeded" | "failed" | "canceled">;
  output?: Record<string, unknown> | null;
  error?: string | null;
};

const mapStepRunRow = (row: DbRow): WorkflowStepRun => ({
  id: row.id as string,
  runId: row.run_id as string,
  stepIndex: row.step_index as number,
  stepPath: row.step_path as string,
  kind: row.kind as string,
  status: row.status as WorkflowStepRun["status"],
  input: parseJsonbRow<WorkflowStepRun["input"]>(row.input, null),
  output: parseJsonbRow<WorkflowStepRun["output"]>(row.output, null),
  error: (row.error as string | null) ?? null,
  durationMs: (row.duration_ms as number | null) ?? null,
  startedAt: row.started_at ? (row.started_at as Date).toISOString() : null,
  finishedAt: row.finished_at ? (row.finished_at as Date).toISOString() : null,
});

export const createStepRun = async (input: CreateStepRunInput, client: SqlClient = sql): Promise<WorkflowStepRun> => {
  const [row] = await client<DbRow[]>`
    WITH owner AS (
      SELECT id
      FROM grids.workflow_runs
      WHERE id = ${input.runId}::uuid
        AND status = 'running'
        AND execution_generation = ${input.executionGeneration}
      FOR UPDATE
    )
    INSERT INTO grids.workflow_step_runs (run_id, step_index, step_path, resume_key, kind, status, input, started_at)
    SELECT owner.id, ${input.stepIndex}, ${input.stepPath}, ${input.stepPath}, ${input.kind}, 'running', ${input.input ?? null}::jsonb, now()
    FROM owner
    ON CONFLICT (run_id, resume_key) WHERE resume_key IS NOT NULL
    DO UPDATE SET
      status = CASE WHEN grids.workflow_step_runs.status = 'succeeded' THEN grids.workflow_step_runs.status ELSE 'running' END,
      input = CASE WHEN grids.workflow_step_runs.status = 'succeeded' THEN grids.workflow_step_runs.input ELSE EXCLUDED.input END,
      output = CASE WHEN grids.workflow_step_runs.status = 'succeeded' THEN grids.workflow_step_runs.output ELSE NULL END,
      error = CASE WHEN grids.workflow_step_runs.status = 'succeeded' THEN grids.workflow_step_runs.error ELSE NULL END,
      duration_ms = CASE WHEN grids.workflow_step_runs.status = 'succeeded' THEN grids.workflow_step_runs.duration_ms ELSE NULL END,
      started_at = CASE WHEN grids.workflow_step_runs.status = 'succeeded' THEN grids.workflow_step_runs.started_at ELSE now() END,
      finished_at = CASE WHEN grids.workflow_step_runs.status = 'succeeded' THEN grids.workflow_step_runs.finished_at ELSE NULL END
    RETURNING id, run_id, step_index, step_path, kind, status, input, output, error, duration_ms, started_at, finished_at
  `;
  if (!row) throw err.conflict("workflow run lease lost");
  return mapStepRunRow(row);
};

export const getStepRunByPath = async (runId: string, stepPath: string, client: SqlClient = sql): Promise<WorkflowStepRun | null> => {
  const [row] = await client<DbRow[]>`
    SELECT id, run_id, step_index, step_path, kind, status, input, output, error, duration_ms, started_at, finished_at
    FROM grids.workflow_step_runs
    WHERE run_id = ${runId}::uuid
      AND resume_key = ${stepPath}
  `;
  return row ? mapStepRunRow(row) : null;
};

export const finishStepRun = async (
  stepRunId: string,
  executionGeneration: number,
  input: FinishStepRunInput,
  client: SqlClient = sql,
): Promise<WorkflowStepRun> => {
  const [row] = await client<DbRow[]>`
    WITH owner AS (
      SELECT run.id
      FROM grids.workflow_runs run
      JOIN grids.workflow_step_runs step ON step.run_id = run.id
      WHERE step.id = ${stepRunId}::uuid
        AND run.status = 'running'
        AND run.execution_generation = ${executionGeneration}
      FOR UPDATE OF run
    )
    UPDATE grids.workflow_step_runs step
    SET status = ${input.status},
        output = ${input.output ?? null}::jsonb,
        error = ${input.error ?? null},
        duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - COALESCE(started_at, now()))) * 1000)::int),
        finished_at = now()
    FROM owner
    WHERE step.id = ${stepRunId}::uuid
      AND step.run_id = owner.id
    RETURNING step.id, step.run_id, step.step_index, step.step_path, step.kind, step.status, step.input, step.output, step.error,
              step.duration_ms, step.started_at, step.finished_at
  `;
  if (!row) throw err.conflict("workflow run lease lost");
  return mapStepRunRow(row);
};

const listStepRunsWithClient = async (runId: string, client: SqlClient): Promise<WorkflowStepRun[]> => {
  const rows = await client<DbRow[]>`
    SELECT id, run_id, step_index, step_path, kind, status, input, output, error, duration_ms, started_at, finished_at
    FROM grids.workflow_step_runs
    WHERE run_id = ${runId}::uuid
    ORDER BY step_index, id
  `;
  return rows.map(mapStepRunRow);
};

export const listStepRuns = async (runId: string): Promise<WorkflowStepRun[]> => listStepRunsWithClient(runId, sql);
