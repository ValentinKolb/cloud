import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { err } from "@valentinkolb/stdlib";
import { sql } from "bun";
import {
  type WorkflowDefinition,
  WorkflowDefinitionSchema,
  type WorkflowEmailDelivery,
  type WorkflowRun,
  type WorkflowTriggerKind,
} from "../contracts";
import type { WorkflowRunEventScope } from "../lib/workflow-run-events";
import { logAudit, type SqlClient } from "./audit";
import { parseJsonbRow } from "./jsonb";
import {
  loadWorkflowCatalog,
  snapshotWorkflowCatalog,
  type WorkflowCatalogSnapshot,
  WorkflowCatalogSnapshotSchema,
} from "./workflow-catalog";
import { listWorkflowEmailDeliveries } from "./workflow-email-deliveries";
import { notifyWorkflowRunEvent } from "./workflow-run-events";
import { listStepRuns } from "./workflow-step-runs";

type DbRow = Record<string, unknown>;

type CreateRunInput = {
  workflowId: string;
  baseId: string;
  workflowDefinition: WorkflowDefinition;
  workflowCatalog?: WorkflowCatalogSnapshot;
  triggerKind: WorkflowTriggerKind;
  triggerKey?: string | null;
  triggerInput?: Record<string, unknown> | null;
  resolvedInput?: Record<string, unknown> | null;
  actorUserId?: string | null;
  actorGroupIds?: string[];
  serviceAccountId?: string | null;
  authorization?: StoredWorkflowAuthorization;
};

export type StoredWorkflowAuthorization =
  | { kind: "workflow" }
  | { kind: "dashboard-widget"; dashboardId: string; dashboardWidgetId: string };

const parseStoredWorkflowAuthorization = (value: unknown): StoredWorkflowAuthorization | null => {
  if (!value || typeof value !== "object") return null;
  const authorization = value as Record<string, unknown>;
  if (authorization.kind === "workflow") return { kind: "workflow" };
  if (
    authorization.kind === "dashboard-widget" &&
    typeof authorization.dashboardId === "string" &&
    authorization.dashboardId.length > 0 &&
    typeof authorization.dashboardWidgetId === "string" &&
    authorization.dashboardWidgetId.length > 0
  ) {
    return {
      kind: "dashboard-widget",
      dashboardId: authorization.dashboardId,
      dashboardWidgetId: authorization.dashboardWidgetId,
    };
  }
  return null;
};

const workflowRunEventScope = (value: unknown): WorkflowRunEventScope => {
  if (!value || typeof value !== "object") return { kind: "workflow" };
  const authorization = value as Record<string, unknown>;
  return authorization.kind === "dashboard-widget" &&
    typeof authorization.dashboardId === "string" &&
    typeof authorization.dashboardWidgetId === "string"
    ? { kind: "dashboard-widget", dashboardId: authorization.dashboardId, dashboardWidgetId: authorization.dashboardWidgetId }
    : { kind: "workflow" };
};

export type RecoverableQueuedWorkflowRun = WorkflowRun & {
  actorGroupIds: string[];
  authorization: unknown;
  queueAttempts: number;
};

export type PersistedWorkflowRun = Omit<RecoverableQueuedWorkflowRun, "authorization"> & {
  authorization: StoredWorkflowAuthorization;
  workflowDefinition: WorkflowDefinition;
  workflowCatalog: WorkflowCatalogSnapshot;
};

type FinishRunInput = {
  status: Extract<WorkflowRun["status"], "succeeded" | "failed" | "canceled">;
  error?: string | null;
  resultMessage?: string | null;
};

type ClaimedWorkflowRun = {
  run: WorkflowRun;
  claimed: boolean;
  executionGeneration: number | null;
};

type WorkflowRunCursor = {
  createdAt: string;
  id: string;
};

const DEFAULT_RUN_LEASE_MS = 120_000;

type ListWorkflowRunsPageParams = {
  baseId: string;
  workflowIds: string[];
  workflowId?: string | null;
  status?: WorkflowRun["status"] | null;
  triggerKind?: WorkflowTriggerKind | null;
  cursor?: string | null;
  limit?: number | null;
};

type ListWorkflowEmailDeliveriesPageParams = {
  baseId: string;
  workflowIds: string[];
  workflowId?: string | null;
  cursor?: string | null;
  limit?: number | null;
};

type WorkflowRunPage = {
  items: WorkflowRun[];
  nextCursor: string | null;
};

type WorkflowEmailDeliveryPage = {
  items: WorkflowEmailDelivery[];
  nextCursor: string | null;
};

const encodeRunCursor = (run: WorkflowRun): string => `${run.createdAt}|${run.id}`;

const parseRunCursor = (cursor: string | null | undefined): WorkflowRunCursor | null => {
  if (!cursor) return null;
  const [createdAt, id, ...rest] = cursor.split("|");
  if (!createdAt || !id || rest.length > 0) return null;
  return { createdAt, id };
};

const mapRunRow = (row: DbRow): WorkflowRun => ({
  id: row.id as string,
  workflowId: (row.workflow_id as string | null) ?? null,
  baseId: row.base_id as string,
  actorUserId: (row.actor_user_id as string | null) ?? null,
  serviceAccountId: (row.service_account_id as string | null) ?? null,
  triggerKind: row.trigger_kind as WorkflowTriggerKind,
  triggerInput: parseJsonbRow<WorkflowRun["triggerInput"]>(row.trigger_input, null),
  resolvedInput: parseJsonbRow<WorkflowRun["resolvedInput"]>(row.resolved_input, null),
  status: row.status as WorkflowRun["status"],
  error: (row.error as string | null) ?? null,
  resultMessage: (row.result_message as string | null) ?? null,
  createdAt: (row.created_at as Date).toISOString(),
  startedAt: row.started_at ? (row.started_at as Date).toISOString() : null,
  finishedAt: row.finished_at ? (row.finished_at as Date).toISOString() : null,
});

const mapRecoverableRunRow = (row: DbRow): RecoverableQueuedWorkflowRun => ({
  ...mapRunRow(row),
  actorGroupIds: parseJsonbRow<string[]>(row.actor_group_ids, []),
  authorization: parseJsonbRow<unknown>(row.trigger_authorization, null),
  queueAttempts: Number(row.queue_attempts ?? 0),
});

const mapPersistedRunRow = (row: DbRow): PersistedWorkflowRun => {
  const definition = WorkflowDefinitionSchema.safeParse(parseJsonbRow<unknown>(row.workflow_definition, null));
  if (!definition.success) throw err.internal("stored workflow run definition is invalid");
  const catalog = WorkflowCatalogSnapshotSchema.safeParse(parseJsonbRow<unknown>(row.workflow_catalog, null));
  if (!catalog.success) throw err.internal("stored workflow run catalog is invalid");
  const authorization = parseStoredWorkflowAuthorization(parseJsonbRow<unknown>(row.trigger_authorization, null));
  if (!authorization) throw err.internal("stored workflow run authorization is invalid");
  return {
    ...mapRecoverableRunRow(row),
    authorization,
    workflowDefinition: definition.data,
    workflowCatalog: catalog.data,
  };
};

export const createWorkflowRun = async (input: CreateRunInput, client: SqlClient = sql): Promise<PersistedWorkflowRun> => {
  const workflowCatalog = input.workflowCatalog ?? snapshotWorkflowCatalog(await loadWorkflowCatalog(input.baseId));
  const [row] = await client<DbRow[]>`
    INSERT INTO grids.workflow_runs (
      workflow_id, base_id, actor_user_id, actor_group_ids, service_account_id, trigger_authorization, trigger_kind,
      trigger_key, trigger_input, resolved_input, workflow_definition, workflow_catalog, status
    )
    VALUES (
      ${input.workflowId}::uuid,
      ${input.baseId}::uuid,
      ${input.actorUserId ?? null}::uuid,
      ${toPgUuidArray(input.actorGroupIds ?? [])}::uuid[],
      ${input.serviceAccountId ?? null}::uuid,
      ${input.authorization ?? { kind: "workflow" }}::jsonb,
      ${input.triggerKind},
      ${input.triggerKey ?? null},
      ${input.triggerInput ?? null}::jsonb,
      ${input.resolvedInput ?? null}::jsonb,
      ${input.workflowDefinition}::jsonb,
      ${workflowCatalog}::jsonb,
      'queued'
    )
    ON CONFLICT (workflow_id, trigger_kind, trigger_key)
    WHERE trigger_key IS NOT NULL AND workflow_id IS NOT NULL
    DO UPDATE SET trigger_key = grids.workflow_runs.trigger_key
    RETURNING id, workflow_id, base_id, actor_user_id, to_json(actor_group_ids) AS actor_group_ids,
              service_account_id, trigger_authorization,
              trigger_kind, trigger_input, resolved_input, workflow_definition, workflow_catalog, status, error, result_message, queue_attempts,
              created_at, started_at, finished_at
  `;
  if (!row) throw err.internal("workflow run insert failed");
  const run = mapPersistedRunRow(row);
  await notifyWorkflowRunEvent(run, [], workflowRunEventScope(run.authorization));
  return run;
};

export const claimRecoverableRuns = async (staleMs = 30_000, limit = 100): Promise<RecoverableQueuedWorkflowRun[]> => {
  const cap = Math.min(Math.max(limit, 1), 500);
  const rows = await sql.begin(async (tx) => {
    const recovered = await tx<DbRow[]>`
      WITH candidates AS (
        SELECT id
        FROM grids.workflow_runs
        WHERE (
            status = 'queued'
            AND created_at < now() - (${staleMs} * interval '1 millisecond')
            AND (last_queue_attempt_at IS NULL OR last_queue_attempt_at < now() - (${staleMs} * interval '1 millisecond'))
          ) OR (
            status = 'running'
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at < now()
            AND (last_queue_attempt_at IS NULL OR last_queue_attempt_at < now() - (${staleMs} * interval '1 millisecond'))
          )
        ORDER BY created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT ${cap}
      )
      UPDATE grids.workflow_runs wr
      SET queue_attempts = queue_attempts + 1,
          last_queue_attempt_at = now(),
          status = 'queued',
          heartbeat_at = NULL,
          lease_expires_at = NULL
      FROM candidates c
      WHERE wr.id = c.id
      RETURNING wr.id, wr.workflow_id, wr.base_id, wr.actor_user_id, to_json(wr.actor_group_ids) AS actor_group_ids,
                wr.service_account_id,
                wr.trigger_authorization, wr.trigger_kind, wr.trigger_input, wr.resolved_input, wr.status, wr.error,
                wr.result_message, wr.queue_attempts, wr.created_at, wr.started_at, wr.finished_at
    `;
    for (const row of recovered) {
      await logAudit(
        {
          baseId: row.base_id as string,
          userId: (row.actor_user_id as string | null) ?? null,
          action: "workflow.run.recovered",
          diff: {
            workflowRun: {
              old: null,
              new: { id: row.id, workflowId: row.workflow_id, status: "queued", queueAttempt: row.queue_attempts },
            },
          },
        },
        tx,
      );
    }
    return recovered;
  });
  const runs = rows.map(mapRecoverableRunRow);
  await Promise.all(
    runs.map((run) => notifyWorkflowRunEvent(run, [], workflowRunEventScope(run.authorization), `attempt:${run.queueAttempts}`)),
  );
  return runs;
};

export const failQueuedRunAttempt = async (runId: string, queueAttempt: number, error: string): Promise<WorkflowRun | null> => {
  const row = await sql.begin(async (tx) => {
    const [updated] = await tx<DbRow[]>`
      UPDATE grids.workflow_runs
      SET status = 'failed',
          error = ${error},
          lease_expires_at = NULL,
          finished_at = now()
      WHERE id = ${runId}::uuid
        AND status = 'queued'
        AND queue_attempts = ${queueAttempt}
      RETURNING id, workflow_id, base_id, actor_user_id, service_account_id, trigger_authorization, trigger_kind, trigger_input,
                resolved_input, status, error, result_message, created_at, started_at, finished_at
    `;
    if (!updated) return null;
    await logAudit(
      {
        baseId: updated.base_id as string,
        userId: (updated.actor_user_id as string | null) ?? null,
        action: "workflow.run.failed",
        diff: {
          workflowRun: {
            old: null,
            new: {
              id: updated.id,
              workflowId: updated.workflow_id,
              serviceAccountId: updated.service_account_id,
              status: "failed",
            },
          },
        },
      },
      tx,
    );
    return updated;
  });
  if (!row) return null;
  const run = mapRunRow(row);
  await notifyWorkflowRunEvent(run, [], workflowRunEventScope(parseJsonbRow(row.trigger_authorization, null)));
  return run;
};

export const claimRun = async (
  runId: string,
  leaseMs = DEFAULT_RUN_LEASE_MS,
  expectedQueueAttempt?: number,
): Promise<ClaimedWorkflowRun> => {
  const row = await sql.begin(async (tx) => {
    const [updated] = await tx<DbRow[]>`
      UPDATE grids.workflow_runs
      SET status = 'running',
          started_at = COALESCE(started_at, now()),
          heartbeat_at = now(),
          lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'),
          execution_generation = execution_generation + 1
      WHERE id = ${runId}::uuid
        AND (${expectedQueueAttempt ?? null}::int IS NULL OR queue_attempts = ${expectedQueueAttempt ?? null})
        AND (
          status = 'queued'
          OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now())
        )
      RETURNING id, workflow_id, base_id, actor_user_id, service_account_id, trigger_authorization, trigger_kind, trigger_input,
                execution_generation,
                resolved_input, status, error, result_message, created_at, started_at, finished_at
    `;
    if (!updated) return null;
    await logAudit(
      {
        baseId: updated.base_id as string,
        userId: (updated.actor_user_id as string | null) ?? null,
        action: "workflow.run.started",
        diff: {
          workflowRun: {
            old: null,
            new: {
              id: updated.id,
              workflowId: updated.workflow_id,
              serviceAccountId: updated.service_account_id,
              triggerKind: updated.trigger_kind,
            },
          },
        },
      },
      tx,
    );
    return updated;
  });
  if (!row) {
    const existing = await getWorkflowRun(runId);
    if (existing) return { run: existing, claimed: false, executionGeneration: null };
    throw err.notFound("workflow run");
  }
  const run = mapRunRow(row);
  await notifyWorkflowRunEvent(
    run,
    [],
    workflowRunEventScope(parseJsonbRow(row.trigger_authorization, null)),
    `generation:${row.execution_generation}`,
  );
  return { run, claimed: true, executionGeneration: Number(row.execution_generation) };
};

export const heartbeatRun = async (
  runId: string,
  executionGeneration: number,
  leaseMs = DEFAULT_RUN_LEASE_MS,
  client: SqlClient = sql,
): Promise<boolean> => {
  const [row] = await client<{ id: string }[]>`
    UPDATE grids.workflow_runs
    SET heartbeat_at = now(),
        lease_expires_at = now() + (${leaseMs} * interval '1 millisecond')
    WHERE id = ${runId}::uuid
      AND status = 'running'
      AND execution_generation = ${executionGeneration}
    RETURNING id::text AS id
  `;
  return Boolean(row);
};

export const finishRun = async (runId: string, executionGeneration: number, input: FinishRunInput): Promise<WorkflowRun | null> => {
  const row = await sql.begin(async (tx) => {
    const [updated] = await tx<DbRow[]>`
      UPDATE grids.workflow_runs
      SET status = ${input.status},
          error = ${input.error ?? null},
          result_message = ${input.resultMessage ?? null},
          lease_expires_at = NULL,
          finished_at = now()
      WHERE id = ${runId}::uuid
        AND status = 'running'
        AND execution_generation = ${executionGeneration}
      RETURNING id, workflow_id, base_id, actor_user_id, service_account_id, trigger_authorization, trigger_kind, trigger_input,
                resolved_input, status, error, result_message, created_at, started_at, finished_at
    `;
    if (!updated) return null;
    await logAudit(
      {
        baseId: updated.base_id as string,
        userId: (updated.actor_user_id as string | null) ?? null,
        action: input.status === "succeeded" ? "workflow.run.succeeded" : "workflow.run.failed",
        diff: {
          workflowRun: {
            old: null,
            new: {
              id: updated.id,
              workflowId: updated.workflow_id,
              serviceAccountId: updated.service_account_id,
              status: input.status,
            },
          },
        },
      },
      tx,
    );
    return updated;
  });
  if (!row) return null;
  const run = mapRunRow(row);
  await notifyWorkflowRunEvent(run, await listStepRuns(run.id), workflowRunEventScope(parseJsonbRow(row.trigger_authorization, null)));
  return run;
};

export const listRuns = async (workflowId: string, limit = 50): Promise<WorkflowRun[]> => {
  const cap = Math.min(Math.max(limit, 1), 200);
  const rows = await sql<DbRow[]>`
    SELECT id, workflow_id, base_id, actor_user_id, service_account_id, trigger_kind, trigger_input,
           resolved_input, status, error, result_message, created_at, started_at, finished_at
    FROM grids.workflow_runs
    WHERE workflow_id = ${workflowId}::uuid
    ORDER BY created_at DESC, id DESC
    LIMIT ${cap}
  `;
  return rows.map(mapRunRow);
};

export const listRunsPage = async (params: ListWorkflowRunsPageParams): Promise<WorkflowRunPage> => {
  if (params.workflowIds.length === 0) return { items: [], nextCursor: null };
  const cap = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const workflowIds = toPgUuidArray(params.workflowIds);
  const cursor = parseRunCursor(params.cursor);
  const workflowIdClause = params.workflowId ? sql`AND workflow_id = ${params.workflowId}::uuid` : sql``;
  const statusClause = params.status ? sql`AND status = ${params.status}` : sql``;
  const triggerClause = params.triggerKind ? sql`AND trigger_kind = ${params.triggerKind}` : sql``;
  const cursorClause = cursor ? sql`AND (created_at, id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql``;
  const rows = await sql<DbRow[]>`
    SELECT id, workflow_id, base_id, actor_user_id, service_account_id, trigger_kind, trigger_input,
           resolved_input, status, error, result_message, created_at, started_at, finished_at
    FROM grids.workflow_runs
    WHERE base_id = ${params.baseId}::uuid
      AND workflow_id = ANY(${workflowIds}::uuid[])
      ${workflowIdClause}
      ${statusClause}
      ${triggerClause}
      ${cursorClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ${cap + 1}
  `;
  const mapped = rows.map(mapRunRow);
  const items = mapped.slice(0, cap);
  const nextCursor = mapped.length > cap && items.length > 0 ? encodeRunCursor(items[items.length - 1]!) : null;
  return { items, nextCursor };
};

export const listEmailDeliveriesPage = async (params: ListWorkflowEmailDeliveriesPageParams): Promise<WorkflowEmailDeliveryPage> => {
  if (params.workflowIds.length === 0) return { items: [], nextCursor: null };
  const cap = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const cursor = parseRunCursor(params.cursor);
  const rows = await listWorkflowEmailDeliveries({
    baseId: params.baseId,
    workflowIds: params.workflowIds,
    workflowId: params.workflowId,
    cursor,
    limit: cap + 1,
  });
  const pageRows = rows.slice(0, cap);
  return {
    items: pageRows.map((row) => row.delivery),
    nextCursor: rows.length > cap ? (pageRows[pageRows.length - 1]?.cursor ?? null) : null,
  };
};

export const getWorkflowRun = async (runId: string): Promise<WorkflowRun | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT id, workflow_id, base_id, actor_user_id, service_account_id, trigger_kind, trigger_input,
           resolved_input, status, error, result_message, created_at, started_at, finished_at
    FROM grids.workflow_runs
    WHERE id = ${runId}::uuid
  `;
  return row ? mapRunRow(row) : null;
};

export const getPersistedWorkflowRun = async (runId: string): Promise<PersistedWorkflowRun | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT id, workflow_id, base_id, actor_user_id, to_json(actor_group_ids) AS actor_group_ids,
           service_account_id, trigger_authorization, trigger_kind, trigger_input, resolved_input, workflow_definition,
           workflow_catalog,
           status, error, result_message, queue_attempts, created_at, started_at, finished_at
    FROM grids.workflow_runs
    WHERE id = ${runId}::uuid
  `;
  return row ? mapPersistedRunRow(row) : null;
};

export const getWorkflowRunScope = async (runId: string): Promise<WorkflowRunEventScope | null> => {
  const [row] = await sql<Array<{ trigger_authorization: unknown }>>`
    SELECT trigger_authorization
    FROM grids.workflow_runs
    WHERE id = ${runId}::uuid
  `;
  return row ? workflowRunEventScope(parseJsonbRow(row.trigger_authorization, null)) : null;
};
