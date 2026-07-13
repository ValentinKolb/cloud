import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { CreateWorkflowInput, UpdateWorkflowInput, Workflow, WorkflowDefinition } from "../contracts";
import { WorkflowDefinitionSchema } from "../contracts";
import { parseWorkflowYaml } from "../workflows/dsl";
import { logAudit } from "./audit";
import { listByTable as listFields } from "./fields";
import { compileFilter, renderClause } from "./filter-compiler";
import { parseJsonbRow } from "./jsonb";
import { emitMetadataEvent } from "./metadata-events";
import type { GridsRecordEvent } from "./record-events";
import { insertWithShortId } from "./short-id";
import { loadWorkflowCatalog, resolveWorkflowTableRef, type WorkflowCatalog } from "./workflow-catalog";
import { validateWorkflowReferences } from "./workflow-reference-validator";
import { emitWorkflowRuntimeEvent } from "./workflow-runtime-events";

type DbRow = Record<string, unknown>;

const workflowRevisionConflict = () => ({
  code: "CONFLICT" as const,
  message: "Workflow changed since you opened it. Reload the latest version before saving.",
  status: 409 as const,
});

export { ensureRecordScanCode, getOrCreateRecordScanCode, getRecordScanCode } from "./record-scan-codes";
export type { WorkflowCatalog, WorkflowCatalogEntry, WorkflowCatalogSnapshot } from "./workflow-catalog";
export {
  buildWorkflowCatalog,
  loadWorkflowCatalog,
  resolveWorkflowEmailTemplateRef,
  resolveWorkflowFieldRef,
  resolveWorkflowTableRef,
  resolveWorkflowTemplateRef,
  restoreWorkflowCatalog,
  snapshotWorkflowCatalog,
} from "./workflow-catalog";
export { validateWorkflowReferences } from "./workflow-reference-validator";
export { runStats } from "./workflow-run-stats";
export {
  claimRecoverableRuns,
  claimRun,
  createFailedWorkflowRun,
  createWorkflowRun,
  failQueuedRunAttempt,
  finishRun,
  getPersistedWorkflowRun,
  getWorkflowRun,
  getWorkflowRunScope,
  heartbeatRun,
  listEmailDeliveriesPage,
  listRuns,
  listRunsPage,
  type PersistedWorkflowRun,
  type RecoverableQueuedWorkflowRun,
  type StoredWorkflowAuthorization,
} from "./workflow-runs";
export { createStepRun, finishStepRun, getStepRunByPath, listStepRuns } from "./workflow-step-runs";

const workflowMetadataEvent = async (
  type: "workflow.created" | "workflow.updated" | "workflow.deleted",
  baseId: string,
  workflowId: string,
  actorId: string | null = null,
): Promise<void> => {
  await Promise.all([
    emitMetadataEvent({
      type,
      baseId,
      resource: { kind: "workflow", id: workflowId },
      actorId,
    }),
    emitWorkflowRuntimeEvent(workflowId),
  ]);
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
    revision: row.revision as number,
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
};

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
        SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position, w.revision,
               w.owner_user_id, w.deleted_at, w.created_at, w.updated_at
        FROM grids.workflows w
        JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
        WHERE w.id = ${id}::uuid
      `
    : await sql<DbRow[]>`
        SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position, w.revision,
               w.owner_user_id, w.deleted_at, w.created_at, w.updated_at
        FROM grids.workflows w
        JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
        WHERE w.id = ${id}::uuid AND w.deleted_at IS NULL
      `;
  return row ? mapWorkflowRow(row) : null;
};

export const getByShortId = async (baseId: string, shortId: string): Promise<Workflow | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position, w.revision,
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
    SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position, w.revision,
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
    SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position, w.revision,
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
    SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position, w.revision,
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
    SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position, w.revision,
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
          RETURNING id, short_id, base_id, name, description, source, compiled, enabled, position, revision, owner_user_id, deleted_at, created_at, updated_at
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

export const update = async (
  id: string,
  input: UpdateWorkflowInput,
  actorId: string | null,
  expectedRevision: number,
): Promise<Result<Workflow>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("workflow"));
  if (existing.revision !== expectedRevision) {
    return fail(workflowRevisionConflict());
  }
  const nextSource = input.source ?? existing.source;
  const compiled = input.source === undefined ? ok(existing.compiled) : await compileSource(existing.baseId, nextSource);
  if (!compiled.ok) return compiled;
  const nextEnabled = input.enabled ?? existing.enabled;
  const existingRecordEvent = existing.compiled.triggers.recordEvent ?? null;
  const nextRecordEvent = compiled.data.triggers.recordEvent ?? null;
  const recordEventChanged = JSON.stringify(existingRecordEvent) !== JSON.stringify(nextRecordEvent);
  const activateRecordEvent = Boolean(nextEnabled && nextRecordEvent && (!existing.enabled || !existingRecordEvent || recordEventChanged));
  const deactivateRecordEvent = !nextEnabled || !nextRecordEvent;

  const workflow = await sql.begin(async (tx): Promise<Workflow | null> => {
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
      WHERE id = ${id}::uuid AND deleted_at IS NULL AND revision = ${expectedRevision}
      RETURNING id, short_id, base_id, name, description, source, compiled, enabled, position, revision, owner_user_id, deleted_at, created_at, updated_at
    `;
    if (!row) return null;
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
  if (!workflow) {
    return fail((await get(id)) ? workflowRevisionConflict() : err.notFound("workflow"));
  }
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
