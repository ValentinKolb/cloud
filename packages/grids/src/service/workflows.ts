import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type {
  CreateWorkflowInput,
  UpdateWorkflowInput,
  Workflow,
  WorkflowDefinition,
  WorkflowEmailDelivery,
  WorkflowRun,
  WorkflowTriggerKind,
} from "../contracts";
import { WorkflowDefinitionSchema } from "../contracts";
import type { WorkflowRunEventScope } from "../lib/workflow-run-events";
import { parseWorkflowYaml } from "../workflows/dsl";
import { logAudit, type SqlClient } from "./audit";
import { listByTable as listFields } from "./fields";
import { compileFilter, renderClause } from "./filter-compiler";
import { parseJsonbRow } from "./jsonb";
import { emitMetadataEvent } from "./metadata-events";
import type { GridsRecordEvent } from "./record-events";
import { insertWithShortId } from "./short-id";
import { loadWorkflowCatalog, resolveWorkflowTableRef, type WorkflowCatalog } from "./workflow-catalog";
import { listWorkflowEmailDeliveries } from "./workflow-email-deliveries";
import { validateWorkflowReferences } from "./workflow-reference-validator";
import { notifyWorkflowRunEvent } from "./workflow-run-events";
import { listStepRunsWithClient } from "./workflow-step-runs";

type DbRow = Record<string, unknown>;

type CreateRunInput = {
  workflowId: string;
  baseId: string;
  triggerKind: WorkflowTriggerKind;
  triggerKey?: string | null;
  triggerInput?: Record<string, unknown> | null;
  resolvedInput?: Record<string, unknown> | null;
  actorUserId?: string | null;
  actorGroupIds?: string[];
  serviceAccountId?: string | null;
  authorization?: StoredWorkflowAuthorization;
};

type StoredWorkflowAuthorization = { kind: "workflow" } | { kind: "dashboard-widget"; dashboardId: string; dashboardWidgetId: string };

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

type FinishRunInput = {
  status: Extract<WorkflowRun["status"], "succeeded" | "failed" | "canceled">;
  error?: string | null;
  resultMessage?: string | null;
};

type ClaimedWorkflowRun = {
  run: WorkflowRun;
  claimed: boolean;
};

export { ensureRecordScanCode, getOrCreateRecordScanCode, getRecordScanCode } from "./record-scan-codes";
export type { WorkflowCatalog, WorkflowCatalogEntry } from "./workflow-catalog";
export {
  buildWorkflowCatalog,
  loadWorkflowCatalog,
  resolveWorkflowEmailTemplateRef,
  resolveWorkflowFieldRef,
  resolveWorkflowTableRef,
  resolveWorkflowTemplateRef,
} from "./workflow-catalog";
export { validateWorkflowReferences } from "./workflow-reference-validator";
export { runStats } from "./workflow-run-stats";
export { createStepRun, finishStepRun, getStepRunByPath, listStepRuns } from "./workflow-step-runs";

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

const workflowMetadataEvent = async (
  type: "workflow.created" | "workflow.updated" | "workflow.deleted",
  baseId: string,
  workflowId: string,
  actorId: string | null = null,
): Promise<void> => {
  await emitMetadataEvent({
    type,
    baseId,
    resource: { kind: "workflow", id: workflowId },
    actorId,
  });
};

const mapWorkflowRow = (row: DbRow): Workflow => {
  const rawCompiled = parseJsonbRow<unknown>(row.compiled, {});
  const parsed = WorkflowDefinitionSchema.safeParse(rawCompiled);
  if (!parsed.success) throw err.internal("stored workflow definition is invalid");
  return {
    id: row.id as string,
    shortId: row.short_id as string,
    baseId: row.base_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    source: row.source as string,
    compiled: parsed.data,
    enabled: row.enabled as boolean,
    position: row.position as number,
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
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

const workflowTimeZone = async (): Promise<string> =>
  normalizeTimeZone(String((await settingsGet<string>("app.timezone")) || "").trim(), "UTC");

const validateBaseReferences = async (baseId: string, definition: WorkflowDefinition): Promise<Result<void>> => {
  const catalog = await loadWorkflowCatalog(baseId);
  const diagnostics = validateWorkflowReferences(definition, catalog);
  const recordEvent = definition.triggers.recordEvent;
  if (recordEvent?.filter && (recordEvent.table || recordEvent.input)) {
    const input = recordEvent.input ? definition.inputs?.[recordEvent.input] : null;
    const tableRef = recordEvent.table ?? (input?.type === "record" ? input.table : null);
    const table = tableRef ? resolveWorkflowTableRef(catalog, tableRef) : null;
    if (table) {
      const fields = await listFields(table.id);
      const compiled = compileFilter(recordEvent.filter, fields, { timeZone: await workflowTimeZone() });
      if (!compiled.ok) diagnostics.push(`triggers.recordEvent.filter: ${compiled.error}`);
    }
  }
  return diagnostics.length > 0 ? fail(err.badInput(diagnostics.join("; "))) : ok();
};

const compileSource = async (baseId: string, source: string): Promise<Result<Workflow["compiled"]>> => {
  const parsed = parseWorkflowYaml(source);
  if (parsed.ok) {
    const refs = await validateBaseReferences(baseId, parsed.definition);
    return refs.ok ? ok(parsed.definition) : fail(refs.error);
  }
  const message = parsed.diagnostics.map((diagnostic) => diagnostic.message).join("; ");
  return fail(err.badInput(message || "workflow YAML is invalid"));
};

export const get = async (id: string, opts: { includeDeleted?: boolean } = {}): Promise<Workflow | null> => {
  const [row] = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position,
               w.owner_user_id, w.deleted_at, w.created_at, w.updated_at
        FROM grids.workflows w
        JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
        WHERE w.id = ${id}::uuid
      `
    : await sql<DbRow[]>`
        SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position,
               w.owner_user_id, w.deleted_at, w.created_at, w.updated_at
        FROM grids.workflows w
        JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
        WHERE w.id = ${id}::uuid AND w.deleted_at IS NULL
      `;
  return row ? mapWorkflowRow(row) : null;
};

export const getByShortId = async (baseId: string, shortId: string): Promise<Workflow | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position,
           w.owner_user_id, w.deleted_at, w.created_at, w.updated_at
    FROM grids.workflows w
    JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
    WHERE w.base_id = ${baseId}::uuid AND w.short_id = ${shortId} AND w.deleted_at IS NULL
  `;
  return row ? mapWorkflowRow(row) : null;
};

export const getByIdOrShortId = async (baseId: string, idOrShortId: string): Promise<Workflow | null> => {
  if (idOrShortId.length === 36 && idOrShortId.includes("-")) {
    const workflow = await get(idOrShortId);
    return workflow && workflow.baseId === baseId ? workflow : null;
  }
  return getByShortId(baseId, idOrShortId);
};

export const listForBase = async (baseId: string): Promise<Workflow[]> => {
  const rows = await sql<DbRow[]>`
    SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position,
           w.owner_user_id, w.deleted_at, w.created_at, w.updated_at
    FROM grids.workflows w
    JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
    WHERE w.base_id = ${baseId}::uuid AND w.deleted_at IS NULL
    ORDER BY w.position, w.created_at, w.id
  `;
  return rows.map(mapWorkflowRow);
};

export const listEnabledForBase = async (baseId: string): Promise<Workflow[]> => {
  const rows = await sql<DbRow[]>`
    SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position,
           w.owner_user_id, w.deleted_at, w.created_at, w.updated_at
    FROM grids.workflows w
    JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
    WHERE w.base_id = ${baseId}::uuid AND w.deleted_at IS NULL AND w.enabled = TRUE
    ORDER BY w.position, w.created_at, w.id
  `;
  return rows.map(mapWorkflowRow);
};

export const listScheduledEnabled = async (): Promise<Workflow[]> => {
  const rows = await sql<DbRow[]>`
    SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position,
           w.owner_user_id, w.deleted_at, w.created_at, w.updated_at
    FROM grids.workflows w
    JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
    WHERE w.deleted_at IS NULL
      AND w.enabled = TRUE
      AND w.compiled->'triggers' ? 'schedule'
    ORDER BY w.created_at, w.id
  `;
  return rows.map(mapWorkflowRow);
};

// Consumed through the injected workflow store namespace in workflow-trigger-runtime.
// fallow-ignore-next-line unused-export
export const listRecordEventBaseIds = async (): Promise<string[]> => {
  const rows = await sql<Array<{ id: string }>>`
    SELECT DISTINCT w.base_id::text AS id
    FROM grids.workflows w
    JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
    WHERE w.deleted_at IS NULL
      AND w.enabled = TRUE
      AND w.compiled->'triggers' ? 'recordEvent'
      AND w.record_event_active_since IS NOT NULL
    ORDER BY id
  `;
  return rows.map((row) => row.id);
};

const workflowRecordEventName = (event: GridsRecordEvent): "created" | "updated" | "deleted" | null => {
  switch (event.type) {
    case "record.created":
      return "created";
    case "record.updated":
      return "updated";
    case "record.deleted":
      return "deleted";
    case "record.restored":
      return null;
  }
};

const recordEventTableId = (workflow: Workflow, catalog: WorkflowCatalog): string | null => {
  const trigger = workflow.compiled.triggers.recordEvent;
  if (!trigger) return null;
  if (trigger.table) return resolveWorkflowTableRef(catalog, trigger.table)?.id ?? null;
  if (trigger.input) {
    const input = workflow.compiled.inputs?.[trigger.input];
    return input?.type === "record" && input.table ? (resolveWorkflowTableRef(catalog, input.table)?.id ?? null) : null;
  }
  return null;
};

export const listRecordEventEnabled = async (event: GridsRecordEvent): Promise<Workflow[]> => {
  const eventName = workflowRecordEventName(event);
  if (!eventName) return [];
  const occurredAt = Date.parse(event.occurredAt);
  if (!Number.isFinite(occurredAt)) return [];
  const rows = await sql<DbRow[]>`
    SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position,
           w.owner_user_id, w.deleted_at, w.created_at, w.updated_at, w.record_event_active_since
    FROM grids.workflows w
    JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
    WHERE w.base_id = ${event.baseId}::uuid
      AND w.deleted_at IS NULL
      AND w.enabled = TRUE
      AND w.compiled->'triggers' ? 'recordEvent'
      AND w.record_event_active_since IS NOT NULL
      AND w.record_event_active_since <= ${event.occurredAt}::timestamptz
    ORDER BY w.position, w.created_at, w.id
  `;
  const workflows = rows.map(mapWorkflowRow);
  const catalog = await loadWorkflowCatalog(event.baseId);
  return workflows.filter((workflow) => {
    const trigger = workflow.compiled.triggers.recordEvent;
    if (!trigger || trigger.event !== eventName) return false;
    const tableId = recordEventTableId(workflow, catalog);
    return !tableId || tableId === event.tableId;
  });
};

export const recordMatchesWorkflowFilter = async (workflow: Workflow, event: GridsRecordEvent): Promise<Result<boolean>> => {
  const trigger = workflow.compiled.triggers.recordEvent;
  if (!trigger?.filter) return ok(true);
  const catalog = await loadWorkflowCatalog(workflow.baseId);
  const tableId = recordEventTableId(workflow, catalog);
  if (!tableId) return fail(err.badInput("recordEvent filters require a table or record input"));
  const fields = await listFields(tableId);
  const compiled = compileFilter(trigger.filter, fields, { timeZone: await workflowTimeZone() });
  if (!compiled.ok) return fail(err.badInput(`workflow recordEvent filter is invalid: ${compiled.error}`));
  const clause = renderClause(compiled.clause);
  const [row] = await sql<{ matched: boolean }[]>`
    SELECT EXISTS(
      SELECT 1
      FROM grids.records r
      WHERE r.id = ${event.recordId}::uuid
        AND r.table_id = ${tableId}::uuid
        AND ${event.type === "record.deleted" ? sql`TRUE` : sql`r.deleted_at IS NULL`}
        AND ${clause}
    ) AS matched
  `;
  return ok(Boolean(row?.matched));
};

export const create = async (baseId: string, input: CreateWorkflowInput, actorId: string | null): Promise<Result<Workflow>> => {
  const compiled = await compileSource(baseId, input.source);
  if (!compiled.ok) return compiled;
  const recordEventActive = Boolean(input.enabled && compiled.data.triggers.recordEvent);

  const workflow = await sql.begin(async (tx): Promise<Workflow> => {
    const row = await insertWithShortId(async (shortId) => {
      const [inserted] = await tx<DbRow[]>`
          INSERT INTO grids.workflows (
            short_id, base_id, name, description, source, compiled, enabled, position, owner_user_id, record_event_active_since
          )
          VALUES (
            ${shortId},
            ${baseId}::uuid,
            ${input.name.trim()},
            ${input.description ?? null},
            ${input.source},
            ${compiled.data}::jsonb,
            ${input.enabled ?? false},
            ${input.position ?? 0},
            ${actorId}::uuid,
            ${recordEventActive ? sql`now()` : null}
          )
          RETURNING id, short_id, base_id, name, description, source, compiled, enabled, position, owner_user_id, deleted_at, created_at, updated_at
        `;
      if (!inserted) throw err.internal("workflow insert failed");
      return inserted;
    }, "idx_grids_workflows_short_id");
    const created = mapWorkflowRow(row);
    await logAudit(
      {
        baseId,
        userId: actorId,
        action: "workflow.created",
        diff: { workflow: { old: null, new: { id: created.id, name: created.name, enabled: created.enabled } } },
      },
      tx,
    );
    return created;
  });
  await workflowMetadataEvent("workflow.created", baseId, workflow.id, actorId);
  return ok(workflow);
};

export const update = async (id: string, input: UpdateWorkflowInput, actorId: string | null): Promise<Result<Workflow>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("workflow"));
  const nextSource = input.source ?? existing.source;
  const compiled = input.source === undefined ? ok(existing.compiled) : await compileSource(existing.baseId, nextSource);
  if (!compiled.ok) return compiled;
  const nextEnabled = input.enabled ?? existing.enabled;
  const existingRecordEvent = existing.compiled.triggers.recordEvent ?? null;
  const nextRecordEvent = compiled.data.triggers.recordEvent ?? null;
  const recordEventChanged = JSON.stringify(existingRecordEvent) !== JSON.stringify(nextRecordEvent);
  const activateRecordEvent = Boolean(nextEnabled && nextRecordEvent && (!existing.enabled || !existingRecordEvent || recordEventChanged));
  const deactivateRecordEvent = !nextEnabled || !nextRecordEvent;

  const workflow = await sql.begin(async (tx): Promise<Workflow> => {
    const [row] = await tx<DbRow[]>`
      UPDATE grids.workflows
      SET name = ${input.name === undefined ? existing.name : input.name.trim()},
          description = ${input.description === undefined ? existing.description : input.description},
          source = ${nextSource},
          compiled = ${compiled.data}::jsonb,
          enabled = ${nextEnabled},
          position = ${input.position ?? existing.position},
          record_event_active_since = CASE
            WHEN ${deactivateRecordEvent} THEN NULL
            WHEN ${activateRecordEvent} THEN now()
            ELSE record_event_active_since
          END,
          updated_at = now()
      WHERE id = ${id}::uuid AND deleted_at IS NULL
      RETURNING id, short_id, base_id, name, description, source, compiled, enabled, position, owner_user_id, deleted_at, created_at, updated_at
    `;
    if (!row) throw err.notFound("workflow");
    const updated = mapWorkflowRow(row);
    await logAudit(
      {
        baseId: updated.baseId,
        userId: actorId,
        action: "workflow.updated",
        diff: {
          workflow: {
            old: { id: existing.id, name: existing.name, enabled: existing.enabled },
            new: { id: updated.id, name: updated.name, enabled: updated.enabled },
          },
        },
      },
      tx,
    );
    return updated;
  });
  await workflowMetadataEvent("workflow.updated", workflow.baseId, workflow.id, actorId);
  return ok(workflow);
};

export const remove = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("workflow"));
  const result = await sql.begin(async (tx): Promise<Result<void>> => {
    const updated = await tx`
      UPDATE grids.workflows
      SET deleted_at = now(), enabled = FALSE, updated_at = now()
      WHERE id = ${id}::uuid AND deleted_at IS NULL
    `;
    if (updated.count === 0) return fail(err.notFound("workflow"));
    await logAudit(
      {
        baseId: existing.baseId,
        userId: actorId,
        action: "workflow.deleted",
        diff: { workflow: { old: { id: existing.id, name: existing.name }, new: null } },
      },
      tx,
    );
    return ok();
  });
  if (result.ok) await workflowMetadataEvent("workflow.deleted", existing.baseId, existing.id, actorId);
  return result;
};

export const createWorkflowRun = async (input: CreateRunInput, client: SqlClient = sql): Promise<RecoverableQueuedWorkflowRun> => {
  const [row] = await client<DbRow[]>`
    INSERT INTO grids.workflow_runs (
      workflow_id, base_id, actor_user_id, actor_group_ids, service_account_id, trigger_authorization, trigger_kind,
      trigger_key, trigger_input, resolved_input, status
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
      'queued'
    )
    ON CONFLICT (workflow_id, trigger_kind, trigger_key)
    WHERE trigger_key IS NOT NULL AND workflow_id IS NOT NULL
    DO UPDATE SET trigger_key = grids.workflow_runs.trigger_key
    RETURNING id, workflow_id, base_id, actor_user_id, to_json(actor_group_ids) AS actor_group_ids,
              service_account_id, trigger_authorization,
              trigger_kind, trigger_input, resolved_input, status, error, result_message, queue_attempts,
              created_at, started_at, finished_at
  `;
  if (!row) throw err.internal("workflow run insert failed");
  const run = mapRecoverableRunRow(row);
  await notifyWorkflowRunEvent(run, [], workflowRunEventScope(run.authorization));
  return run;
};

export const claimStaleQueuedRuns = async (staleMs = 30_000, limit = 100): Promise<RecoverableQueuedWorkflowRun[]> => {
  const cap = Math.min(Math.max(limit, 1), 500);
  const rows = await sql<DbRow[]>`
    WITH candidates AS (
      SELECT id
      FROM grids.workflow_runs
      WHERE status = 'queued'
        AND created_at < now() - (${staleMs} * interval '1 millisecond')
        AND (last_queue_attempt_at IS NULL OR last_queue_attempt_at < now() - (${staleMs} * interval '1 millisecond'))
      ORDER BY created_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT ${cap}
    )
    UPDATE grids.workflow_runs wr
    SET queue_attempts = queue_attempts + 1,
        last_queue_attempt_at = now()
    FROM candidates c
    WHERE wr.id = c.id
    RETURNING wr.id, wr.workflow_id, wr.base_id, wr.actor_user_id, to_json(wr.actor_group_ids) AS actor_group_ids,
              wr.service_account_id,
              wr.trigger_authorization, wr.trigger_kind, wr.trigger_input, wr.resolved_input, wr.status, wr.error,
              wr.result_message, wr.queue_attempts, wr.created_at, wr.started_at, wr.finished_at
  `;
  return rows.map(mapRecoverableRunRow);
};

export const failQueuedRunAttempt = async (
  runId: string,
  queueAttempt: number,
  error: string,
  client: SqlClient = sql,
): Promise<WorkflowRun | null> => {
  const [row] = await client<DbRow[]>`
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
  if (!row) return null;
  await logAudit(
    {
      baseId: row.base_id as string,
      userId: (row.actor_user_id as string | null) ?? null,
      action: "workflow.run.failed",
      diff: {
        workflowRun: {
          old: null,
          new: {
            id: row.id,
            workflowId: row.workflow_id,
            serviceAccountId: row.service_account_id,
            status: "failed",
          },
        },
      },
    },
    client,
  );
  const run = mapRunRow(row);
  await notifyWorkflowRunEvent(run, [], workflowRunEventScope(parseJsonbRow(row.trigger_authorization, null)));
  return run;
};

export const claimRun = async (runId: string, client: SqlClient = sql, leaseMs = DEFAULT_RUN_LEASE_MS): Promise<ClaimedWorkflowRun> => {
  const [row] = await client<DbRow[]>`
    UPDATE grids.workflow_runs
    SET status = 'running',
        started_at = COALESCE(started_at, now()),
        heartbeat_at = now(),
        lease_expires_at = now() + (${leaseMs} * interval '1 millisecond')
    WHERE id = ${runId}::uuid
      AND (
        status = 'queued'
        OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now())
      )
    RETURNING id, workflow_id, base_id, actor_user_id, service_account_id, trigger_authorization, trigger_kind, trigger_input,
              resolved_input, status, error, result_message, created_at, started_at, finished_at
  `;
  if (!row) {
    const existing = await getWorkflowRun(runId);
    if (existing) return { run: existing, claimed: false };
    throw err.notFound("workflow run");
  }
  await logAudit(
    {
      baseId: row.base_id as string,
      userId: (row.actor_user_id as string | null) ?? null,
      action: "workflow.run.started",
      diff: {
        workflowRun: {
          old: null,
          new: {
            id: row.id,
            workflowId: row.workflow_id,
            serviceAccountId: row.service_account_id,
            triggerKind: row.trigger_kind,
          },
        },
      },
    },
    client,
  );
  const run = mapRunRow(row);
  await notifyWorkflowRunEvent(run, [], workflowRunEventScope(parseJsonbRow(row.trigger_authorization, null)));
  return { run, claimed: true };
};

export const heartbeatRun = async (runId: string, leaseMs = DEFAULT_RUN_LEASE_MS, client: SqlClient = sql): Promise<void> => {
  await client`
    UPDATE grids.workflow_runs
    SET heartbeat_at = now(),
        lease_expires_at = now() + (${leaseMs} * interval '1 millisecond')
    WHERE id = ${runId}::uuid AND status = 'running'
  `;
};

export const finishRun = async (runId: string, input: FinishRunInput, client: SqlClient = sql): Promise<WorkflowRun> => {
  const [row] = await client<DbRow[]>`
    UPDATE grids.workflow_runs
    SET status = ${input.status},
        error = ${input.error ?? null},
        result_message = ${input.resultMessage ?? null},
        lease_expires_at = NULL,
        finished_at = now()
    WHERE id = ${runId}::uuid
    RETURNING id, workflow_id, base_id, actor_user_id, service_account_id, trigger_authorization, trigger_kind, trigger_input,
              resolved_input, status, error, result_message, created_at, started_at, finished_at
  `;
  if (!row) throw err.notFound("workflow run");
  await logAudit(
    {
      baseId: row.base_id as string,
      userId: (row.actor_user_id as string | null) ?? null,
      action: input.status === "succeeded" ? "workflow.run.succeeded" : "workflow.run.failed",
      diff: {
        workflowRun: {
          old: null,
          new: {
            id: row.id,
            workflowId: row.workflow_id,
            serviceAccountId: row.service_account_id,
            status: input.status,
          },
        },
      },
    },
    client,
  );
  const run = mapRunRow(row);
  await notifyWorkflowRunEvent(
    run,
    await listStepRunsWithClient(run.id, client),
    workflowRunEventScope(parseJsonbRow(row.trigger_authorization, null)),
  );
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

export const getWorkflowRunScope = async (runId: string): Promise<WorkflowRunEventScope | null> => {
  const [row] = await sql<Array<{ trigger_authorization: unknown }>>`
    SELECT trigger_authorization
    FROM grids.workflow_runs
    WHERE id = ${runId}::uuid
  `;
  return row ? workflowRunEventScope(parseJsonbRow(row.trigger_authorization, null)) : null;
};
