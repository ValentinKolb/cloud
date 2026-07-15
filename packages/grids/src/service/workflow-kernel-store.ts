import type { WorkflowBoundPlan, WorkflowDiagnostic } from "@valentinkolb/cloud/workflows";
import { compileWorkflow } from "@valentinkolb/cloud/workflows/language";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { bindGridsWorkflow } from "../workflows/binder";
import type { CreateGridsWorkflowInput, GridsWorkflow, UpdateGridsWorkflowInput } from "../workflows/contracts";
import { GridsWorkflowSchema } from "../workflows/contracts";
import { gridsWorkflowManifest } from "../workflows/manifest";
import { logAudit } from "./audit";
import { emitMetadataEvent } from "./metadata-events";
import { insertWithShortId } from "./short-id";
import { loadWorkflowCatalog } from "./workflow-catalog";
import { emitWorkflowRuntimeEvent } from "./workflow-runtime-events";

type DbRow = Record<string, unknown>;

const revisionConflict = () => ({
  code: "CONFLICT" as const,
  message: "Workflow changed since you opened it. Reload the latest version before saving.",
  status: 409 as const,
});

const mapWorkflow = (row: DbRow): GridsWorkflow => {
  const parsed = GridsWorkflowSchema.safeParse({
    id: row.id,
    shortId: row.short_id,
    baseId: row.base_id,
    name: row.name,
    description: row.description ?? null,
    source: row.source,
    plan: row.plan,
    diagnostics: row.diagnostics,
    enabled: row.enabled,
    position: row.position,
    revision: row.revision,
    ownerUserId: row.owner_user_id ?? null,
    deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  });
  if (!parsed.success) throw err.internal("stored workflow is invalid");
  return parsed.data;
};

const selectColumns = sql`
  id, short_id, base_id, name, description, source, plan, diagnostics, enabled, position, revision,
  owner_user_id, deleted_at, created_at, updated_at
`;

const compileAndBind = async (baseId: string, source: string): Promise<Result<WorkflowBoundPlan>> => {
  const compiled = await compileWorkflow(source, gridsWorkflowManifest);
  if (!compiled.ok) return fail(err.badInput(compiled.diagnostics.map((diagnostic) => diagnostic.message).join("; ")));
  const bound = await bindGridsWorkflow(compiled.ir, await loadWorkflowCatalog(baseId));
  return bound.ok ? ok(bound.plan) : fail(err.badInput(bound.diagnostics.map((diagnostic) => diagnostic.message).join("; ")));
};

export const validateWorkflowSource = async (
  baseId: string,
  source: string,
): Promise<{ ok: true; plan: WorkflowBoundPlan } | { ok: false; diagnostics: WorkflowDiagnostic[] }> => {
  const compiled = await compileWorkflow(source, gridsWorkflowManifest);
  if (!compiled.ok) return compiled;
  const bound = await bindGridsWorkflow(compiled.ir, await loadWorkflowCatalog(baseId));
  return bound.ok ? { ok: true, plan: bound.plan } : bound;
};

const metadataEvent = async (
  type: "workflow.created" | "workflow.updated" | "workflow.deleted",
  workflow: Pick<GridsWorkflow, "id" | "baseId">,
  actorId: string | null,
): Promise<void> => {
  await Promise.all([
    emitMetadataEvent({
      type,
      baseId: workflow.baseId,
      resource: { kind: "workflow", id: workflow.id },
      actorId,
    }),
    emitWorkflowRuntimeEvent(workflow.id),
  ]);
};

export const getWorkflow = async (id: string, includeDeleted = false): Promise<GridsWorkflow | null> => {
  const [row] = includeDeleted
    ? await sql<DbRow[]>`
        SELECT ${selectColumns}
        FROM grids.workflows
        WHERE id = ${id}::uuid
      `
    : await sql<DbRow[]>`
        SELECT ${selectColumns}
        FROM grids.workflows
        WHERE id = ${id}::uuid AND deleted_at IS NULL
      `;
  return row ? mapWorkflow(row) : null;
};

export const getWorkflowByIdOrShortId = async (baseId: string, idOrShortId: string): Promise<GridsWorkflow | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT ${selectColumns}
    FROM grids.workflows
    WHERE base_id = ${baseId}::uuid
      AND deleted_at IS NULL
      AND (${idOrShortId} = id::text OR short_id = ${idOrShortId})
  `;
  return row ? mapWorkflow(row) : null;
};

export const listWorkflows = async (baseId: string, enabledOnly = false, includeDeleted = false): Promise<GridsWorkflow[]> => {
  const rows = await sql<DbRow[]>`
    SELECT ${selectColumns}
    FROM grids.workflows
    WHERE base_id = ${baseId}::uuid
      AND (${includeDeleted} = TRUE OR deleted_at IS NULL)
      AND (${enabledOnly} = FALSE OR enabled = TRUE)
    ORDER BY position, created_at, id
  `;
  return rows.map(mapWorkflow);
};

export const listScheduledWorkflows = async (): Promise<GridsWorkflow[]> => {
  const rows = await sql<DbRow[]>`
    SELECT ${selectColumns}
    FROM grids.workflows
    WHERE deleted_at IS NULL
      AND enabled = TRUE
      AND jsonb_path_exists(plan, '$.triggers[*] ? (@.kind == "schedule")')
    ORDER BY created_at, id
  `;
  return rows.map(mapWorkflow);
};

export const listRecordEventBaseIds = async (): Promise<string[]> => {
  const rows = await sql<Array<{ id: string }>>`
    SELECT DISTINCT base_id::text AS id
    FROM grids.workflows
    WHERE deleted_at IS NULL
      AND enabled = TRUE
      AND record_event_active_since IS NOT NULL
      AND jsonb_path_exists(plan, '$.triggers[*] ? (@.kind == "recordEvent")')
    ORDER BY id
  `;
  return rows.map((row) => row.id);
};

export const listRecordEventWorkflows = async (baseId: string, occurredAt: string): Promise<GridsWorkflow[]> => {
  const rows = await sql<DbRow[]>`
    SELECT ${selectColumns}
    FROM grids.workflows
    WHERE base_id = ${baseId}::uuid
      AND deleted_at IS NULL
      AND enabled = TRUE
      AND record_event_active_since IS NOT NULL
      AND record_event_active_since <= ${occurredAt}::timestamptz
      AND jsonb_path_exists(plan, '$.triggers[*] ? (@.kind == "recordEvent")')
    ORDER BY position, created_at, id
  `;
  return rows.map(mapWorkflow);
};

const hasRecordEventTrigger = (plan: WorkflowBoundPlan): boolean => plan.triggers.some((trigger) => trigger.kind === "recordEvent");

const recordEventTriggers = (plan: WorkflowBoundPlan) => plan.triggers.filter((trigger) => trigger.kind === "recordEvent");

export const createWorkflow = async (
  baseId: string,
  input: CreateGridsWorkflowInput,
  actorId: string | null,
): Promise<Result<GridsWorkflow>> => {
  const plan = await compileAndBind(baseId, input.source);
  if (!plan.ok) return plan;
  const workflow = await sql.begin(async (tx) => {
    const row = await insertWithShortId(async (shortId) => {
      const [inserted] = await tx<DbRow[]>`
        INSERT INTO grids.workflows (
          short_id, base_id, name, description, source, plan, diagnostics, enabled, position,
          record_event_active_since, owner_user_id
        ) VALUES (
          ${shortId},
          ${baseId}::uuid,
          ${input.name.trim()},
          ${input.description ?? null},
          ${input.source},
          ${plan.data}::jsonb,
          '[]'::jsonb,
          ${input.enabled ?? false},
          ${input.position ?? 0},
          ${input.enabled && hasRecordEventTrigger(plan.data) ? sql`now()` : null},
          ${actorId}::uuid
        )
        RETURNING ${selectColumns}
      `;
      if (!inserted) throw err.internal("workflow insert failed");
      return inserted;
    }, "idx_grids_workflows_short_id");
    const created = mapWorkflow(row);
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
  await metadataEvent("workflow.created", workflow, actorId);
  return ok(workflow);
};

export const updateWorkflow = async (
  id: string,
  input: UpdateGridsWorkflowInput,
  actorId: string | null,
  expectedRevision: number,
): Promise<Result<GridsWorkflow>> => {
  const existing = await getWorkflow(id);
  if (!existing) return fail(err.notFound("workflow"));
  if (existing.revision !== expectedRevision) return fail(revisionConflict());
  const source = input.source ?? existing.source;
  const plan = input.source === undefined ? ok(existing.plan) : await compileAndBind(existing.baseId, source);
  if (!plan.ok) return plan;
  const enabled = input.enabled ?? existing.enabled;
  const recordEventsEnabled = enabled && hasRecordEventTrigger(plan.data);
  const recordEventActivationChanged =
    !existing.enabled || JSON.stringify(recordEventTriggers(existing.plan)) !== JSON.stringify(recordEventTriggers(plan.data));

  const updated = await sql.begin(async (tx): Promise<GridsWorkflow | null> => {
    const [row] = await tx<DbRow[]>`
      UPDATE grids.workflows
      SET name = ${input.name?.trim() ?? existing.name},
          description = ${input.description === undefined ? existing.description : input.description},
          source = ${source},
          plan = ${plan.data}::jsonb,
          diagnostics = '[]'::jsonb,
          enabled = ${enabled},
          position = ${input.position ?? existing.position},
          record_event_active_since = CASE
            WHEN ${recordEventsEnabled} = FALSE THEN NULL
            WHEN record_event_active_since IS NULL OR ${recordEventActivationChanged} THEN now()
            ELSE record_event_active_since
          END
      WHERE id = ${id}::uuid AND deleted_at IS NULL AND revision = ${expectedRevision}
      RETURNING ${selectColumns}
    `;
    if (!row) return null;
    const workflow = mapWorkflow(row);
    if (input.source === undefined) {
      await tx`
        UPDATE grids.workflow_launchers
        SET validated_revision = ${workflow.revision}, updated_at = now()
        WHERE workflow_id = ${id}::uuid AND deleted_at IS NULL AND validated_revision <> ${workflow.revision}
      `;
    } else {
      await tx`
        UPDATE grids.workflow_launchers
        SET enabled = FALSE,
            validated_revision = ${workflow.revision},
            diagnostics = ${[
              {
                code: "launcher.revalidate",
                message: "Workflow changed. Review this launcher before enabling it again.",
                severity: "warning",
                path: [],
              },
            ]}::jsonb,
            updated_at = now()
        WHERE workflow_id = ${id}::uuid AND deleted_at IS NULL
      `;
    }
    await logAudit(
      {
        baseId: existing.baseId,
        userId: actorId,
        action: "workflow.updated",
        diff: {
          workflow: {
            old: { id: existing.id, name: existing.name, enabled: existing.enabled, revision: existing.revision },
            new: { id: workflow.id, name: workflow.name, enabled: workflow.enabled, revision: workflow.revision },
          },
        },
      },
      tx,
    );
    return workflow;
  });
  if (!updated) return fail(revisionConflict());
  await metadataEvent("workflow.updated", updated, actorId);
  return ok(updated);
};

export const removeWorkflow = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await getWorkflow(id);
  if (!existing) return fail(err.notFound("workflow"));
  await sql.begin(async (tx) => {
    await tx`
      UPDATE grids.workflows
      SET deleted_at = now(), enabled = FALSE, record_event_active_since = NULL
      WHERE id = ${id}::uuid AND deleted_at IS NULL
    `;
    await logAudit(
      {
        baseId: existing.baseId,
        userId: actorId,
        action: "workflow.deleted",
        diff: { workflow: { old: { id: existing.id, name: existing.name }, new: null } },
      },
      tx,
    );
  });
  await metadataEvent("workflow.deleted", existing, actorId);
  return ok();
};
